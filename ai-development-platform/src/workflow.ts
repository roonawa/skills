import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { checkProject, type CheckResult } from './adapter.js';
import { checked, content, safeName } from './files.js';
import { readConfig } from './project.js';
import { captureGuard, CONFIG_PREFIX } from './repair-guard.js';
import { findingFingerprint, parseFinding, type RecordedFinding } from './review.js';

type RecordedCheck = Pick<CheckResult, 'name' | 'status'> & {fingerprint?: string; findings?: RecordedFinding[]};
interface WorkflowResult {
  task: string;
  // needs-human: the automatic loop has ended and a person must decide before work continues.
  state: 'repair' | 'review' | 'needs-human';
  reason: string;
  attempts: number;
  checks: RecordedCheck[];
  exitCode: number;
  handoff?: string;
}
type Attempt = {attempts: number; checks: RecordedCheck[]};
const limit = 3;
// Version 2 baselines also record check settings, so a newly added setting file stops the task.
const guardVersion = 2;
const hex = /^[a-f0-9]{64}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const runDirectory = (task: string) => '.aidev/runs/' + safeName(task);
// Review gates are compared finding by finding: one unresolved finding means the same failure came back.
const failureKeys = (check: RecordedCheck) => check.findings ? check.findings.map(f => f.fingerprint) : [check.fingerprint!];

function summarize(check: CheckResult): RecordedCheck {
  const {name, status} = check;
  if (status !== 'failed') return {name, status};
  if (check.findings?.length) {
    const findings = check.findings.map(finding => ({...finding, fingerprint:findingFingerprint(name, finding)}));
    return {name, status, fingerprint:hash(JSON.stringify([name, findings.map(f => f.fingerprint).sort()])), findings};
  }
  return {name, status, fingerprint:hash(JSON.stringify([name, check.fingerprint ?? check.detail ?? '']))};
}

function escalate(task: string, attempts: number, checks: RecordedCheck[], reason: string, exitCode: number): WorkflowResult {
  return {task, attempts, checks, state:'needs-human', reason, exitCode, handoff:runDirectory(task) + '/handoff.md'};
}

function decide(task: string, attempts: number, checks: RecordedCheck[], previous: Set<string>): WorkflowResult {
  if (!checks.length || checks.some(check => check.status === 'unavailable')) {
    return escalate(task, attempts, checks, 'checks-unavailable', 2);
  }
  const failed = checks.filter(check => check.status === 'failed');
  if (!failed.length) return {task, attempts, checks, state:'review', reason:'checks-passed', exitCode:0};
  // The same failure stops at once; failures with other causes continue until the third repair.
  if (failed.some(check => failureKeys(check).some(key => previous.has(key)))) {
    return escalate(task, attempts, checks, 'repeated-failure', 1);
  }
  if (attempts >= limit) return escalate(task, attempts, checks, 'repair-limit', 1);
  return {task, attempts, checks, state:'repair', reason:'repair-needed', exitCode:1};
}

function readFindings(name: string, value: unknown): RecordedFinding[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length) throw new Error();
  return value.map(item => {
    const {fingerprint, ...finding} = item ?? {};
    if (typeof fingerprint !== 'string' || !hex.test(fingerprint)) throw new Error();
    return {...parseFinding(name, finding), fingerprint};
  });
}

function readRecord(record: string) {
  try {
    const {checks, guard, reason, guardVersion: version} = JSON.parse(record);
    if (!Array.isArray(checks)) throw new Error();
    if (guard !== undefined && (!Array.isArray(guard) || guard.some(item => typeof item !== 'string'))) throw new Error();
    const safeChecks: RecordedCheck[] = checks.map(check => {
      if (typeof check?.name !== 'string') throw new Error();
      const {name, status, fingerprint} = check;
      if (status === 'passed' || status === 'unavailable') return {name, status};
      if (status !== 'failed' || typeof fingerprint !== 'string' || !hex.test(fingerprint)) throw new Error();
      const findings = readFindings(name, check.findings);
      return findings ? {name, status, fingerprint, findings} : {name, status, fingerprint};
    });
    if (version !== undefined && version !== guardVersion) throw new Error();
    return {checks:safeChecks, guard:guard as string[] | undefined, guardVersion:version as number | undefined,
      protectedChange:reason === 'protected-check-changed'};
  } catch {
    throw new Error('ワークフローの実行記録を読み取れません。');
  }
}

function readHistory(root: string, task: string) {
  const base = runDirectory(task);
  const previous = new Set<string>();
  const history: Attempt[] = [];
  let latest: WorkflowResult | undefined;
  let baseline: string[] = [];
  let detectAdditions = false;
  for (let attempts = 0; attempts <= limit; attempts++) {
    const path = base + '/' + attempts;
    const saved = checked(root, path + '.json');
    const info = lstatSync(saved, {throwIfNoEntry:false});
    if (!info) break;
    if (!info.isFile()) throw new Error('ワークフローの記録には通常ファイルが必要です。');
    // The baseline can exceed the size limit used for individual template files.
    const record = readRecord(readFileSync(saved, 'utf8'));
    if (attempts === 0) {
      if (!record.guard) throw new Error('初回の保護対象の記録がありません。');
      baseline = record.guard;
      detectAdditions = record.guardVersion === guardVersion;
    }
    latest = record.protectedChange ? guardStop(task, attempts) : decide(task, attempts, record.checks, previous);
    history.push({attempts, checks:latest.checks});
    if (latest.state !== 'repair') break;
    for (const check of latest.checks) if (check.status === 'failed') for (const key of failureKeys(check)) previous.add(key);
  }
  return {base, previous, latest, baseline, detectAdditions, history};
}

