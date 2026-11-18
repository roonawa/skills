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

interface Detail {name: string; fields: Map<string, string>}

/** The `### <tc> <case name>` section under `## NG の詳細`, with its top-level list items by label. */
function findDetail(lines: Line[], tc: string): Detail {
  const start = lines.findIndex(line => heading(line) === 2 && /^##\s+NG\s*の詳細\s*$/.test(line.text.trim()));
  if (start < 0) throw new Error('result.md に「## NG の詳細」の節がありません。');
  let i = start + 1;
  for (; i < lines.length && (heading(lines[i]) === 0 || heading(lines[i]) > 2); i++) {
    const match = heading(lines[i]) === 3 ? /^###\s+(\S+)(?:\s+(.*))?$/.exec(lines[i].text.trim()) : null;
    if (match?.[1] === tc) break;
  }
  if (i >= lines.length || heading(lines[i]) !== 3) throw new Error('result.md の NG の詳細に ' + tc + ' の節がありません。');
  const name = /^###\s+\S+(?:\s+(.*))?$/.exec(lines[i].text.trim())?.[1]?.trim() ?? '';
  const fields = new Map<string, string>();
  let label: string | undefined;
  let first = '';
  let rest: string[] = [];
  const flush = () => {
    if (label !== undefined && !fields.has(label)) fields.set(label, joinValue(first, rest));
  };
  for (i++; i < lines.length && (heading(lines[i]) === 0 || heading(lines[i]) > 3); i++) {
    const item = lines[i].fenced ? null : /^[-*]\s+(.*)$/.exec(lines[i].text);
    if (item) {
      flush();
      const labeled = /^([^:：]{1,20}?)\s*[:：]\s*(.*)$/.exec(item[1]);
      label = (labeled ? labeled[1] : item[1]).trim();
      first = labeled ? labeled[2].trim() : '';
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

/** A header line `- <label>: <value>` above the result table. */
function headerValue(lines: Line[], end: number, label: string): string | undefined {
  for (let i = 0; i < end; i++) {
    const match = lines[i].fenced ? null : new RegExp('^-\\s+' + label + '\\s*[:：]\\s*(.+)$').exec(lines[i].text.trim());
    if (match) return match[1].trim();
  }
  return undefined;
}

export type NeutralizedKind = 'mention' | 'reference' | 'image' | 'html';
export type Neutralized = Partial<Record<NeutralizedKind, number>>;

/**
 * Text that would make Gitea do more than create the issue: @mentions notify users, #12, owner/repo#3 and issue
 * URLs add cross-reference events to other issues, and images or raw HTML load from other hosts when the issue is
 * viewed. Each match outside code is wrapped in an inline code span, so it is shown as written and does nothing.
 */
const sideEffects = new RegExp([
  '(?<image>!\\[[^\\]\\n]{0,500}\\](?:\\([^)\\n]{0,2000}\\)|\\[[^\\]\\n]{0,500}\\])?)',
  '(?<html><\\/?[A-Za-z!?][^>\\n]*>?)',
  '(?<url>https?:\\/\\/[^\\s<>()`]{1,2000}\\/(?:issues|pulls)\\/\\d+[^\\s<>()`]*)',
  '(?<cross>(?<![\\w.\\/-])[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+#\\d+)',
  '(?<ref>(?<![\\w&#\\/])#\\d+)',
  '(?<mention>(?<![\\w.\\/+`-])@[A-Za-z0-9_][\\w.-]*)',
].join('|'), 'g');

/**
 * Splits a line into [text, isCode] parts. A run of n backticks opens a code span that the next run of exactly
 * n backticks closes; a run without a partner is plain text. Linear in the length of the line.
 */
function codeSpans(line: string): [string, boolean][] {
  const runs = [...line.matchAll(/`+/g)].map(match => ({at: match.index, length: match[0].length}));
  const next = new Map<number, number>();
  const partner: number[] = new Array<number>(runs.length).fill(-1);
  for (let i = runs.length - 1; i >= 0; i--) {
    partner[i] = next.get(runs[i].length) ?? -1;
    next.set(runs[i].length, i);
  }
  const parts: [string, boolean][] = [];
  let from = 0;
  for (let i = 0; i < runs.length; i++) {
    const close = partner[i];
    if (close < 0) continue;
    parts.push([line.slice(from, runs[i].at), false]);
    from = runs[close].at + runs[close].length;
    parts.push([line.slice(runs[i].at, from), true]);
    i = close;
  }
  parts.push([line.slice(from), false]);
  return parts;
}

function inlineCode(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const ticks = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return ticks + pad + text + pad + ticks;
}

/** Wraps side-effect text outside fenced blocks and inline code; counts what was wrapped by kind. */
export function neutralize(text: string, counts: Neutralized = {}): string {
  let fence: string | undefined;
  return text.split('\n').map(line => {
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence === undefined && open) { fence = open[1]; return line; }
    if (fence !== undefined) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1]) fence = undefined;
      return line;
    }
    // Keep inline code spans as they are and rewrite only the text between them.
    return codeSpans(line).map(([part, code]) => code ? part : part.replace(sideEffects, (match, ...args) => {
      const groups = args[args.length - 1] as Record<string, string | undefined>;
      const kind: NeutralizedKind = groups.image ? 'image' : groups.html ? 'html' : groups.mention ? 'mention' : 'reference';
      counts[kind] = (counts[kind] ?? 0) + 1;
      return inlineCode(match);
    })).join('');
  }).join('\n');
}

/** Gitea refuses titles over 255 characters. */
const titleLimit = 255;
function capTitle(title: string): string {
  const chars = [...title];
  return chars.length <= titleLimit ? title : chars.slice(0, titleLimit - 1).join('') + '…';
}

export const issueMarker = (product: string, tc: string) => '<!-- aidev-qa: ' + product + ' ' + tc + ' -->';

const none = '（result.md に記載なし）';

/**
 * Issue template. The marker line comes first so the duplicate search can find the issue; the sections follow
 * the order of the NG detail in result-format.md.
 */
function renderBody(product: string, tc: string, run: string, values: Record<string, string | undefined>): string {
  const lines = [issueMarker(product, tc), '## 対象', '', '- TC-ID: ' + tc, '- AC-ID: ' + (values.ac ?? none), '- 実行: ' + run];
  if (values.environment) lines.push('- 環境: ' + values.environment);
  if (values.version) lines.push('- 版: ' + values.version);
  if (values.test) lines.push('- テスト: ' + values.test);
  const section = (title: string, value: string | undefined) => lines.push('', '## ' + title, '', value ?? none);
  section('再現手順', values.steps);
  section('期待結果', values.expected);
  section('実際の結果', values.actual);
  section('再現の回数', values.repeat);
  section('証跡の場所', values.evidence);
  if (values.note) section('補足', values.note);
  lines.push('', '---', '', 'aidev qa issue create が ' + run + '/result.md の NG の詳細から作りました。');
  return lines.join('\n') + '\n';
}

export function buildIssue(result: string, tc: string, context: {product: string; run: string}): {title: string; body: string} {
  const {title, body} = composeIssue(result, tc, context);
  return {title, body};
}

/** buildIssue plus the counts of neutralized text by kind. */
function composeIssue(result: string, tc: string, context: {product: string; run: string}): {title: string; body: string; neutralized: Neutralized} {
  const lines = readLines(result);
  const row = findRow(lines, tc);
  const outcome = row.cells[row.result] ?? '';
  if (outcome !== 'NG') throw new Error(tc + ' の結果は NG ではありません（' + (outcome || '空') + '）。NG のケースだけを起票します。');
  const detail = findDetail(lines, tc);
  const field = (...labels: string[]) => labels.map(label => detail.fields.get(label)).find(value => value);
  const raw: Record<string, string | undefined> = {
    ac: field('AC', 'AC-ID'), test: field('テスト'), steps: field('再現手順'), expected: field('期待結果'),
    actual: field('実際の結果'), repeat: field('再現'), note: field('補足'),
    evidence: field('証跡') ?? (row.evidence >= 0 ? row.cells[row.evidence] || undefined : undefined),
    environment: headerValue(lines, row.index, '環境'), version: headerValue(lines, row.index, '版'),
  };
  const missing = (['再現手順', '期待結果', '実際の結果'] as const).filter((_, i) => ![raw.steps, raw.expected, raw.actual][i]);
  if (missing.length) throw new Error('result.md の NG の詳細（' + tc + '）に ' + missing.join('・') + ' がありません。');
  // Everything copied from result.md is neutralized; the marker and the template's own lines are not.
  const neutralized: Neutralized = {};
  const values = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value === undefined ? undefined : neutralize(value, neutralized)]));
  const name = detail.name ? ' ' + neutralize(detail.name.replace(/\n/g, ' '), neutralized) : '';
  return {title: capTitle('[' + tc + ']' + name), body: renderBody(context.product, tc, context.run, values), neutralized};
}

/** Line numbers (in the body) that look like secrets. Only the numbers are returned, never the text. */
function secretLines(text: string): number[] {
  return checkProfileText('issue', text).errors.filter(issue => issue.code === 'secret' && issue.line).map(issue => issue.line!);
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
  /** How many mentions, references, images and HTML fragments were wrapped in code (counts only). */
  neutralized?: Neutralized;
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
  const lead = /^\s*/.exec(old)![0] || ' ';
  const trail = /\s*$/.exec(old)![0] || ' ';
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
  const run = options.run.replace(/\\/g, '/').replace(/\/+$/, '');
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
  const {title, body, neutralized} = composeIssue(result, tc, {product, run});
  const bad = secretLines(body);
  if (bad.length || secretLines(title).length) {
    throw new Error('起票する本文に秘密情報らしい記述があるため送りません（' + (bad.length ? '本文の ' + bad.join('、') + ' 行目' : '題名') +
      '）。result.md の ' + tc + ' の NG の詳細から値を消し、環境変数の名前や証跡の場所で書き直してください。');
  }
  const row = findRow(readLines(result), tc);
  const recordedCell = row.cells[row.issue] ?? '';
  const recorded = issueCell.exec(recordedCell);
  if (row.cells.length !== row.columns) {
    throw new Error('result.md の ' + tc + ' の行の列の数（' + row.cells.length + '）が表の見出し（' + row.columns + '）と違います。行の両端の | と列を見出しに揃えてください。');
  }
  if (recordedCell && !recorded) throw new Error('result.md の ' + tc + ' の Issue の列に #番号 以外が書かれています。#番号 か空にしてください。');
  const to = {type: tracker.type, url: baseUrl, repo: tracker.repo};
  if (options.dryRun) return {issue: null, created: false, dryRun: true, neutralized, to, title, body};
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
  if (recorded) return {issue, created, dryRun: false, resultUpdated: false, neutralized, ignored};
  try {
    const now = content(path);
    if (now !== result) throw new Error('result.md が起票の途中で変わりました');
    writeAtomically(path, withIssueCell(result, row, issue.number));
  } catch (error) {
    const reason = error instanceof Error && !(error as NodeJS.ErrnoException).code ? error.message : 'ファイル操作に失敗しました';
    throw new Error('Issue #' + issue.number + ' は' + (created ? '作りました' : 'すでにあります') + 'が、result.md に書き戻せませんでした（' + reason +
      '）。' + tc + ' の行の Issue の列に #' + issue.number + ' を書いてください。');
  }
  return {issue, created, dryRun: false, resultUpdated: true, neutralized, ignored};
}
