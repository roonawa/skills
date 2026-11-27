#!/usr/bin/env node
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChubClient, findBoard, loadChubConfig, redact, ChubError,
  type ChubClient, type ChubConfig, type ChubTask, type Transport } from './chub.js';
import { checkSpecText } from './spec.js';
import { checked } from './files.js';
import { createRunRecords, isTaskName, taskNameOf, type RunRecord, type RunRecords, type RunResult } from './run-records.js';
import { claudeRunner, runLoop, sessionOptions, type LoopResult } from './loop.js';
import { createGiteaRunnerClient, GiteaError, type GiteaTransport } from './gitea.js';
import { createGiteaWorkspace, WorkspaceError } from './workspace.js';
import { createDigestNotifier, NotifyError, type DigestTransport } from './notify.js';

/**
 * Unattended runner (docs/autonomous-runner-design.md 5). The runner only reads C-HUB: its key has no write scope,
 * and the client it uses has no write function. Results go to Gitea (a pull request) and to a notification;
 * a person moves the card. Which task versions were handled is kept in run records on the runner host (5.2, 5.6).
 */
export interface Reason {code: string; message: string}
export interface Request {repository?: string; baseBranch?: string; acceptanceIds: string[]}
export interface TaskDecision {
  id: string;
  title: string;
  board: string;
  createdAt: string | null;
  /** aidev task name `<task ID>-<description version>`, or null when the ID cannot form one. */
  taskName: string | null;
  eligible: boolean;
  reasons: Reason[];
  repository: string | null;
  baseBranch: string | null;
  acceptanceIds: string[];
}

const keyPattern = /^\s*(対象リポジトリ|基準ブランチ|受け入れ条件|やらないこと|参考|再実行)\s*[:：]\s*(.*)$/;
const acPattern = /^\s*[-*・]\s*(AC-\d{1,6})\s*[:：]\s*\S/;

/** Reads the request template (5.3) from a task description. The text is data; nothing in it is executed. */
export function parseRequest(description: string): Request {
  const result: Request = {acceptanceIds: []};
  let current = '';
  for (const line of description.replace(/\r\n?/g, '\n').split('\n')) {
    const key = keyPattern.exec(line);
    if (key) {
      current = key[1];
      const value = key[2].trim();
      if (current === '対象リポジトリ' && value && result.repository === undefined) result.repository = value;
      if (current === '基準ブランチ' && value && result.baseBranch === undefined) result.baseBranch = value;
      continue;
    }
    if (current === '受け入れ条件') {
      const ac = acPattern.exec(line);
      if (ac && !result.acceptanceIds.includes(ac[1])) result.acceptanceIds.push(ac[1]);
    }
  }
  return result;
}

// Each part starts with a letter, digit, "_" or "-", so "." and ".." are rejected.
const repositoryPattern = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/;
// Conservative subset of git ref names: no "..", no leading "-" or "/", no trailing "/" or ".lock".
const branchPattern = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!\/)(?!.*\/$)(?!.*\.lock$)[A-Za-z0-9._/-]{1,100}$/;
// The acceptance section itself is checked by missing-acceptance; these spec errors would only repeat it.
const coveredSpecErrors = new Set(['missing-acceptance-section', 'no-criteria']);

const description = (task: ChubTask) => typeof task.description === 'string' ? task.description : '';

/** Applies the start conditions of 5.2 to one task, including the specification check of `aidev spec check`. */
export function decide(task: ChubTask, board: string, allowedRepositories: string[]): TaskDecision {
  const text = description(task);
  const request = parseRequest(text);
  const reasons: Reason[] = [];
  const add = (code: string, message: string) => reasons.push({code, message});
  if (!request.repository) add('missing-repository', '依頼テンプレートの「対象リポジトリ」がありません。');
  else if (!repositoryPattern.test(request.repository)) add('invalid-repository', '対象リポジトリは org/repo の形で書いてください。');
  else if (!allowedRepositories.includes(request.repository)) add('repository-not-allowed', '対象リポジトリがランナー設定の許可リストにありません。');
  if (!request.baseBranch) add('missing-base-branch', '依頼テンプレートの「基準ブランチ」がありません。');
  else if (!branchPattern.test(request.baseBranch)) add('invalid-base-branch', '基準ブランチの名前に使えない文字が含まれています。');
  if (request.acceptanceIds.length === 0) add('missing-acceptance', '「受け入れ条件」に AC-ID（例: - AC-001: ...）が1件もありません。');
  for (const issue of checkSpecText('task', text).errors) {
    if (!coveredSpecErrors.has(issue.code)) add('spec-' + issue.code, issue.message);
  }
  const name = taskNameOf(task.id, text);
  if (!isTaskName(name)) add('invalid-task-id', 'タスク ID が aidev のタスク名の規則に合いません（小文字・数字・ハイフンで55文字まで）。');
  return {
    id: task.id,
    title: typeof task.title === 'string' ? task.title : '',
    board,
    createdAt: typeof task.created_at === 'string' ? task.created_at : null,
    taskName: isTaskName(name) ? name : null,
    eligible: reasons.length === 0,
    reasons,
    repository: request.repository ?? null,
    baseBranch: request.baseBranch ?? null,
    acceptanceIds: request.acceptanceIds,
  };
}