function guardStop(task: string, attempts: number): WorkflowResult {
  return escalate(task, attempts, [], 'protected-check-changed', 1);
}

const reasonText: Record<string, string> = {
  'repeated-failure': '同じ失敗が再発したため、修正3回を待たずに自動の差し戻しを止めました。',
  'repair-limit': '実装への差し戻しを3回繰り返しても、ゲートを通過できませんでした。',
  'checks-unavailable': '検査を実行できませんでした（依存未導入・環境不足・タイムアウトなど）。',
  'protected-check-changed': 'テストファイルの消失、または検査スクリプト・検査設定の変更を検出しました。',
};
const gateText: Record<string, string> = {security:'セキュリティ', spec:'仕様乖離・過剰実装'};
const statusText = {passed:'通過', failed:'失敗', unavailable:'実行不能'};
const kindText = {deviation:'仕様乖離', excess:'過剰実装'};

function handoffText(result: WorkflowResult, history: Attempt[]): string {
  const lines = [
    '# 人の確認が必要なタスク: ' + result.task, '',
    '- 理由: ' + result.reason + '。' + (reasonText[result.reason] ?? ''),
    '- 修正回数: ' + result.attempts + '回（人の確認なしで差し戻すのは最大3回）',
    '- 再開: 担当者が下記を確認して対応方針を決め、新しいタスク名で workflow check を始める', '',
    '## 試行ごとのゲート結果',
  ];
  for (const {attempts, checks} of history) {
    lines.push('', '### ' + (attempts ? '修正' + attempts + '回目の後' : '初回の実装後'));
    if (!checks.length) lines.push('- 検査を実行していません（保護対象の変更を検出）');
    for (const check of checks) {
      lines.push('- ' + (gateText[check.name] ?? check.name) + ': ' + statusText[check.status]);
      for (const finding of check.findings ?? []) {
        const kind = finding.kind ? kindText[finding.kind] + ' ' : '';
        lines.push('  - [' + kind + finding.ref + '] ' + finding.file + ': ' + finding.summary);
      }
    }
  }
  lines.push('', '## 担当者が判断すること',
    '- 残る失敗・指摘への対応方針（実装の修正、仕様の確認・変更、設計の見直し）',
    '- 試したことと残る仮説は、AI の引き継ぎ報告で確認する',
    '- 検査の除外・下限・設定の変更が必要な場合は、その要否と代替の確認手段');
  return lines.join('\n') + '\n';
}

/** Writes the handoff once. An existing file is kept so that a person's notes are never overwritten. */
function writeHandoff(root: string, result: WorkflowResult, history: Attempt[]): void {
  if (!result.handoff || content(checked(root, result.handoff)) !== undefined) return;
  const pending = result.handoff + '.pending';
  writeFileSync(checked(root, pending), handoffText(result, history), {flag:'w', flush:true});
  renameSync(checked(root, pending), checked(root, result.handoff));
}

export function readWorkflowStatus(root: string, task: string): WorkflowResult & {pendingAttempt?:number} {
  const {base, latest} = readHistory(root, task);
  const next = latest ? latest.attempts + 1 : 0;
  if ((!latest || latest.state === 'repair') && content(checked(root, base + '/' + next + '.claim')) !== undefined) {
    if (!latest) throw new Error('初回検査は実行中、または中断されました。完了記録はありません。');
    return {...latest, pendingAttempt:next};
  }
  if (!latest) throw new Error('実行記録がありません。workflow check でタスクを開始してください。');
  return latest;
}

/**
 * Runs one gate pass: the application checks (type check, lint, unit tests, coverage, build) plus the
 * AI review gates (security, spec) given in `review`. Failing gates send the task back to implementation
 * up to three times without a person; after that, or on a repeated failure, the task goes to a person.
 */
export async function runWorkflow(root: string, task: string, run?: () => CheckResult[] | Promise<CheckResult[]>,
    review: CheckResult[] = []): Promise<WorkflowResult> {
  const {base, previous, latest, baseline, detectAdditions, history} = readHistory(root, task);
  if (latest && latest.state !== 'repair') {
    // Tasks stopped before handoffs existed, or interrupted before writing one, get it on the next call.
    writeHandoff(root, latest, history);
    return latest;
  }
  const attempts = latest ? latest.attempts + 1 : 0;
  const path = base + '/' + attempts;
  const template = run ? undefined : readConfig(root).template;
  mkdirSync(checked(root, base), {recursive:true});
  // Permanent claims prevent reusing a repair slot after interruption.
  try {
    writeFileSync(checked(root, path + '.claim'), String(process.pid), {flag:'wx',flush:true});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error('このタスクは実行中、または結果の保存前に中断されました。');
  }
  let result: WorkflowResult;
  let guard: string[] = [];
  try {
    guard = captureGuard(root);
    const active = new Set(guard);
    const initial = new Set(baseline);
    const addedConfig = attempts > 0 && detectAdditions &&
      guard.some(entry => entry.startsWith(CONFIG_PREFIX) && !initial.has(entry));
    if (baseline.some(entry => !active.has(entry)) || addedConfig) {
      result = guardStop(task, attempts);
    } else {
      const observed = [...(run ? await run() : (await checkProject(template!, root)).checks), ...review];
      result = decide(task, attempts, observed.map(summarize), previous);
    }
  } catch {
    result = decide(task, attempts, [{name:'application', status:'unavailable'}], previous);
  }
  const record = attempts === 0 ? {...result, guard, guardVersion} : result;
  const pending = path + '.pending';
  writeFileSync(checked(root, pending), JSON.stringify(record) + '\n', {flag:'wx',flush:true});
  renameSync(checked(root, pending), checked(root, path + '.json'));
  writeHandoff(root, result, [...history, {attempts, checks:result.checks}]);
  return result;
}
