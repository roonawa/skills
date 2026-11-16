#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createChubClient, findBoard, loadChubConfig, redact, ChubError,
  type ChubClient, type ChubConfig, type ChubTask, type Transport } from './chub.js';

/**
 * Stage 1 runner (docs/autonomous-runner-design.md, 9): dry-run only.
 * It reads the "ready" section of each configured board and reports, per task, whether the runner could start it
 * (5.2, 5.3). It never writes to C-HUB or Gitea; the client it uses has no write function.
 */
export interface Reason {code: string; message: string}
export interface Request {repository?: string; baseBranch?: string; acceptanceIds: string[]}
export interface TaskDecision {
  id: string;
  title: string;
  board: string;
  createdAt: string | null;
  eligible: boolean;
  reasons: Reason[];
  repository: string | null;
  baseBranch: string | null;
  acceptanceIds: string[];
}

const keyPattern = /^\s*(対象リポジトリ|基準ブランチ|受け入れ条件|やらないこと|参考)\s*[:：]\s*(.*)$/;
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
// aidev task names (src/files.ts safeName): lower case, digits and single hyphens, at most 64 characters.
const taskNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Applies the start conditions of 5.2 to one task. */
export function decide(task: ChubTask, board: string, allowedRepositories: string[]): TaskDecision {
  const request = parseRequest(typeof task.description === 'string' ? task.description : '');
  const reasons: Reason[] = [];
  const add = (code: string, message: string) => reasons.push({code, message});
  if (!request.repository) add('missing-repository', '依頼テンプレートの「対象リポジトリ」がありません。');
  else if (!repositoryPattern.test(request.repository)) add('invalid-repository', '対象リポジトリは org/repo の形で書いてください。');
  else if (!allowedRepositories.includes(request.repository)) add('repository-not-allowed', '対象リポジトリがランナー設定の許可リストにありません。');
  if (!request.baseBranch) add('missing-base-branch', '依頼テンプレートの「基準ブランチ」がありません。');
  else if (!branchPattern.test(request.baseBranch)) add('invalid-base-branch', '基準ブランチの名前に使えない文字が含まれています。');
  if (request.acceptanceIds.length === 0) add('missing-acceptance', '「受け入れ条件」に AC-ID（例: - AC-001: ...）が1件もありません。');
  if (!taskNamePattern.test(task.id) || task.id.length > 64) add('invalid-task-id', 'タスク ID が aidev のタスク名の規則に合いません。');
  return {
    id: task.id,
    title: typeof task.title === 'string' ? task.title : '',
    board,
    createdAt: typeof task.created_at === 'string' ? task.created_at : null,
    eligible: reasons.length === 0,
    reasons,
    repository: request.repository ?? null,
    baseBranch: request.baseBranch ?? null,
    acceptanceIds: request.acceptanceIds,
  };
}

export interface BoardReport {name: string; found: boolean; readySection: boolean; readyCount: number; runningCount: number | null}
export interface DryRunReport {
  dryRun: true;
  boards: BoardReport[];
  tasks: TaskDecision[];
  /** Task the runner would take first (oldest eligible), or null. */
  next: string | null;
  /** Tasks already in the running section: 5.6 would hand them to a human. Listed only. */
  interrupted: {id: string; board: string}[];
}

const created = (task: ChubTask) => typeof task.created_at === 'string' ? task.created_at : '';

export async function dryRun(client: ChubClient, config: ChubConfig): Promise<DryRunReport> {
  if (!config.boards.length) throw new ChubError('設定の boards に対象ボードを1件以上指定してください。');
  const boards: BoardReport[] = [];
  const tasks: TaskDecision[] = [];
  const interrupted: {id: string; board: string}[] = [];
  for (const name of config.boards) {
    const project = await findBoard(client, name);
    if (!project) {
      boards.push({name, found: false, readySection: false, readyCount: 0, runningCount: null});
      continue;
    }
    const sections = await client.listSections(project.id);
    const ready = sections.find(section => section.name === config.sections.ready);
    const running = config.sections.running ? sections.find(section => section.name === config.sections.running) : undefined;
    const listed = ready || running ? await client.listTasks(project.id) : [];
    const inSection = (id: string | undefined) => listed.filter(task => id !== undefined && String(task.section_id) === id);
    const readyTasks = inSection(ready?.id).sort((a, b) => created(a).localeCompare(created(b)));
    const runningTasks = inSection(running?.id);
    interrupted.push(...runningTasks.map(task => ({id: task.id, board: name})));
    boards.push({name, found: true, readySection: Boolean(ready), readyCount: readyTasks.length,
      runningCount: running ? runningTasks.length : null});
    for (const summary of readyTasks) {
      // 5.2-2: the list is a summary; the description is read from the single task.
      const task = await client.getTask(summary.id);
      const decision = decide(task, name, config.allowedRepositories);
      if (String(task.section_id) !== ready?.id) {
        decision.eligible = false;
        decision.reasons.push({code: 'section-changed', message: '読み取り中に別のセクションへ移されました。'});
      }
      tasks.push(decision);
    }
  }
  tasks.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  return {dryRun: true, boards, tasks, next: tasks.find(task => task.eligible)?.id ?? null, interrupted};
}

const usage = '使用法: node dist/runner.js --dry-run [--config FILE]。段階1では --dry-run だけを受け付けます。';

/** Entry point used by the command line and the tests. Returns the JSON line and the exit code. */
export async function main(args: string[], env: NodeJS.ProcessEnv,
    deps: {transport?: Transport; sleep?: (ms: number) => Promise<void>} = {}): Promise<{output: string; exitCode: number}> {
  let secrets: (string | undefined)[] = [env.CHUB_TOKEN, env.CHUB_BASE_URL];
  try {
    const configIndex = args.indexOf('--config');
    const file = configIndex >= 0 ? args[configIndex + 1] : env.AIDEV_CHUB_CONFIG;
    const known = args.every((arg, index) => arg === '--dry-run' || arg === '--config' || index === configIndex + 1 && configIndex >= 0);
    if (!args.includes('--dry-run') || !known || (configIndex >= 0 && !file)) throw new ChubError(usage);
    const config = loadChubConfig(file, env);
    secrets = [config.token, config.baseUrl, new URL(config.baseUrl).host, ...secrets];
    const report = await dryRun(createChubClient({baseUrl: config.baseUrl, token: config.token, ...deps}), config);
    return {output: redact(JSON.stringify({ok: true, ...report}), secrets), exitCode: 0};
  } catch (error) {
    const message = error instanceof ChubError ? error.message : '実行に失敗しました。';
    return {output: redact(JSON.stringify({ok: false, dryRun: true, error: message}), secrets), exitCode: 1};
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