export interface BoardReport {name: string; found: boolean; readySection: boolean; readyCount: number}
interface Scanned {decision: TaskDecision; description: string}

const created = (task: ChubTask) => typeof task.created_at === 'string' ? task.created_at : '';

/** Reads the ready section of every board, oldest task first, with each description read from the single task. */
async function scan(client: ChubClient, config: ChubConfig): Promise<{boards: BoardReport[]; tasks: Scanned[]}> {
  if (!config.boards.length) throw new ChubError('設定の boards に対象ボードを1件以上指定してください。');
  const boards: BoardReport[] = [];
  const tasks: Scanned[] = [];
  for (const name of config.boards) {
    const project = await findBoard(client, name);
    if (!project) {
      boards.push({name, found: false, readySection: false, readyCount: 0});
      continue;
    }
    const ready = (await client.listSections(project.id)).find(section => section.name === config.sections.ready);
    const readyTasks = ready ? (await client.listTasks(project.id))
      .filter(task => String(task.section_id) === ready.id).sort((a, b) => created(a).localeCompare(created(b))) : [];
    boards.push({name, found: true, readySection: Boolean(ready), readyCount: readyTasks.length});
    for (const summary of readyTasks) {
      // 5.2: the list is a summary; the description is read from the single task.
      const task = await client.getTask(summary.id);
      const decision = decide(task, name, config.allowedRepositories);
      if (String(task.section_id) !== ready?.id) {
        decision.eligible = false;
        decision.reasons.push({code: 'section-changed', message: '読み取り中に別のセクションへ移されました。'});
      }
      tasks.push({decision, description: description(task)});
    }
  }
  tasks.sort((a, b) => (a.decision.createdAt ?? '').localeCompare(b.decision.createdAt ?? ''));
  return {boards, tasks};
}

/** A run record without a result: the previous run stopped before saving it (5.6). */
const unfinished = (records: RunRecords | undefined) => (records?.list() ?? []).filter(record => !record.result);
const interruptedEntry = (record: RunRecord) => ({taskName: record.name, taskId: record.taskId, board: record.board});

export interface DryRunReport {
  dryRun: true;
  boards: BoardReport[];
  tasks: (TaskDecision & {processed: boolean})[];
  /** Task the runner would take first (oldest eligible and not yet processed), or null. */
  next: string | null;
  /** Runs that stopped before their result was recorded. The real run reports and closes them. */
  interrupted: {taskName: string; taskId: string; board: string}[];
}

export async function dryRun(client: ChubClient, config: ChubConfig, records?: RunRecords): Promise<DryRunReport> {
  const {boards, tasks} = await scan(client, config);
  const listed = tasks.map(({decision}) => ({...decision,
    processed: Boolean(decision.taskName && records?.read(decision.taskName))}));
  return {dryRun: true, boards, tasks: listed,
    next: listed.find(task => task.eligible && !task.processed)?.id ?? null,
    interrupted: unfinished(records).map(interruptedEntry)};
}

