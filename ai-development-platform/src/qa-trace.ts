import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { checked } from './files.js';
import { readQaRepository, type QaRepository, type RunRecord, type RunRow } from './qa-trace-parse.js';

/**
 * Checks the links AC → TC → run result → Issue → fix check of a QA repository for `aidev qa trace`. Reads only;
 * nothing is written and no service is asked. The report carries IDs, results, issue numbers and run directories,
 * never the free text of result.md.
 */

export interface TraceFinding { level: 'error' | 'warning'; code: string; message: string; ac?: string; tc?: string; issue?: number; file?: string; line?: number }
export type IssueStatus = '確認済み' | '未確認' | '効いていない' | '要確認';
export interface TraceReport {
  acs: number; cases: number; runs: number;
  coverage: { ac: string; cases: string[]; latest: { tc: string; result: string; run: string; issues: number[] }[] }[];
  issues: { number: number; tcs: string[]; status: IssueStatus; fixRun?: string }[];
  findings: TraceFinding[];
}

/** Parser problems that make the trace untrustworthy. The other problems are warnings. */
const errorProblems = new Set(['missing-acceptance', 'missing-cases', 'unreadable']);
const duplicateProblems = new Set(['duplicate-acceptance', 'duplicate-case']);

const resultFile = (run: RunRecord) => run.dir + '/result.md';

function parserFindings(repo: QaRepository): TraceFinding[] {
  return repo.problems.map(problem => {
    const finding: TraceFinding = duplicateProblems.has(problem.code)
      ? {level: 'error', code: 'duplicate-id', message: problem.message}
      : {level: errorProblems.has(problem.code) ? 'error' : 'warning', code: problem.code, message: problem.message};
    if (duplicateProblems.has(problem.code)) {
      const id = /^((?:AC|TC)-\S+?) (?:が|は)/.exec(problem.message)?.[1];
      if (id?.startsWith('AC-')) finding.ac = id;
      else if (id) finding.tc = id;
    }
    finding.file = problem.file;
    if (problem.line !== undefined) finding.line = problem.line;
    return finding;
  });
}

export function traceQaRepository(root: string): TraceReport {
  const repo = readQaRepository(root);
  const findings = parserFindings(repo);
  const acIds = new Set(repo.acceptance.map(item => item.id));
  const caseIds = new Set(repo.cases.map(item => item.id));
  const caseOrder = new Map(repo.cases.map((item, index) => [item.id, index]));

  // Runs come sorted by date and run-id, so the last row of a TC is its latest result.
  const latest = new Map<string, {row: RunRow; run: RunRecord}>();
  const ran = new Set<string>();
  for (const run of repo.runs) for (const row of run.rows) { latest.set(row.tc, {row, run}); ran.add(row.tc); }

  const coverage = repo.acceptance.map(ac => {
    const cases = repo.cases.filter(item => item.acs.includes(ac.id)).map(item => item.id);
    return {ac: ac.id, cases, latest: cases.flatMap(tc => {
      const found = latest.get(tc);
      return found ? [{tc, result: found.row.result, run: found.run.dir, issues: [...found.row.issues]}] : [];
    })};
  });

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
        tc, file: resultFile(run)});
    }
    if (row.result === '実行不能' && !row.reason) {
      findings.push({level: 'error', code: 'blocked-without-reason',
        message: tc + ' の最新の結果は実行不能ですが、「実行不能の理由」に理由がありません。', tc, file: resultFile(run)});
    }
  }
  for (const item of repo.cases) {
    if (ran.has(item.id)) continue;
    findings.push({level: 'warning', code: 'case-not-run', message: item.id + ' はどの run にも出てきません。', tc: item.id,
      file: item.file, line: item.line});
  }
  for (const run of repo.runs) for (const row of run.rows) {
    if (caseIds.has(row.tc)) continue;
    findings.push({level: 'warning', code: 'run-unknown-tc', message: row.tc + ' は cases/ にないケースです。', tc: row.tc, file: resultFile(run)});
  }

  const issues = traceIssues(repo, caseOrder);
  for (const issue of issues) {
    if (issue.status === '確認済み') continue;
    const message = '#' + issue.number + ' は' + (issue.status === '未確認' ? '改修確認の run がありません。' :
      issue.status === '要確認' ? '改修確認の結果が要確認です。' : '改修確認で修正が効いていないとされました。');
    const finding: TraceFinding = {level: 'warning', code: 'issue-unconfirmed', message, issue: issue.number};
    if (issue.fixRun) finding.file = issue.fixRun + '/result.md';
    findings.push(finding);
  }
  return {acs: repo.acceptance.length, cases: repo.cases.length, runs: repo.runs.length, coverage, issues, findings};
}

function traceIssues(repo: QaRepository, caseOrder: Map<string, number>): TraceReport['issues'] {
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
    if (!check) return {number, tcs: list, status: '未確認' as IssueStatus};
    let status = check.verdict;
    // An NG of one of the issue's TCs after a confirming run reopens it.
    if (status === '確認済み' && repo.runs.slice(check.index + 1).some(run => run.rows.some(row => row.result === 'NG' && list.includes(row.tc)))) {
      status = '要確認';
    }
    return {number, tcs: list, status, fixRun: repo.runs[check.index].dir};
  });
}

/** `DIR` of `aidev qa trace`, relative to the working directory: `.`, `./qa` and `qa/` are accepted, links and `..` are not. */
export function traceDirectory(root: string, dir: string): string {
  if (isAbsolute(dir) || /^[A-Za-z]:/.test(dir)) throw new Error('絶対パスは使用できません。');
  const trimmed = dir.replace(/^(?:\.[\\/]+)+/, '').replace(/[\\/]+$/, '');
  const path = trimmed === '' || trimmed === '.' ? root : checked(root, trimmed);
  if (!lstatSync(path, {throwIfNoEntry: false})?.isDirectory()) throw new Error('DIR に QA リポジトリのディレクトリがありません。');
  return path;
}
