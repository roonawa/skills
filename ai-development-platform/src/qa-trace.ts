import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { checked } from './files.js';
import { readQaRepository, type FixVerdict, type QaRepository, type RunRecord, type RunRow } from './qa-trace-parse.js';

/**
 * Checks the links AC → TC → run result → Issue → fix check of a QA repository for `aidev qa trace`. Reads only;
 * nothing is written and no service is asked. The report carries IDs, results, issue numbers and run directories,
 * never the free text of result.md.
 */

export interface TraceFinding { level: 'error' | 'warning'; code: string; message: string; ac?: string; tc?: string; issue?: number; file?: string; line?: number }
export type IssueStatus = '確認済み' | '未確認' | '効いていない' | '要確認';
export type Execution = '自動' | '手動';
/**
 * One run in run order, counted from its own rows (every row of the run, not only the latest result of a TC).
 * `rows` are the rows of its result table in table order, with the TC-ID, the result and the issue numbers only:
 * the evidence, the reason of 実行不能 and every other free text stay out. The fix checks carry the issue and verdict
 * only; the note of 要確認 is free text and stays out.
 */
export interface RunDetail {
  dir: string; date: string; runId: string; environment?: string; version?: string;
  ok: number; ng: number; blocked: number; fixChecks: { issue: number; verdict: FixVerdict }[];
  rows: { tc: string; result: RunRow['result']; issues: number[] }[];
}
export interface TraceReport {
  acs: number; cases: number; runs: number;
  runDetails: RunDetail[];
  /**
   * Per AC: its TCs, the latest result of those that ran, and those that never ran. `execution` is the case's 実行
   * (absent when the case has no valid 実行 line). Every TC of `cases` is in exactly one of `latest` and `notRun`.
   */
  coverage: {
    ac: string; cases: string[];
    latest: { tc: string; result: string; run: string; issues: number[]; execution?: Execution }[];
    notRun: { tc: string; execution?: Execution }[];
  }[];
  issues: { number: number; tcs: string[]; status: IssueStatus; fixRun?: string }[];
  findings: TraceFinding[];
}

/**
 * Parser problems that make the trace untrustworthy: a file that could not be read, an AC line or a case heading
 * of the wrong form (the AC or the TC would be dropped silently), or a run whose results could not all be read (a
 * row of the wrong form, a row written twice, no result table, no result.md). The other problems (the form of a fix
 * check, a fix commit, the AC or 実行 of a case, a run folder with another name, ...) are warnings.
 */
const errorProblems = new Set(['missing-acceptance', 'missing-cases', 'unreadable', 'acceptance-line', 'case-heading',
  'run-row', 'run-tc', 'run-result', 'duplicate-run-row', 'no-result-table', 'missing-result']);
const duplicateProblems = new Set(['duplicate-acceptance', 'duplicate-case']);

const resultFile = (run: RunRecord) => run.dir + '/result.md';

function parserFindings(repo: QaRepository): TraceFinding[] {
  return repo.problems.map(problem => {
    const finding: TraceFinding = duplicateProblems.has(problem.code)
      ? {level: 'error', code: 'duplicate-id', message: problem.message}
      : {level: errorProblems.has(problem.code) ? 'error' : 'warning', code: problem.code, message: problem.message};
    if (duplicateProblems.has(problem.code) && problem.id) {
      if (problem.code === 'duplicate-acceptance') finding.ac = problem.id;
      else finding.tc = problem.id;
    }
    finding.file = problem.file;
    if (problem.line !== undefined) finding.line = problem.line;
    return finding;
  });
}

export function traceQaRepository(root: string): TraceReport {
  return traceRepository(readQaRepository(root));
}

/** The leading `YYYY-MM-DD HH:MM[:SS]` of 実行日時 as `YYYY-MM-DD HH:MM:SS`, or undefined. Anchored, so linear. */
function startOf(executedAt: string | undefined): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?::(\d{2}))?/.exec(executedAt ?? '');
  return match ? match[1] + ':' + (match[2] ?? '00') : undefined;
}

/**
 * Runs are ordered by date and then by run-id as a string, so the run-ids of one day must sort in the order the
 * runs were made. A warning for each pair of runs of one day (next to each other once the runs without a readable
 * start are left out) whose starts in 実行日時 are in the opposite order.
 */