/** What the runner needs besides C-HUB. Workspace and publishing are Gitea work (design 5.4, 5.5). */
export interface RunnerDeps {
  records: RunRecords;
  /** Checks out the base branch into a fresh directory and returns it. */
  prepareWorkspace(decision: TaskDecision & {taskName: string}): Promise<string>;
  /** Runs implementation, review and gates (aidev workflow run). */
  runLoop(root: string, taskName: string, spec: string): Promise<LoopResult>;
  /** Pushes the work branch and opens the pull request; returns its URL. */
  publish?(root: string, decision: TaskDecision & {taskName: string}, result: LoopResult): Promise<{url: string}>;
  /** Whether Gitea already has the work branch `aidev/<task name>` (a lost run record must not cause a second run). */
  branchExists?(repository: string, branch: string): Promise<boolean>;
  /**
   * Sends one notification with all messages of this run. Called on every start, also with no messages, so messages
   * held back by the daily limit go out on the next day. Failures are reported, not fatal: results stay in Gitea.
   */
  notify(messages: string[]): Promise<unknown>;
}

export interface RunReport {
  dryRun: false;
  boards: BoardReport[];
  /** The task version run this time, with its result, or null when nothing was eligible. */
  ran: {taskId: string; taskName: string; result: RunResult} | null;
  /** Ineligible task versions recorded as handled this time. */
  notEligible: {taskId: string; taskName: string; reasons: string[]}[];
  interrupted: {taskName: string; taskId: string; board: string}[];
  notifications: string[];
  notifyError?: string;
}

const label = (decision: TaskDecision) => decision.title + '（' + decision.id + '）';
/** The runner cannot move cards; every message says where the person should move it (design 5.5). */
const moveTo = (config: ChubConfig, state: string) =>
  ' カードを「' + (state === 'review' ? config.sections.review : config.sections.needsHuman) + '」へ移してください。';

/** aidev counts attempts from 0, so the last attempt's number is also the number of repairs before it. */
export const tries = (attempts: number | null | undefined) =>
  typeof attempts === 'number' ? (attempts + 1) + ' 回目で判定、差し戻し ' + attempts + ' 回' : '試行回数は不明';

/** Notification text comes from these templates only; AI output and review findings are never included (design 4). */
function resultMessage(decision: TaskDecision, result: RunResult): string {
  const pr = result.url ? ' PR: ' + result.url : '';
  if (result.state === 'review') return '【review】' + label(decision) + ': 全ゲート合格（' + tries(result.attempts) + '）。' + pr;
  if (result.state === 'needs-human' && result.reason === 'skills-missing') {
    return '【人の確認待ち】' + label(decision) + ': 対象リポジトリに aidev の Skill がないため実装しませんでした。' +
      'リポジトリで aidev skill add（aidev-implementation・aidev-testing・aidev-repair-workflow・aidev-code-review）を実行してから、' +
      '本文に「再実行: 2」のような行を足して戻してください。';
  }
  if (result.state === 'needs-human' && result.reason === 'ci-config-changed') {
    return '【人の確認待ち】' + label(decision) + ': 実装が CI の設定（.gitea・.github・.forgejo）を変えたため push していません。' +
      '作業はランナーの作業フォルダに残っています。';
  }
  if (result.state === 'needs-human') {
    return '【人の確認待ち】' + label(decision) + ': ' + result.reason + '（' + tries(result.attempts) + '）。引継ぎ票を確認してください。' + pr;
  }
  return '【実行不能】' + label(decision) + ': ' + result.reason + ' で止まりました。';
}

