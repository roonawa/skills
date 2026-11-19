import { readdirSync } from 'node:fs';
import { checked, content } from './files.js';

/**
 * Reads a QA repository (templates/qa) for `aidev qa trace`: plan/acceptance.md, cases/*.md and
 * runs/<YYYYMMDD>-<run-id>/result.md. Nothing is written. README.md files and fenced blocks (``` and ~~~) are not
 * read, files directly under runs/ are skipped, unknown header lines of result.md are ignored, and every line that
 * looks like a record but has the wrong form is reported in `problems` with its file and line instead of dropped.
 *
 * The fence and table-cell handling follows src/qa-issue.ts (readLines, cellsOf). It is duplicated here on purpose
 * so that this read-only parser does not change the module that writes result.md.
 */

export interface AcceptanceItem { id: string; text: string; source?: string; line: number }
export interface CaseItem {
  id: string; name: string; feature: string; file: string; acs: string[];
  priority?: string; execution?: '自動' | '手動'; line: number;
}
export interface RunRow { tc: string; result: 'OK' | 'NG' | '実行不能'; evidence?: string; issues: number[]; reason?: string }
export type FixVerdict = '確認済み' | '要確認' | '効いていない';
export interface FixCheck { issue: number; verdict: FixVerdict; note?: string; commit?: string }
export interface RunRecord {
  dir: string; date: string; runId: string; environment?: string; version?: string; executedAt?: string;
  fixChecks: FixCheck[]; origin?: string; rows: RunRow[];
}
export interface QaProblem { code: string; file: string; line?: number; message: string }
export interface QaRepository { acceptance: AcceptanceItem[]; cases: CaseItem[]; runs: RunRecord[]; problems: QaProblem[] }

interface Line { text: string; fenced: boolean }

/** Lines without line endings. `fenced` marks fence lines and everything between them. */
function readLines(markdown: string): Line[] {
  let fence: string | undefined;
  return markdown.split('\n').map(raw => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(text);
    if (fence === undefined && open) { fence = open[1]; return {text, fenced: true}; }
    if (fence !== undefined) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && text.trim() === open[1]) fence = undefined;
      return {text, fenced: true};
    }
    return {text, fenced: false};
  });
}