function runOrderFindings(runs: RunRecord[]): TraceFinding[] {
  const findings: TraceFinding[] = [];
  let previous: {run: RunRecord; start: string} | undefined;
  for (const run of runs) {
    if (previous && previous.run.date !== run.date) previous = undefined;
    const start = startOf(run.executedAt);
    if (start === undefined) continue;
    if (previous && previous.start > start) {
      findings.push({level: 'warning', code: 'run-order', file: resultFile(run), message: previous.run.dir + ' と ' + run.dir +
        ' は同じ日の run ですが、実行日時の順が run-id の順と逆です。最新の結果は run-id の順で決まります。同じ日の run は、実行した順に並ぶ run-id にしてください。'});
    }
    previous = {run, start};
  }
  return findings;
}

/** The trace of a repository already read, so that the CLI reads the repository once for the JSON and the HTML. */
export function traceRepository(repo: QaRepository): TraceReport {
  const findings = parserFindings(repo);
  const acIds = new Set(repo.acceptance.map(item => item.id));
  const caseIds = new Set(repo.cases.map(item => item.id));
  const caseOrder = new Map(repo.cases.map((item, index) => [item.id, index]));

  // Runs come sorted by date and run-id, so the last row of a TC is its latest result.
  const latest = new Map<string, {row: RunRow; run: RunRecord}>();
  const ran = new Set<string>();
  for (const run of repo.runs) for (const row of run.rows) { latest.set(row.tc, {row, run}); ran.add(row.tc); }

  const coverage: TraceReport['coverage'] = repo.acceptance.map(ac => {
    const linked = repo.cases.filter(item => item.acs.includes(ac.id));
    const entry: TraceReport['coverage'][number] = {ac: ac.id, cases: linked.map(item => item.id), latest: [], notRun: []};
    for (const item of linked) {
      const found = latest.get(item.id);
      const extra = {...(item.priority ? {priority: item.priority} : {}), ...(item.execution ? {execution: item.execution} : {})};
      if (found) entry.latest.push({tc: item.id, result: found.row.result, run: found.run.dir, issues: [...found.row.issues], ...extra});
      else entry.notRun.push({tc: item.id, ...extra});
    }
    return entry;
  });
  const runDetails = repo.runs.map((run): RunDetail => {
    const count = (result: RunRow['result']) => run.rows.filter(row => row.result === result).length;
    return {dir: run.dir, date: run.date, runId: run.runId,
      ...(run.environment !== undefined ? {environment: run.environment} : {}), ...(run.version !== undefined ? {version: run.version} : {}),
      ok: count('OK'), ng: count('NG'), blocked: count('実行不能'),
      fixChecks: run.fixChecks.map(check => ({issue: check.issue, verdict: check.verdict})),
      rows: run.rows.map(row => ({tc: row.tc, result: row.result, issues: [...row.issues]}))};
  });
  findings.push(...runOrderFindings(repo.runs));

  for (const item of coverage) {
    if (item.cases.length) continue;
    const ac = repo.acceptance.find(entry => entry.id === item.ac)!;
    findings.push({level: 'error', code: 'ac-uncovered', message: item.ac + ' を参照する TC がありません。', ac: item.ac,
      file: 'plan/acceptance.md', line: ac.line});
  }
  for (const item of repo.cases) for (const ac of item.acs) {
    if (acIds.has(ac)) continue;
    findings.push({level: 'error', code: 'tc-unknown-ac', message: item.id + ' が plan/acceptance.md にない ' + ac + ' を参照しています。',
      ac, tc: item.id, file: item.file, line: item.line});
  }
  for (const [tc, {row, run}] of latest) {
    if (row.result === 'NG' && !row.issues.length) {
      findings.push({level: 'error', code: 'ng-without-issue', message: tc + ' の最新の結果は NG ですが、Issue の列が空です。',
        tc, file: resultFile(run), line: row.line});
    }
    if (row.result === '実行不能' && !row.reason) {
      findings.push({level: 'error', code: 'blocked-without-reason',
        message: tc + ' の最新の結果は実行不能ですが、「実行不能の理由」に理由がありません。', tc, file: resultFile(run), line: row.line});
    }
  }
  for (const item of repo.cases) {
    if (ran.has(item.id)) continue;
    findings.push({level: 'warning', code: 'case-not-run', message: item.id + ' はどの run にも出てきません。', tc: item.id,
      file: item.file, line: item.line});
  }
  for (const run of repo.runs) for (const row of run.rows) {
    if (caseIds.has(row.tc)) continue;
    findings.push({level: 'warning', code: 'run-unknown-tc', message: row.tc + ' は cases/ にないケースです。', tc: row.tc, file: resultFile(run),
      line: row.line});
  }

  const traced = traceIssues(repo, caseOrder);
  for (const {issue, reopen} of traced) {
    if (issue.status === '確認済み') continue;
    const head = '#' + issue.number + ' は';
    let finding: TraceFinding;
    if (reopen) {
      // Confirmed by a fix check, then an NG of one of its TCs: point at that NG row.
      const where = reopen.run.dir === issue.fixRun ? '確認済みとされていますが、同じ run で ' : '確認済みですが、その後の ' + reopen.run.dir + ' で ';
      finding = {level: 'warning', code: 'issue-unconfirmed', message: head + ' ' + issue.fixRun + ' で' + where + reopen.row.tc + ' が NG です。',
        issue: issue.number, tc: reopen.row.tc, file: resultFile(reopen.run), line: reopen.row.line};
    } else {
      const message = head + (issue.status === '未確認' ? '改修確認の run がありません。' :
        issue.status === '要確認' ? ' ' + issue.fixRun + ' の改修確認の結果が要確認です。' : ' ' + issue.fixRun + ' の改修確認で、修正が効いていないとされました。');
      finding = {level: 'warning', code: 'issue-unconfirmed', message, issue: issue.number};
      if (issue.fixRun) finding.file = issue.fixRun + '/result.md';
    }
    findings.push(finding);
  }
  const issues = traced.map(item => item.issue);
  return {acs: repo.acceptance.length, cases: repo.cases.length, runs: repo.runs.length, runDetails, coverage, issues, findings};
}