/** Processes interrupted runs, ineligible tasks and at most one eligible task, then sends one notification. */
export async function runOnce(client: ChubClient, config: ChubConfig, deps: RunnerDeps): Promise<{report: RunReport; exitCode: number}> {
  const messages: string[] = [];
  const interrupted = unfinished(deps.records);
  for (const record of interrupted) {
    deps.records.finish(record.name, {state: 'interrupted', reason: 'runner-interrupted'});
    messages.push('【中断】' + (record.title ? record.title + '（' + record.taskId + '）' : record.name) +
      ': 前回の実行が結果を記録する前に止まりました。同じ版は再実行しません。仕様を確認し、必要なら本文を直して戻してください。');
  }
  const {boards, tasks} = await scan(client, config);
  const notEligible: RunReport['notEligible'] = [];
  let chosen: (TaskDecision & {taskName: string}) | undefined;
  let chosenDescription = '';
  for (const {decision, description: text} of tasks) {
    const name = decision.taskName;
    if (!name || deps.records.read(name)) continue;
    if (decision.repository && decision.eligible && await deps.branchExists?.(decision.repository, 'aidev/' + name)) continue;
    const base = {name, taskId: decision.id, board: decision.board, title: decision.title};
    if (!decision.eligible) {
      if (!deps.records.start(base)) continue;
      const codes = decision.reasons.map(reason => reason.code);
      deps.records.finish(name, {state: 'not-eligible', reason: codes.join(',')});
      notEligible.push({taskId: decision.id, taskName: name, reasons: codes});
      messages.push('【着手条件不足】' + label(decision) + ': ' + decision.reasons.map(reason => reason.message).join(' ') +
        moveTo(config, 'not-eligible'));
      continue;
    }
    if (!chosen && deps.records.start(base)) {
      chosen = {...decision, taskName: name};
      chosenDescription = text;
    }
  }
  let ran: RunReport['ran'] = null;
  let exitCode = 0;
  if (chosen) {
    let stage = 'workspace';
    let result: RunResult;
    try {
      const root = await deps.prepareWorkspace(chosen);
      stage = 'spec';
      // The description is data for the implementation session; .aidev/ is protected from its edits.
      const spec = '.aidev/specs/' + chosen.taskName + '.md';
      const path = checked(root, spec);
      mkdirSync(dirname(path), {recursive: true});
      writeFileSync(path, chosenDescription.replace(/\r\n?/g, '\n'), {flush: true});
      stage = 'loop';
      const loop = await deps.runLoop(root, chosen.taskName, spec);
      result = {state: loop.state, reason: loop.reason, attempts: loop.attempts};
      if (deps.publish && (loop.state === 'review' || loop.state === 'needs-human')) {
        stage = 'publish';
        result.url = (await deps.publish(root, chosen, loop)).url;
      }
      if (loop.state !== 'review' && loop.state !== 'needs-human') exitCode = 1;
    } catch (error) {
      // A refusal to publish (a changed CI definition) is for a person to judge; nothing was pushed.
      const refusal = error instanceof WorkspaceError && error.reason && /^[a-z-]{1,40}$/.test(error.reason) ? error.reason : undefined;
      // Other error texts may carry paths or server replies; only the stage is recorded and notified.
      result = refusal ? {state: 'needs-human', reason: refusal} : {state: 'runner-error', reason: stage};
      if (!refusal) exitCode = 1;
    }
    deps.records.finish(chosen.taskName, result);
    ran = {taskId: chosen.id, taskName: chosen.taskName, result};
    messages.push(resultMessage(chosen, result) + moveTo(config, result.state));
  }
  const report: RunReport = {dryRun: false, boards, ran, notEligible, interrupted: interrupted.map(interruptedEntry), notifications: messages};
  try {
    await deps.notify(messages);
  } catch (error) {
    // NotifyError texts are fixed and carry no token or address.
    report.notifyError = (error instanceof NotifyError ? error.message + '。' : '') +
      '通知を送れませんでした。次の起動で送り直します。結果は実行記録と Gitea に残っています。';
  }
  return {report, exitCode};
}

const usage = '使用法: node dist/runner.js --dry-run [--config FILE] | --once [--config FILE]。' +
  '--once は1件を実行して PR を作り、相棒に通知します（設定の notify を false にすると通知を送らず、本文は出力にだけ出ます）。';

/** Gitea settings for --once: `gitea` in the configuration file, GITEA_URL and GITEA_TOKEN (the token only from the environment). */
function giteaSettings(file: string | undefined, env: NodeJS.ProcessEnv, stateDir: string) {
  let raw: Record<string, unknown> = {};
  if (file) {
    try {
      raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      throw new ChubError('設定ファイルを読めません。');
    }
  }
  const gitea = (typeof raw.gitea === 'object' && raw.gitea !== null ? raw.gitea : {}) as Record<string, unknown>;
  const baseUrl = String(env.GITEA_URL || gitea.baseUrl || '').trim().replace(/\/+$/, '');
  const token = String(env.GITEA_TOKEN || '').trim();
  if (!baseUrl) throw new ChubError('Gitea の接続先がありません（GITEA_URL または設定の gitea.baseUrl）。');
  if (!token) throw new ChubError('Gitea のトークンがありません（環境変数 GITEA_TOKEN）。設定ファイルには書かないでください。');
  if (raw.workDir !== undefined && (typeof raw.workDir !== 'string' || !isAbsolute(raw.workDir))) {
    throw new ChubError('設定の workDir はランナーのホスト上の絶対パスにしてください。');
  }
  const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const author = (typeof gitea.author === 'object' && gitea.author !== null ? gitea.author : {}) as Record<string, unknown>;
  if (raw.notify !== undefined && typeof raw.notify !== 'boolean') throw new ChubError('設定の notify は true か false にしてください。');
  return {baseUrl, token, workDir: (raw.workDir as string | undefined) ?? join(stateDir, 'work'),
    notify: raw.notify !== false,
    noRevocationCheck: gitea.noRevocationCheck === true,
    author: {name: text(author.name, 'aidev-runner'), email: text(author.email, 'aidev-runner@localhost')}};
}