/** Cells of a table row, split at unescaped pipes, with `\|` turned back into `|`. */
const cellsOf = (text: string) => text.split(/(?<!\\)\|/).slice(1, -1).map(cell => cell.trim().replace(/\\\|/g, '|'));
const isRow = (line: Line) => !line.fenced && line.text.trimStart().startsWith('|');
const headingLevel = (line: Line) => line.fenced ? 0 : (/^(#{1,6})(?:\s|$)/.exec(line.text)?.[1].length ?? 0);
/** `- label: value` (also with a full-width colon). */
const labeled = /^[-*]\s+([^:：]+?)\s*[:：]\s*(.*)$/;

const acId = /^AC-\d{1,6}$/;
const tcId = /^TC-(\S+)-(\d+)$/;
const runDir = /^(\d{8})-([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/;

class Reader {
  problems: QaProblem[] = [];
  constructor(private root: string) {}
  problem(code: string, file: string, line: number | undefined, message: string) {
    this.problems.push(line === undefined ? {code, file, message} : {code, file, line, message});
  }
  /** The file's lines, or undefined when it is missing. Links, non-files and files over 1 MiB become problems. */
  lines(relative: string, missing?: {code: string; message: string}): Line[] | undefined {
    let text: string | undefined;
    try {
      text = content(checked(this.root, relative));
    } catch (error) {
      this.problem('unreadable', relative, undefined, (error as Error).message);
      return undefined;
    }
    if (text === undefined) {
      if (missing) this.problem(missing.code, relative, undefined, missing.message);
      return undefined;
    }
    return readLines(text.startsWith('﻿') ? text.slice(1) : text);
  }
  /** Entries of a directory inside the repository; links are neither files nor directories here. */
  entries(relative: string) {
    let path: string;
    try {
      path = checked(this.root, relative);
    } catch (error) {
      this.problem('unreadable', relative, undefined, (error as Error).message);
      return [];
    }
    try {
      return readdirSync(path, {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      this.problem('unreadable', relative, undefined, (error as Error).message);
      return [];
    }
  }
}

function readAcceptance(reader: Reader): AcceptanceItem[] {
  const file = 'plan/acceptance.md';
  const lines = reader.lines(file, {code: 'missing-acceptance', message: 'plan/acceptance.md がありません。'});
  const items: AcceptanceItem[] = [];
  const seen = new Set<string>();
  lines?.forEach((line, index) => {
    if (line.fenced || !/^[-*]\s+AC-/.test(line.text.trim())) return;
    const match = /^[-*]\s+(AC-\d{1,6})\s*[:：]\s*(.*)$/.exec(line.text.trim());
    if (!match || !match[2].trim()) {
      reader.problem('acceptance-line', file, index + 1, '受け入れ条件の行の形が「- AC-<1〜6桁の数字>: 本文」ではありません。');
      return;
    }
    const [, id, body] = match;
    if (seen.has(id)) {
      reader.problem('duplicate-acceptance', file, index + 1, id + ' が2回以上あります。最初の行を使います。');
      return;
    }
    seen.add(id);
    const source = /^(.*?)\s*[（(]出どころ\s*[:：]\s*(.*?)\s*[）)]\s*$/.exec(body.trim());
    items.push(source ? {id, text: source[1], source: source[2], line: index + 1} : {id, text: body.trim(), line: index + 1});
  });
  return items;
}

function readCases(reader: Reader): CaseItem[] {
  const entries = reader.entries('cases');
  if (entries === undefined) {
    reader.problem('missing-cases', 'cases', undefined, 'cases/ がありません。');
    return [];
  }
  const cases: CaseItem[] = [];
  const seen = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.toLowerCase() === 'readme.md') continue;
    const file = 'cases/' + entry.name;
    const lines = reader.lines(file);
    if (!lines) continue;
    let current: CaseItem | undefined;
    let inFields = false;
    lines.forEach((line, index) => {
      const level = headingLevel(line);
      if (level > 0) {
        current = undefined;
        inFields = false;
        if (level !== 3 || !/^###\s+TC-/.test(line.text)) return;
        const match = /^###\s+(\S+)(?:\s+(.*))?$/.exec(line.text.trim());
        const id = match ? tcId.exec(match[1]) : null;
        if (!match || !id) {
          reader.problem('case-heading', file, index + 1, 'ケースの見出しの形が「### TC-<機能>-<連番> <名前>」ではありません。');
          return;
        }
        if (seen.has(match[1])) {
          reader.problem('duplicate-case', file, index + 1, match[1] + ' は ' + seen.get(match[1]) + ' にもあります。最初の見出しを使います。');
          return;
        }
        seen.set(match[1], file);
        current = {id: match[1], name: (match[2] ?? '').trim(), feature: id[1], file, acs: [], line: index + 1};
        cases.push(current);
        inFields = true;
        return;
      }
      if (!current || !inFields || line.fenced) return;
      const text = line.text.trim();
      if (!text) return;
      const field = labeled.exec(text);
      if (!field) { inFields = false; return; }
      const [, label, value] = field;
      if (label === 'AC') {
        for (const token of value.split(/[\s,、，]+/).filter(Boolean)) {
          if (acId.test(token)) { if (!current.acs.includes(token)) current.acs.push(token); }
          else reader.problem('case-ac', file, index + 1, current.id + ' の AC に AC-ID ではない値「' + clip(token) + '」があります。');
        }
      } else if (label === '優先度') {
        if (value.trim()) current.priority = value.trim();
      } else if (label === '実行') {
        const execution = value.trim();
        if (execution === '自動' || execution === '手動') current.execution = execution;
        else reader.problem('case-execution', file, index + 1, current.id + ' の実行は「自動」か「手動」で書きます。');
      }
    });
  }
  return cases;
}

const clip = (text: string) => text.length > 40 ? text.slice(0, 40) + '…' : text;

function readHeader(reader: Reader, file: string, lines: Line[], end: number, run: RunRecord): void {
  const commits: {issue: number; commit: string; line: number}[] = [];
  for (let i = 0; i < end; i++) {
    if (lines[i].fenced) continue;
    const field = labeled.exec(lines[i].text.trim());
    if (!field) continue;
    const [, label, raw] = field;
    const value = raw.trim();
    if (label === '環境') run.environment ??= value;
    else if (label === '版') run.version ??= value;
    else if (label === '実行日時') run.executedAt ??= value;
    else if (label === '元の run') run.origin ??= value;
    else if (label === '改修確認') {
      const check = parseFixCheck(value);
      if (!check) {
        reader.problem('fix-check', file, i + 1,
          '改修確認の行の形が「#<番号> 確認済み」「#<番号> 要確認（理由）」「#<番号> 効いていない」のどれでもありません。確認済みに数えません。');
      } else if (run.fixChecks.some(item => item.issue === check.issue)) {
        reader.problem('duplicate-fix-check', file, i + 1, '#' + check.issue + ' の改修確認の行が2回以上あります。最初の行を使います。');
      } else run.fixChecks.push(check);
    } else {
      const commit = /^修正コミット\s*[（(]\s*#(\d+)\s*[）)]$/.exec(label);
      if (commit && value) commits.push({issue: Number(commit[1]), commit: value, line: i + 1});
      else if (label.startsWith('修正コミット')) reader.problem('fix-commit', file, i + 1, '修正コミットの行の形が「- 修正コミット（#<番号>）: <hash>」ではありません。');
    }
  }
  for (const {issue, commit, line} of commits) {
    const check = run.fixChecks.find(item => item.issue === issue);
    if (!check) reader.problem('fix-commit-unpaired', file, line, '#' + issue + ' の修正コミットに組になる改修確認の行がありません。');
    else check.commit ??= commit;
  }
}

function parseFixCheck(value: string): FixCheck | undefined {
  const match = /^#(\d+)\s+(.+)$/.exec(value);
  if (!match) return undefined;
  const issue = Number(match[1]);
  const verdict = match[2].trim();
  if (verdict === '確認済み' || verdict === '効いていない') return {issue, verdict};
  const unsure = /^要確認(?:\s*[（(](.*)[）)])?$/.exec(verdict);
  if (!unsure) return undefined;
  return unsure[1]?.trim() ? {issue, verdict: '要確認', note: unsure[1].trim()} : {issue, verdict: '要確認'};
}

/** Reasons under `## 実行不能の理由`, by TC-ID (`### <TC-ID>` and its `- 理由:` item). */
function readReasons(lines: Line[], from: number): Map<string, string> {
  const reasons = new Map<string, string>();
  let i = from;
  for (; i < lines.length; i++) if (headingLevel(lines[i]) === 2 && /^##\s+実行不能の理由\s*$/.test(lines[i].text.trim())) break;
  let tc: string | undefined;
  for (i++; i < lines.length; i++) {
    const level = headingLevel(lines[i]);
    if (level === 1 || level === 2) break;
    if (level > 0) { tc = level === 3 ? /^###\s+(\S+)/.exec(lines[i].text.trim())?.[1] : undefined; continue; }
    if (!tc || lines[i].fenced || reasons.has(tc)) continue;
    const field = labeled.exec(lines[i].text.trim());
    if (field && field[1] === '理由' && field[2].trim()) reasons.set(tc, field[2].trim());
  }
  return reasons;
}

function readRun(reader: Reader, dir: string, date: string, runId: string): RunRecord | undefined {
  const file = dir + '/result.md';
  const lines = reader.lines(file, {code: 'missing-result', message: dir + ' に result.md がありません。'});
  if (!lines) return undefined;
  const run: RunRecord = {dir, date, runId, fixChecks: [], rows: []};
  let start = -1;
  let columns: {id: number; result: number; evidence: number; issue: number; count: number} | undefined;
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!isRow(lines[i])) continue;
    const header = cellsOf(lines[i].text.trim());
    const [id, result, evidence, issue] = ['TC-ID', '結果', '証跡', 'Issue'].map(name => header.indexOf(name));
    if (id < 0 || result < 0 || issue < 0 || !isRow(lines[i + 1]) || !/^\|?[\s:|-]+$/.test(lines[i + 1].text.trim())) continue;
    start = i;
    columns = {id, result, evidence, issue, count: header.length};
    break;
  }
  readHeader(reader, file, lines, start < 0 ? lines.length : start, run);
  if (!columns) {
    reader.problem('no-result-table', file, undefined, 'TC-ID・結果・証跡・Issue の列を持つ表がありません。');
    return run;
  }
  const seen = new Set<string>();
  const rowEnd = (() => { let j = start + 2; while (j < lines.length && isRow(lines[j])) j++; return j; })();
  for (let j = start + 2; j < rowEnd; j++) {
    const line = j + 1;
    const cells = cellsOf(lines[j].text.trim());
    if (cells.length !== columns.count) {
      reader.problem('run-row', file, line, '表の行の列の数が見出しと違います（' + cells.length + ' 列、見出しは ' + columns.count + ' 列）。');
      continue;
    }
    const tc = cells[columns.id];
    if (!tcId.test(tc)) { reader.problem('run-tc', file, line, 'TC-ID の形が「TC-<機能>-<連番>」ではありません。'); continue; }
    const result = cells[columns.result];
    if (result !== 'OK' && result !== 'NG' && result !== '実行不能') {
      reader.problem('run-result', file, line, tc + ' の結果は OK・NG・実行不能のどれかで書きます。');
      continue;
    }
    if (seen.has(tc)) { reader.problem('duplicate-run-row', file, line, tc + ' の行が2回以上あります。最初の行を使います。'); continue; }
    seen.add(tc);
    const issues: number[] = [];
    let badIssue = false;
    for (const token of cells[columns.issue].split(/[\s,、，]+/).filter(Boolean)) {
      const number = /^#(\d+)$/.exec(token);
      if (number) { if (!issues.includes(Number(number[1]))) issues.push(Number(number[1])); }
      else badIssue = true;
    }
    if (badIssue) reader.problem('run-issue', file, line, tc + ' の Issue の列に「#番号」以外の値があります。');
    const row: RunRow = {tc, result, issues};
    const evidence = columns.evidence >= 0 ? cells[columns.evidence] : '';
    if (evidence) row.evidence = evidence;
    run.rows.push(row);
  }
  if (run.rows.some(row => row.result === '実行不能')) {
    const reasons = readReasons(lines, rowEnd);
    for (const row of run.rows) if (row.result === '実行不能' && reasons.has(row.tc)) row.reason = reasons.get(row.tc);
  }
  return run;
}

function readRuns(reader: Reader): RunRecord[] {
  const runs: RunRecord[] = [];
  for (const entry of reader.entries('runs') ?? []) {
    // Files directly under runs/ (README.md, <run>.compare.json) are not runs; links are not followed.
    if (!entry.isDirectory()) continue;
    const dir = 'runs/' + entry.name;
    const name = runDir.exec(entry.name);
    if (!name) {
      if (!entry.name.startsWith('.')) reader.problem('run-dir', dir, undefined, 'run のディレクトリ名が「YYYYMMDD-run-id」ではありません。');
      continue;
    }
    const run = readRun(reader, dir, name[1], name[2]);
    if (run) runs.push(run);
  }
  return runs.sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0);
}

export function readQaRepository(root: string): QaRepository {
  const reader = new Reader(root);
  const acceptance = readAcceptance(reader);
  const cases = readCases(reader);
  const runs = readRuns(reader);
  return {acceptance, cases, runs, problems: reader.problems};
}