type TracedIssue = TraceReport['issues'][number];

/**
 * The status of every issue, with the reason when a confirmed issue was reopened: the first NG row of one of its
 * TCs in the confirming run itself or in a later run.
 */
function traceIssues(repo: QaRepository, caseOrder: Map<string, number>): {issue: TracedIssue; reopen?: {run: RunRecord; row: RunRow}}[] {
  const tcs = new Map<number, string[]>();
  const fix = new Map<number, {index: number; verdict: IssueStatus}>();
  repo.runs.forEach((run, index) => {
    for (const row of run.rows) for (const number of row.issues) {
      const list = tcs.get(number) ?? [];
      if (!list.includes(row.tc)) list.push(row.tc);
      tcs.set(number, list);
    }
    // Runs are in order, so the last fix check of an issue wins.
    for (const check of run.fixChecks) fix.set(check.issue, {index, verdict: check.verdict});
  });
  const order = (tc: string) => caseOrder.get(tc) ?? Number.MAX_SAFE_INTEGER;
  const numbers = [...new Set([...tcs.keys(), ...fix.keys()])].sort((a, b) => a - b);
  return numbers.map(number => {
    const list = [...(tcs.get(number) ?? [])].sort((a, b) => order(a) - order(b));
    const check = fix.get(number);
    if (!check) return {issue: {number, tcs: list, status: '未確認' as IssueStatus}};
    const fixRun = repo.runs[check.index].dir;
    if (check.verdict !== '確認済み') return {issue: {number, tcs: list, status: check.verdict, fixRun}};
    // An NG of one of the issue's TCs in the confirming run itself or after it reopens the issue. The NG may name
    // another issue: the TC that confirmed the fix fails again either way.
    for (const run of repo.runs.slice(check.index)) {
      const row = run.rows.find(item => item.result === 'NG' && list.includes(item.tc));
      if (row) return {issue: {number, tcs: list, status: '要確認' as IssueStatus, fixRun}, reopen: {run, row}};
    }
    return {issue: {number, tcs: list, status: '確認済み' as IssueStatus, fixRun}};
  });
}

/** `DIR` of `aidev qa trace`, relative to the working directory: `.`, `./qa` and `qa/` are accepted, links and `..` are not. */
export function traceDirectory(root: string, dir: string): string {
  if (!dir.trim()) throw new Error('DIR に QA リポジトリのディレクトリを指定してください。');
  if (isAbsolute(dir) || /^[A-Za-z]:/.test(dir)) throw new Error('絶対パスは使用できません。');
  // Trailing separators are cut with a loop: /[\\/]+$/ takes quadratic time on a long run of separators.
  let end = dir.length;
  while (end > 0 && (dir[end - 1] === '/' || dir[end - 1] === '\\')) end--;
  const trimmed = dir.slice(0, end).replace(/^(?:\.[\\/]+)+/, '');
  const path = trimmed === '' || trimmed === '.' ? root : checked(root, trimmed);
  if (!lstatSync(path, {throwIfNoEntry: false})?.isDirectory()) throw new Error('DIR に QA リポジトリのディレクトリがありません。');
  return path;
}