export interface MainDeps {
  transport?: Transport;
  sleep?: (ms: number) => Promise<void>;
  giteaTransport?: GiteaTransport;
  /** Tests: clone URL of a repository (a local bare repository instead of Gitea). */
  remoteUrl?: (repository: string) => string;
  /** Tests: replaces the Claude Code sessions. */
  runLoop?: RunnerDeps['runLoop'];
  notify?: RunnerDeps['notify'];
  /** Tests: replaces the POST of the buddy notification. */
  digestTransport?: DigestTransport;
  now?: () => Date;
}

/** Entry point used by the command line and the tests. Returns the JSON line and the exit code. */
export async function main(args: string[], env: NodeJS.ProcessEnv, deps: MainDeps = {}): Promise<{output: string; exitCode: number}> {
  // The Gitea address is not hidden: the pull request URL in the output contains it.
  let secrets: (string | undefined)[] = [env.CHUB_TOKEN, env.CHUB_BASE_URL, env.GITEA_TOKEN];
  const once = args.includes('--once');
  try {
    const configIndex = args.indexOf('--config');
    const file = configIndex >= 0 ? args[configIndex + 1] : env.AIDEV_CHUB_CONFIG;
    const known = args.every((arg, index) => arg === '--dry-run' || arg === '--once' || arg === '--config' ||
      index === configIndex + 1 && configIndex >= 0);
    if (args.includes('--dry-run') === once || !known || (configIndex >= 0 && !file)) throw new ChubError(usage);
    const config = loadChubConfig(file, env);
    secrets = [config.token, config.baseUrl, new URL(config.baseUrl).host, ...secrets];
    const client = createChubClient({baseUrl: config.baseUrl, token: config.token, transport: deps.transport, sleep: deps.sleep});
    if (!once) {
      const records = config.stateDir ? createRunRecords(config.stateDir) : undefined;
      return {output: redact(JSON.stringify({ok: true, ...await dryRun(client, config, records)}), secrets), exitCode: 0};
    }
    if (!config.stateDir) throw new ChubError('--once には設定の stateDir（実行記録の場所）が必要です。');
    const gitea = giteaSettings(file, env, config.stateDir);
    secrets = [gitea.token, ...secrets];
    const giteaClient = createGiteaRunnerClient({baseUrl: gitea.baseUrl, token: gitea.token, transport: deps.giteaTransport});
    const workspace = createGiteaWorkspace({workDir: gitea.workDir, author: gitea.author, client: giteaClient,
      remote: {url: deps.remoteUrl ?? (repository => gitea.baseUrl + '/' + repository + '.git'), token: gitea.token,
        noRevocationCheck: gitea.noRevocationCheck}});
    const {report, exitCode} = await runOnce(client, config, {
      records: createRunRecords(config.stateDir),
      prepareWorkspace: workspace.prepareWorkspace,
      publish: workspace.publish,
      branchExists: workspace.branchExists,
      runLoop: deps.runLoop ?? ((root, name, spec) => runLoop(root, name, spec, {runner: claudeRunner(sessionOptions(env))})),
      // The same C-HUB key: task-manager:read for the tasks and sugar-forum:digest for the buddy (design 1.1).
      notify: deps.notify ?? (gitea.notify ? createDigestNotifier({baseUrl: config.baseUrl, token: config.token,
        stateDir: config.stateDir, transport: deps.digestTransport, now: deps.now}).notify : async () => {}),
    });
    return {output: redact(JSON.stringify({ok: exitCode === 0, ...report}), secrets), exitCode};
  } catch (error) {
    const message = error instanceof ChubError || error instanceof GiteaError || error instanceof WorkspaceError ?
      error.message : '実行に失敗しました。';
    return {output: redact(JSON.stringify({ok: false, dryRun: !once, error: message}), secrets), exitCode: 1};
  }
}

function isMain(): boolean {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isMain()) {
  const {output, exitCode} = await main(process.argv.slice(2), process.env);
  console.log(output);
  process.exitCode = exitCode;
}
