import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checked, content } from './files.js';
import { createGiteaClient, type GiteaTransport } from './gitea.js';
import { checkProfileText, loadProfile } from './qa-profile.js';

/**
 * `aidev qa issue create`: turns one NG case of `runs/<YYYYMMDD>-<run-id>/result.md` into a Gitea issue.
 * The body is built from the case's section under 「NG の詳細」 (aidev-qa-test-run references/result-format.md),
 * passes the secret scan before anything is sent, and the issue number is written back to the Issue cell only.
 */

const tcPattern = /^TC-[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const runPattern = /^runs\/\d{8}-[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const issueCell = /^#(\d+)$/;

interface Line {text: string; fenced: boolean}

/** Lines without line endings. `fenced` marks fence lines and everything between them (``` or ~~~). */
function readLines(markdown: string): Line[] {
  let fence: string | undefined;
  return markdown.split('\n').map(raw => {
    const text = raw.replace(/\r$/, '');
    const open = /^\s*(`{3,}|~{3,})/.exec(text);
    if (fence === undefined && open) { fence = open[1]; return {text, fenced: true}; }
    if (fence !== undefined) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && text.trim() === open[1]) fence = undefined;
      return {text, fenced: true};
    }
    return {text, fenced: false};
  });
}

/** Cells of a table row, split at unescaped pipes. The first and last entries are what lies outside the outer pipes. */
const splitRow = (text: string) => text.split(/(?<!\\)\|/);
const cellsOf = (text: string) => splitRow(text).slice(1, -1).map(cell => cell.trim());

interface ResultRow {index: number; cells: string[]; columns: number; issue: number; result: number; evidence: number}

/** The row of `tc` in the result table (the first table whose header has TC-ID, 結果 and Issue). */
function findRow(lines: Line[], tc: string): ResultRow {
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i].fenced || !lines[i].text.trim().startsWith('|')) continue;
    const header = cellsOf(lines[i].text.trim());
    const [id, result, issue, evidence] = ['TC-ID', '結果', 'Issue', '証跡'].map(name => header.indexOf(name));
    if (id < 0 || result < 0 || issue < 0 || !/^\|?[\s:|-]+$/.test(lines[i + 1].text.trim())) continue;
    const rows: ResultRow[] = [];
    for (let j = i + 2; j < lines.length && !lines[j].fenced && lines[j].text.trim().startsWith('|'); j++) {
      const cells = cellsOf(lines[j].text.trim());
      if (cells[id] === tc) rows.push({index: j, cells, columns: header.length, issue, result, evidence});
    }
    if (rows.length === 0) throw new Error('result.md の表に ' + tc + ' の行がありません。');
    if (rows.length > 1) throw new Error('result.md の表に ' + tc + ' の行が ' + rows.length + ' 行あります。1行にしてください。');
    return rows[0];
  }
  throw new Error('result.md に TC-ID・結果・証跡・Issue の列を持つ表がありません。');
}

const heading = (line: Line) => line.fenced ? 0 : (/^(#{1,6})\s/.exec(line.text)?.[1].length ?? 0);

/*
 * A line is up to 1 MiB long. The list items and labels below are split without regular expressions: a pattern
 * like \s+(.*)$ backtracks over every space when the line holds U+2028, U+2029 or a lone CR (\s, but not the dot),
 * which takes quadratic time.
 */

/** The text of a list item `- text` or `* text` (marker, then at least one space), or undefined. */
function listItem(text: string): string | undefined {
  if (text[0] !== '-' && text[0] !== '*') return undefined;
  const rest = text.slice(1);
  const body = rest.trimStart();
  return body.length < rest.length ? body : undefined;
}

/** The first ':' or '：' in `text`, or -1. */
function firstColon(text: string): number {
  const half = text.indexOf(':');
  const full = text.indexOf('：');
  return half < 0 ? full : full < 0 ? half : Math.min(half, full);
}

/**
 * `label: value` of a list item, as [label, value] with both trimmed: the label is what comes before the first
 * colon, 1 to 20 characters once trailing spaces are cut. Otherwise undefined.
 */
function itemLabel(item: string): [string, string] | undefined {
  const colon = firstColon(item);
  if (colon < 1) return undefined;
  const label = item.slice(0, colon).trimEnd();
  if (label.length > 20) return undefined;
  return [label.trim(), item.slice(colon + 1).trim()];
}

interface Detail {name: string; fields: Map<string, string>}

/** The `### <tc> <case name>` section under `## NG の詳細`, with its top-level list items by label. */
function findDetail(lines: Line[], tc: string): Detail {
  const start = lines.findIndex(line => heading(line) === 2 && /^##\s+NG\s*の詳細\s*$/.test(line.text.trim()));
  if (start < 0) throw new Error('result.md に「## NG の詳細」の節がありません。');
  let i = start + 1;
  const found: number[] = [];
  for (; i < lines.length && (heading(lines[i]) === 0 || heading(lines[i]) > 2); i++) {
    // The s flag: a case name may contain U+2028 or U+2029, which `.` would not match otherwise.
    const match = heading(lines[i]) === 3 ? /^###\s+(\S+)(?:\s+(.*))?$/s.exec(lines[i].text.trim()) : null;
    if (match?.[1] === tc) found.push(i);
  }
  if (found.length > 1) {
    throw new Error('result.md の NG の詳細に ' + tc + ' の節が ' + found.length + ' つあります（' + found.map(n => n + 1 + ' 行目').join('、') +
      '）。1つにまとめてください。');
  }
  if (found.length === 0) throw new Error('result.md の NG の詳細に ' + tc + ' の節がありません。');
  i = found[0];
  const name = /^###\s+\S+(?:\s+(.*))?$/s.exec(lines[i].text.trim())?.[1]?.trim() ?? '';
  const fields = new Map<string, string>();
  let label: string | undefined;
  let first = '';
  let rest: string[] = [];
  const flush = () => {
    if (label !== undefined && !fields.has(label)) fields.set(label, joinValue(first, rest));
  };
  for (i++; i < lines.length && (heading(lines[i]) === 0 || heading(lines[i]) > 3); i++) {
    const item = lines[i].fenced ? undefined : listItem(lines[i].text);
    if (item !== undefined) {
      flush();
      const labeled = itemLabel(item);
      label = (labeled ? labeled[0] : item).trim();
      first = labeled ? labeled[1] : '';
      rest = [];
    } else if (label !== undefined) rest.push(lines[i].text);
  }
  flush();
  return {name, fields};
}

/** A list item's value: the text after the label, then the continuation lines with their common indent removed. */
function joinValue(first: string, rest: string[]): string {
  while (rest.length && !rest[rest.length - 1].trim()) rest.pop();
  // A loop, not Math.min(...lines): a spread of many lines would overflow the call stack.
  let indent = Infinity;
  for (const line of rest) if (line.trim()) indent = Math.min(indent, /^\s*/.exec(line)![0].length);
  const body = rest.map(line => line.slice(Number.isFinite(indent) ? indent : 0));
  return [first, ...body].filter((line, index) => index > 0 || line).join('\n');
}

/** A header line `- <label>: <value>` above the result table (a non-empty value). */
function headerValue(lines: Line[], end: number, label: string): string | undefined {
  for (let i = 0; i < end; i++) {
    const text = lines[i].text.trim();
    if (lines[i].fenced || text[0] !== '-') continue;
    const item = listItem(text);
    if (item === undefined || !item.startsWith(label)) continue;
    const after = item.slice(label.length).trimStart();
    if (after[0] !== ':' && after[0] !== '：') continue;
    const value = after.slice(1).trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Text copied from result.md could make Gitea do more than create the issue (@mentions notify users, #12, !3 and
 * owner/repo#3 add references to other issues, images and HTML load from other hosts). Rather than look for
 * those, every copied value is put in a fenced code block, where Gitea renders none of them. The fence is a run of
 * backticks longer than any run in the value (at least 3), with no info string, so no line of the value can close
 * it; leading spaces or a backtick info string inside the value are plain text there.
 */
function fenced(value: string): string {
  let longest = 0;
  for (const run of value.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return fence + '\n' + value + '\n' + fence;
}

/**
 * Full-width forms of the characters that Gitea or Markdown could act on in a title. `:` and `/` are included so
 * no URL (an issues or pulls URL would add a cross-reference) and no owner/repo form survives.
 */
const titleCharacters: Record<string, string> = {
  '@': '＠', '#': '＃', '!': '！', '<': '＜', '>': '＞', '[': '［', ']': '］', '(': '（', ')': '）', '\\': '＼', '`': '｀',
  ':': '：', '/': '／',
};
/**
 * C0 and C1 controls (tab, CR and LF are turned into spaces below, so they stay out of this set), the bidirectional
 * controls (U+061C, U+200E, U+200F, U+202A\u2013U+202E, U+2066\u2013U+2069), the line and paragraph separators (U+2028, U+2029)
 * and the zero-width characters (U+200B\u2013U+200D, U+2060, U+FEFF).
 */
const titleInvisible = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/g;
/** Gitea refuses titles over 255 characters. */
const titleLimit = 255;
function plainTitle(title: string): string {
  const chars = [...title.replace(titleInvisible, '').replace(/[\r\n\t]+/g, ' ').replace(/[@#!<>[\]()\\`:/]/g, char => titleCharacters[char])];
  return chars.length <= titleLimit ? chars.join('') : chars.slice(0, titleLimit - 1).join('') + '…';
}

export const issueMarker = (product: string, tc: string) => '<!-- aidev-qa: ' + product + ' ' + tc + ' -->';

const none = '（result.md に記載なし）';

/**
 * Issue template. The marker line comes first so the duplicate search can find the issue; the sections follow
 * the order of the NG detail in result-format.md. Only the template's own text (headings, labels, the TC-ID and
 * the run directory, both validated) is outside code blocks; every value from result.md is fenced.
 */
function renderBody(product: string, tc: string, run: string, values: Record<string, string | undefined>): string {
  const lines = [issueMarker(product, tc), '## 対象', '', '- TC-ID: ' + tc, '- 実行: ' + run];
  const block = (value: string | undefined) => lines.push('', value === undefined ? none : fenced(value));
  const labeled = (label: string, value: string | undefined, always = false) => {
    if (value === undefined && !always) return;
    lines.push('', label);
    block(value);
  };
  labeled('AC-ID', values.ac, true);
  labeled('環境', values.environment);
  labeled('版', values.version);
  labeled('テスト', values.test);
  const section = (title: string, value: string | undefined) => { lines.push('', '## ' + title); block(value); };
  section('再現手順', values.steps);
  section('期待結果', values.expected);
  section('実際の結果', values.actual);
  section('再現の回数', values.repeat);
  section('証跡の場所', values.evidence);
  if (values.note !== undefined) section('補足', values.note);
  lines.push('', '---', '', 'aidev qa issue create が ' + run + '/result.md の NG の詳細から作りました。');
  return lines.join('\n') + '\n';
}

export function buildIssue(result: string, tc: string, context: {product: string; run: string}): {title: string; body: string} {
  const lines = readLines(result);
  const row = findRow(lines, tc);
  const outcome = row.cells[row.result] ?? '';
  if (outcome !== 'NG') throw new Error(tc + ' の結果は NG ではありません（' + (outcome || '空') + '）。NG のケースだけを起票します。');
  const detail = findDetail(lines, tc);
  const field = (...labels: string[]) => labels.map(label => detail.fields.get(label)).find(value => value);
  const values: Record<string, string | undefined> = {
    ac: field('AC', 'AC-ID'), test: field('テスト'), steps: field('再現手順'), expected: field('期待結果'),
    actual: field('実際の結果'), repeat: field('再現'), note: field('補足'),
    evidence: field('証跡') ?? (row.evidence >= 0 ? row.cells[row.evidence] || undefined : undefined),
    environment: headerValue(lines, row.index, '環境'), version: headerValue(lines, row.index, '版'),
  };
  const missing = (['再現手順', '期待結果', '実際の結果'] as const).filter((_, i) => ![values.steps, values.expected, values.actual][i]);
  if (missing.length) throw new Error('result.md の NG の詳細（' + tc + '）に ' + missing.join('・') + ' がありません。');
  return {title: plainTitle('[' + tc + ']' + (detail.name ? ' ' + detail.name : '')), body: renderBody(context.product, tc, context.run, values)};
}

/**
 * The fields of the body that look like secrets: the label of the template section (再現手順, 実際の結果, …) that
 * holds the line. Only labels are returned, never the text or a line number.
 */
function secretFields(body: string): string[] {
  const hits = new Set(checkProfileText('issue', body).errors.filter(issue => issue.code === 'secret' && issue.line).map(issue => issue.line!));
  if (hits.size === 0) return [];
  const labels = new Set<string>();
  let label = '対象';
  readLines(body).forEach((line, index) => {
    const text = line.text.trim();
    if (!line.fenced && (/^## /.test(text) || ['AC-ID', '環境', '版', 'テスト'].includes(text))) label = text.replace(/^## /, '');
    if (hits.has(index + 1)) labels.add(label === '対象' ? 'TC-ID・実行' : label);
  });
  return [...labels];
}

export interface IssueRunOptions {
  root: string;
  profile: string;
  run: string;
  tc: string;
  dryRun: boolean;
  token?: string;
  /** GITEA_URL, set by the worker next to GITEA_TOKEN. The token goes only to this origin. */
  giteaUrl?: string;
  transport?: GiteaTransport;
}
export interface IssueRunResult {
  issue: {number: number; url: string} | null;
  created: boolean;
  dryRun: boolean;
  resultUpdated?: boolean;
  /** Issues with the marker that were not counted as duplicates (number and reason only). */
  ignored?: {number: number; reason: string}[];
  to?: {type: string; url: string; repo: string};
  title?: string;
  body?: string;
}

/** Replaces the Issue cell of one row and keeps every other character, including the line ending. */
function withIssueCell(text: string, row: ResultRow, number: number): string {
  const lines = text.split('\n');
  const raw = lines[row.index];
  const eol = raw.endsWith('\r') ? '\r' : '';
  const parts = splitRow(raw.slice(0, raw.length - eol.length));
  const at = row.issue + 1;
  const old = parts[at];
  // trimStart/trimEnd, not /\s*$/: that pattern is tried at every position and is quadratic on padded text.
  const lead = old.slice(0, old.length - old.trimStart().length) || ' ';
  const trail = old.slice(old.trimEnd().length) || ' ';
  parts[at] = lead + '#' + number + trail;
  lines[row.index] = parts.join('|') + eol;
  return lines.join('\n');
}

function writeAtomically(path: string, text: string): void {
  const temp = join(dirname(path), '.aidev-' + randomUUID());
  writeFileSync(temp, text, {flag: 'wx'});
  try {
    renameSync(temp, path);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* already gone */ }
    throw error;
  }
}

/**
 * The token's destination comes from GITEA_URL (set by the worker next to the token), not from the repository's
 * profile: the profile only has to agree with it. Neither URL is put in the message.
 */
function trustedBaseUrl(giteaUrl: string | undefined, profileUrl: string): string {
  if (!giteaUrl) throw new Error('環境変数 GITEA_URL に起票先の Gitea の URL を設定してください（GITEA_TOKEN と同じ作業者が設定する）。');
  let trusted: URL;
  try { trusted = new URL(giteaUrl); } catch { throw new Error('GITEA_URL の形式が違います。'); }
  if (trusted.username || trusted.password || trusted.search || trusted.hash) {
    throw new Error('GITEA_URL にはユーザー名、パスワード、クエリ、# を含めないでください。');
  }
  if (trusted.origin !== new URL(profileUrl).origin) {
    throw new Error('プロファイルの issue_tracker.url が GITEA_URL と同じ接続先（スキーム・ホスト・ポート）ではありません。トークンを送らずに止めました。');
  }
  return giteaUrl;
}

export async function createIssueFromRun(options: IssueRunOptions): Promise<IssueRunResult> {
  // Trailing slashes are cut with a loop: /\/+$/ takes quadratic time on a long run of slashes.
  const slashed = options.run.replace(/\\/g, '/');
  let end = slashed.length;
  while (end > 0 && slashed[end - 1] === '/') end--;
  const run = slashed.slice(0, end);
  if (!runPattern.test(run)) throw new Error('--run には runs/<YYYYMMDD>-<run-id> を指定してください。');
  if (!tcPattern.test(options.tc)) throw new Error('--tc には TC-ID（TC- で始まる英数字、_、.、-）を指定してください。');
  const tc = options.tc;

  const {report, data} = loadProfile(options.root, options.profile, 'aidev-qa-bug-ticket');
  if (report.errors.length) {
    throw new Error('プロファイルを直してください: ' + report.errors.map(issue => issue.path ?? (issue.line ? issue.line + ' 行目' : issue.code)).join('、') +
      '（aidev qa profile check ' + options.profile + ' --skill aidev-qa-bug-ticket で詳しく確かめられます）');
  }
  const product = report.product!;
  // The profile check has already validated issue_tracker (type, url and repo).
  const tracker = data!.issue_tracker as {type: string; url: string; repo: string};
  const [owner, repo] = tracker.repo.split('/');
  const baseUrl = trustedBaseUrl(options.giteaUrl, tracker.url);

  const path = checked(options.root, run + '/result.md');
  const result = content(path);
  if (result === undefined) throw new Error(run + '/result.md がありません。');
  const {title, body} = buildIssue(result, tc, {product, run});
  const bad = secretFields(body);
  if (secretFields(title).length) bad.unshift('ケース名');
  if (bad.length) {
    throw new Error('起票する本文に秘密情報らしい記述があるため送りません（' + bad.join('・') + 'の欄）。result.md の ' + tc + ' の NG の詳細から値を消し、環境変数の名前や証跡の場所で書き直してください。');
  }
  const row = findRow(readLines(result), tc);
  const recordedCell = row.cells[row.issue] ?? '';
  const recorded = issueCell.exec(recordedCell);
  if (row.cells.length !== row.columns) {
    throw new Error('result.md の ' + tc + ' の行の列の数（' + row.cells.length + '）が表の見出し（' + row.columns + '）と違います。行の両端の | と列を見出しに揃えてください。');
  }
  if (recordedCell && !recorded) throw new Error('result.md の ' + tc + ' の Issue の列に #番号 以外が書かれています。#番号 か空にしてください。');
  const to = {type: tracker.type, url: baseUrl, repo: tracker.repo};
  if (options.dryRun) return {issue: null, created: false, dryRun: true, to, title, body};
  if (typeof options.token === 'string' && options.token && (title.includes(options.token) || body.includes(options.token))) {
    throw new Error('起票する題名か本文に GITEA_TOKEN の値がそのまま含まれているため送りません。result.md から消してください。');
  }

  const client = createGiteaClient({baseUrl, token: options.token as string, transport: options.transport});
  const me = await client.currentUser();
  const marker = issueMarker(product, tc);
  const marked = (await client.findIssues(owner, repo, marker.slice(5, -4)))
    .filter(issue => issue.body.split(/\r?\n/)[0].trim() === marker);
  // Anyone can write the marker, so only the worker's own open issues count as duplicates.
  const found = marked.filter(issue => issue.state === 'open' && issue.user.login === me.login);
  const ignored = marked.filter(issue => !found.includes(issue))
    .map(issue => ({number: issue.number, reason: issue.state !== 'open' ? '閉じている' : '別のユーザーが作成'}));
  if (recorded && !found.some(issue => issue.number === Number(recorded[1]))) {
    throw new Error('result.md の ' + tc + ' の Issue の列にはすでに ' + recordedCell + ' が書かれています。' +
      (found.length ? '目印から見つかった Issue は #' + found[0].number + ' です。' : '') + '書き換えずに止めました。');
  }
  let issue: {number: number; url: string};
  let created = false;
  const existing = recorded ? found.find(item => item.number === Number(recorded[1])) : found[0];
  if (existing) issue = {number: existing.number, url: existing.html_url};
  else {
    const made = await client.createIssue(owner, repo, {title, body});
    issue = {number: made.number, url: made.html_url};
    created = true;
  }
  if (recorded) return {issue, created, dryRun: false, resultUpdated: false, ignored};
  try {
    const now = content(path);
    if (now !== result) throw new Error('result.md が起票の途中で変わりました');
    writeAtomically(path, withIssueCell(result, row, issue.number));
  } catch (error) {
    const reason = error instanceof Error && !(error as NodeJS.ErrnoException).code ? error.message : 'ファイル操作に失敗しました';
    throw new Error('Issue #' + issue.number + ' は' + (created ? '作りました' : 'すでにあります') + 'が、result.md に書き戻せませんでした（' + reason +
      '）。' + tc + ' の行の Issue の列に #' + issue.number + ' を書いてください。');
  }
  return {issue, created, dryRun: false, resultUpdated: true, ignored};
}
