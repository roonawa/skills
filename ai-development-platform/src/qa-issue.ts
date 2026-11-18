import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'yaml';
import { checked, content } from './files.js';
import { createGiteaClient, type GiteaTransport } from './gitea.js';
import { checkProfile, checkProfileText } from './qa-profile.js';

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

interface ResultRow {index: number; cells: string[]; issue: number; result: number; evidence: number}

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
      if (cells[id] === tc) rows.push({index: j, cells, issue, result, evidence});
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
  const indent = Math.min(...rest.filter(line => line.trim()).map(line => /^\s*/.exec(line)![0].length));
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
  const lines = readLines(result);
  const row = findRow(lines, tc);
  const outcome = row.cells[row.result] ?? '';
  if (outcome !== 'NG') throw new Error(tc + ' の結果は NG ではありません（' + (outcome || '空') + '）。NG のケースだけを起票します。');
  const detail = findDetail(lines, tc);
  const field = (...labels: string[]) => labels.map(label => detail.fields.get(label)).find(value => value);
  const values = {
    ac: field('AC', 'AC-ID'), test: field('テスト'), steps: field('再現手順'), expected: field('期待結果'),
    actual: field('実際の結果'), repeat: field('再現'), note: field('補足'),
    evidence: field('証跡') ?? (row.evidence >= 0 ? row.cells[row.evidence] || undefined : undefined),
    environment: headerValue(lines, row.index, '環境'), version: headerValue(lines, row.index, '版'),
  };
  const missing = (['再現手順', '期待結果', '実際の結果'] as const).filter((_, i) => ![values.steps, values.expected, values.actual][i]);
  if (missing.length) throw new Error('result.md の NG の詳細（' + tc + '）に ' + missing.join('・') + ' がありません。');
  return {title: '[' + tc + ']' + (detail.name ? ' ' + detail.name : ''), body: renderBody(context.product, tc, context.run, values)};
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
  transport?: GiteaTransport;
}
export interface IssueRunResult {
  issue: {number: number; url: string} | null;
  created: boolean;
  dryRun: boolean;
  resultUpdated?: boolean;
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

export async function createIssueFromRun(options: IssueRunOptions): Promise<IssueRunResult> {
  const run = options.run.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!runPattern.test(run)) throw new Error('--run には runs/<YYYYMMDD>-<run-id> を指定してください。');
  if (!tcPattern.test(options.tc)) throw new Error('--tc には TC-ID（TC- で始まる英数字、_、.、-）を指定してください。');
  const tc = options.tc;

  const report = checkProfile(options.root, options.profile, 'aidev-qa-bug-ticket');
  if (report.errors.length) {
    throw new Error('プロファイルを直してください: ' + report.errors.map(issue => issue.path ?? (issue.line ? issue.line + ' 行目' : issue.code)).join('、') +
      '（aidev qa profile check ' + options.profile + ' --skill aidev-qa-bug-ticket で詳しく確かめられます）');
  }
  const product = report.product!;
  const profileText = content(checked(options.root, options.profile))!;
  const tracker = parse(/^---\r?\n([\s\S]*?)\r?\n---/.exec(profileText)![1]).issue_tracker as {type: string; url: string; repo: string};
  const [owner, repo] = tracker.repo.split('/');

  const path = checked(options.root, run + '/result.md');
  const result = content(path);
  if (result === undefined) throw new Error(run + '/result.md がありません。');
  const {title, body} = buildIssue(result, tc, {product, run});
  const bad = secretLines(body);
  if (bad.length || secretLines(title).length) {
    throw new Error('起票する本文に秘密情報らしい記述があるため送りません（' + (bad.length ? '本文の ' + bad.join('、') + ' 行目' : '題名') +
      '）。result.md の ' + tc + ' の NG の詳細から値を消し、環境変数の名前や証跡の場所で書き直してください。');
  }
  const row = findRow(readLines(result), tc);
  const recordedCell = row.cells[row.issue] ?? '';
  const recorded = issueCell.exec(recordedCell);
  if (recordedCell && !recorded) throw new Error('result.md の ' + tc + ' の Issue の列に #番号 以外が書かれています。#番号 か空にしてください。');
  const to = {type: tracker.type, url: tracker.url, repo: tracker.repo};
  if (options.dryRun) return {issue: null, created: false, dryRun: true, to, title, body};

  const client = createGiteaClient({baseUrl: tracker.url, token: options.token as string, transport: options.transport});
  const marker = issueMarker(product, tc);
  const found = (await client.findIssues(owner, repo, marker.slice(5, -4)))
    .filter(issue => issue.body.split(/\r?\n/).some(line => line.trim() === marker));
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
  if (recorded) return {issue, created, dryRun: false, resultUpdated: false};
  try {
    const now = content(path);
    if (now !== result) throw new Error('result.md が起票の途中で変わりました');
    writeAtomically(path, withIssueCell(result, row, issue.number));
  } catch (error) {
    const reason = error instanceof Error && !(error as NodeJS.ErrnoException).code ? error.message : 'ファイル操作に失敗しました';
    throw new Error('Issue #' + issue.number + ' は' + (created ? '作りました' : 'すでにあります') + 'が、result.md に書き戻せませんでした（' + reason +
      '）。' + tc + ' の行の Issue の列に #' + issue.number + ' を書いてください。');
  }
  return {issue, created, dryRun: false, resultUpdated: true};
}
