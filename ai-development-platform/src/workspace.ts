import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, win32 } from 'node:path';
import { withoutCredentials } from './environment.js';
import { stopTree } from './react.js';
import { checkBranch, type GiteaRunnerClient } from './gitea.js';
import type { LoopResult } from './loop.js';
import { tries, type TaskDecision } from './runner.js';

/**
 * Working copies and publishing for the unattended runner (docs/autonomous-runner-design.md 5.4, 5.5).
 *
 * - The Gitea token reaches git only through the environment of each git command (http.extraHeader), so it is
 *   never written to .git/config of a working copy that an AI session or the gate's npm scripts can read.
 * - The working copy is not trusted after the run: project code may have changed its .git (hooks, fsmonitor,
 *   filters). Commit and push therefore happen in a second, fresh clone; the files are copied over without .git.
 * - Only `aidev/<task name>` is pushed, never with force. Nothing is merged.
 */
export class WorkspaceError extends Error {
  /** Set when the run should end as needs-human with this reason rather than as a runner error. */
  constructor(message: string, readonly reason?: string) {
    super(message);
  }
}

export interface GitRemote {
  /** Clone URL of `org/repo` (https on Gitea; a local path in tests). Must not contain credentials. */
  url(repository: string): string;
  token?: string;
  /** Windows only: skip the certificate revocation check for this remote (design 7, in-house CA without CRL). */
  noRevocationCheck?: boolean;
}
export interface WorkspaceOptions {
  /** Directory on the runner host for working copies; each task version gets fresh subdirectories. */
  workDir: string;
  remote: GitRemote;
  author: {name: string; email: string};
  /** Runs `npm ci --ignore-scripts` when the checkout has a package-lock.json (default true). */
  install?: boolean;
  timeoutMs?: number;
  client?: GiteaRunnerClient;
}
export type RunnerTask = TaskDecision & {taskName: string};

type Status = number | 'timeout' | 'error';

function runProcess(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Status> {
  const windows = process.platform === 'win32';
  // Output is discarded: git and npm messages can contain URLs and paths, and nothing here needs them.
  const child = spawn(command, args, {cwd, env, stdio: 'ignore', windowsHide: true, detached: !windows});
  return new Promise(resolve => {
    let settled = false;
    const finish = (status: Status) => { if (!settled) { settled = true; clearTimeout(timer); resolve(status); } };
    const timer = setTimeout(async () => {
      if (child.pid !== undefined) await stopTree(child.pid);
      finish('timeout');
    }, timeoutMs);
    child.once('error', () => finish('error'));
    child.once('close', code => finish(code ?? 'error'));
  });
}

/**
 * Empty configuration file for GIT_CONFIG_GLOBAL. Git for Windows maps exactly "/dev/null" to the null device.
 * It is not used as a hooks path on Windows: "/dev/null/pre-commit" would become C:\dev\null\pre-commit.
 */
const nullDevice = '/dev/null';

/**
 * Hooks path for the runner's git: a path below a regular file, where no hook can ever be created. Elsewhere that is
 * /dev/null; on Windows a system file an ordinary user cannot delete or replace (kernel32.dll in System32), so code
 * running as the runner's user cannot turn the path into a folder between a check and the git command.
 */
export function createHooksDirectory(platform: NodeJS.Platform = process.platform,
    systemRoot = process.env.SystemRoot ?? 'C:\\Windows'): {path: string; check(): void} {
  if (platform !== 'win32') return {path: nullDevice, check() {}};
  const file = win32.join(systemRoot, 'System32', 'kernel32.dll');
  return {path: win32.join(file, 'nohooks'), check() {
    let regular = false;
    try {
      regular = lstatSync(file).isFile();
    } catch {
      regular = false;
    }
    if (!regular) throw new WorkspaceError('git のフックを無効にする場所を用意できません（System32 のファイルが見つかりません）。');
  }};
}

/**
 * Environment for git: no credentials from the runner, no prompts, no stored credentials, the token as a header only.
 * Project code runs as the same user before git does, so the user's and the system's git configuration may have been
 * changed (url.*.insteadOf or http.proxy could send the token elsewhere). Neither is read; what git needs is set here.
 * `hooksPath` must be absolute (see createHooksDirectory); a relative one is resolved inside the work tree.
 */
export function gitEnvironment(remote: GitRemote, source: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform, hooksPath = nullDevice): NodeJS.ProcessEnv {
  if (!isAbsolute(hooksPath) && hooksPath !== nullDevice) throw new WorkspaceError('フックの場所は絶対パスにしてください。');
  const config: [string, string][] = [
    ['credential.helper', ''],
    ['core.fsmonitor', 'false'],
    ['core.hooksPath', hooksPath],
    // Refuse paths that Windows or macOS would map onto .git, whatever the platform's default.
    ['core.protectNTFS', 'true'],
    ['core.protectHFS', 'true'],
    ['http.followRedirects', 'false'],
    ['protocol.ext.allow', 'never'],
    ['protocol.file.allow', 'user'],
    // Without the system configuration, Git for Windows would use its own CA bundle; the Windows store holds the in-house CA.
    ...(platform === 'win32' ? [['http.sslBackend', 'schannel'] as [string, string]] : []),
  ];
  if (remote.token) {
    // Gitea accepts a token as the user name of basic authentication when the password is "x-oauth-basic".
    config.push(['http.extraHeader', 'Authorization: Basic ' + Buffer.from(remote.token + ':x-oauth-basic').toString('base64')]);
  }
  if (remote.noRevocationCheck) config.push(['http.schannelCheckRevoke', 'false']);
  const env: NodeJS.ProcessEnv = {...withoutCredentials(source), GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: nullDevice, GIT_CONFIG_COUNT: String(config.length)};
  for (const name of Object.keys(env)) {
    // Settings injected through the environment (GIT_CONFIG_PARAMETERS, GIT_SSH_COMMAND, GIT_EXEC_PATH...) are dropped.
    // Windows treats variable names without regard to case, so "Git_Exec_Path" is dropped too; only the exact
    // upper-case names set above stay.
    if (/^GIT_/i.test(name) && !/^GIT_(TERMINAL_PROMPT|CONFIG_NOSYSTEM|CONFIG_GLOBAL|CONFIG_COUNT)$/.test(name)) delete env[name];
  }
  config.forEach(([key, value], index) => {
    env['GIT_CONFIG_KEY_' + index] = key;
    env['GIT_CONFIG_VALUE_' + index] = value;
  });
  return env;
}

/**
 * Names never copied from the working copy into the publish clone: git metadata and installed packages.
 * Windows ignores trailing dots and spaces and case, and has 8.3 short names, so ".git.", ".GIT " and "GIT~1" can
 * all reach the publish clone's .git; names with ":" would write alternate data streams.
 */
export function notCopied(name: string): boolean {
  const normalized = name.replace(/[. ]+$/, '').toLowerCase();
  // Reserved device names (NUL, CON, COM1...) open the device whatever the folder or extension.
  const device = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/.test(normalized.split('.')[0].trim());
  return normalized === '.git' || normalized === 'node_modules' || /^git~\d+$/.test(normalized) || name.includes(':') ||
    normalized === '' || device;
}

/** Top-level directories with CI definitions. A change there could run code with the repository's Actions secrets. */
const ciDirectories = ['.gitea', '.github', '.forgejo'];

/**
 * Files under the CI directories, exact relative path → content. A top-level entry counts as a CI directory after
 * normalising case and trailing dots and spaces, but the keys keep the exact names, so ".github" and ".GitHub" are
 * two entries and neither can hide the other.
 */
function ciFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (path: string, relative: string) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) files.set(relative, '\0link');
    else if (stat.isFile()) files.set(relative, readFileSync(path, 'base64'));
    else for (const entry of readdirSync(path)) visit(join(path, entry), relative + '/' + entry);
  };
  for (const entry of readdirSync(root)) {
    if (ciDirectories.includes(entry.replace(/[. ]+$/, '').toLowerCase())) visit(join(root, entry), entry);
  }
  return files;
}

const sameFiles = (a: Map<string, string>, b: Map<string, string>) =>
  a.size === b.size && [...a].every(([path, content]) => b.has(path) && b.get(path) === content);

/** Copies the working tree without .git, installed packages or symbolic links. */
function copyTree(from: string, to: string): void {
  for (const entry of readdirSync(from, {withFileTypes: true})) {
    if (notCopied(entry.name)) continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      mkdirSync(target, {recursive: true});
      copyTree(source, target);
    } else if (stat.isFile()) {
      copyFileSync(source, target);
    }
  }
}

/** Removes everything but .git, so files deleted in the working copy are deleted in the commit too. */
function clearTree(root: string): void {
  for (const entry of readdirSync(root)) if (entry !== '.git') rmSync(join(root, entry), {recursive: true, force: true});
}

/** Commit checked out in a fresh clone, read from the files so no git command runs for it. */
function headCommit(dir: string): string {
  const head = readFileSync(join(dir, '.git', 'HEAD'), 'utf8').trim();
  const ref = /^ref: (refs\/heads\/[A-Za-z0-9._/-]+)$/.exec(head)?.[1];
  let commit = ref ? undefined : head;
  if (ref) {
    const loose = join(dir, '.git', ...ref.split('/'));
    if (existsSync(loose)) commit = readFileSync(loose, 'utf8').trim();
    else {
      const packed = join(dir, '.git', 'packed-refs');
      const line = existsSync(packed) ? readFileSync(packed, 'utf8').split('\n').find(entry => entry.endsWith(' ' + ref)) : undefined;
      commit = line?.split(' ')[0];
    }
  }
  if (!commit || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit)) throw new WorkspaceError('取得したブランチのコミットを読めません。');
  return commit;
}

const maxHandoffChars = 60_000;

/** Skills the implementation and review prompts refer to (src/loop.ts); the target repository must contain them. */
export const requiredSkills = ['aidev-implementation', 'aidev-testing', 'aidev-repair-workflow', 'aidev-code-review'];

/**
 * Reads a regular file inside the working copy, or returns undefined. Project code may have replaced the file or a
 * parent directory with a link to a file elsewhere on the runner host, so every component is checked with lstat and
 * links are refused; the size is capped before reading.
 */
function readUntrusted(root: string, relative: string): string | undefined {
  const parts = relative.split(/[\\/]/);
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..')) return undefined;
  let path = root;
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      return undefined;
    }
    const last = index === parts.length - 1;
    if (stat.isSymbolicLink() || (last ? !stat.isFile() : !stat.isDirectory())) return undefined;
    if (last && stat.size > maxHandoffChars * 4) return readFileSync(path).subarray(0, maxHandoffChars * 4).toString('utf8');
  }
  return readFileSync(path, 'utf8');
}

/** Pull request description (design 5.5). C-HUB task, result, criteria, gate results per attempt, notes, hand-off. */
export function pullRequestBody(task: RunnerTask, result: LoopResult, root: string): string {
  const lines = ['このPRは aidev の無人実行ランナーが作成しました。マージは人がレビューしてから行ってください。', '',
    '- C-HUB のタスク: ' + task.title + '（' + task.id + '、ボード ' + task.board + '）',
    '- aidev のタスク名: ' + task.taskName,
    '- 結果: ' + result.state + '（' + result.reason + '、' + tries(result.attempts) + '）', '',
    '## 受け入れ条件', '', ...task.acceptanceIds.map(id => '- ' + id), '',
    '## 各回の結果', '', '| 回 | 実装 | レビュー | 判定 |', '|---|---|---|---|',
    ...result.steps.map(step => '| ' + (step.attempt + 1) + ' | ' + (step.implementation.ok ? '完了' : '失敗') + ' | ' +
      (step.review ? step.review.ok ? '完了' : '失敗' : '-') + ' | ' + (step.state ?? '-') + (step.reason ? '（' + step.reason + '）' : '') + ' |')];
  if (result.notes?.length) lines.push('', '## 確認事項（ゲートの合否には影響しない）', '', ...result.notes.map(note => '- ' + note));
  if (result.state === 'needs-human' && result.handoff) {
    let text = readUntrusted(root, result.handoff) ?? '（引継ぎ票を読めません。ブランチ上の ' + result.handoff + ' を見てください）';
    if (text.length > maxHandoffChars) text = text.slice(0, maxHandoffChars) + '\n\n（長いため省略。ブランチ上の ' + result.handoff + ' を見てください）';
    lines.push('', '## 引継ぎ票', '', text);
  }
  return lines.join('\n') + '\n';
}

export function createGiteaWorkspace(options: WorkspaceOptions) {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const hooks = createHooksDirectory();
  const env = gitEnvironment(options.remote, process.env, process.platform, hooks.path);
  const git = async (args: string[], cwd: string, step: string) => {
    hooks.check();
    const status = await runProcess('git', args, cwd, env, timeoutMs);
    if (status !== 0) throw new WorkspaceError(step + ' に失敗しました（' + status + '）。');
  };
  const fresh = (name: string) => {
    const dir = join(options.workDir, name);
    rmSync(dir, {recursive: true, force: true});
    mkdirSync(options.workDir, {recursive: true});
    return dir;
  };
  const clone = async (task: RunnerTask, dir: string, shallow: boolean) => {
    if (!task.repository || !task.baseBranch) throw new WorkspaceError('対象リポジトリと基準ブランチが必要です。');
    await git(['clone', '--quiet', '--no-tags', ...(shallow ? ['--depth', '1'] : []), '--single-branch', '--branch', checkBranch(task.baseBranch), '--',
      options.remote.url(task.repository), dir], options.workDir, 'git clone');
  };
  const branchOf = (task: RunnerTask) => checkBranch('aidev/' + task.taskName);
  const repoParts = (repository: string) => repository.split('/') as [string, string];
  // Commit each working copy started from, read before any project code runs. The work branch starts there, so a
  // commit added to the base branch meanwhile is not undone by the pull request.
  const bases = new Map<string, string>();

  return Object.freeze({
    /** Fresh clone of the base branch for the AI sessions, with packages installed without lifecycle scripts. */
    async prepareWorkspace(task: RunnerTask): Promise<string> {
      const dir = fresh(task.taskName);
      await clone(task, dir, true);
      bases.set(task.taskName, headCommit(dir));
      // The sessions are told to follow these Skills; without them they would work from the prompt alone.
      const missing = requiredSkills.filter(name => !existsSync(join(dir, '.claude', 'skills', name, 'SKILL.md')));
      if (missing.length) {
        throw new WorkspaceError('対象リポジトリに aidev の Skill がありません（' + missing.join('・') + '）。', 'skills-missing');
      }
      if ((options.install ?? true) && existsSync(join(dir, 'package-lock.json'))) {
        const windows = process.platform === 'win32';
        // Fixed arguments only; the project's install scripts do not run, and no credentials reach npm.
        const status = await runProcess(windows ? 'cmd.exe' : 'npm', windows ? ['/d', '/s', '/c', 'npm ci --ignore-scripts'] : ['ci', '--ignore-scripts'],
          dir, withoutCredentials(process.env), timeoutMs);
        if (status !== 0) throw new WorkspaceError('npm ci に失敗しました（' + status + '）。');
      }
      return dir;
    },
    /** Commits the working copy's files on aidev/<task name> in a fresh clone, pushes it and opens the pull request. */
    async publish(root: string, task: RunnerTask, result: LoopResult): Promise<{url: string}> {
      if (!options.client) throw new WorkspaceError('PR を作るには Gitea の接続設定が必要です。');
      const base = bases.get(task.taskName);
      if (!base) throw new WorkspaceError('作業フォルダの元のコミットが分かりません。');
      const dir = fresh(task.taskName + '-publish');
      // Full history of the base branch, so the starting commit is there even if the branch has moved on.
      await clone(task, dir, false);
      const branch = branchOf(task);
      await git(['switch', '--quiet', '-c', branch, base], dir, 'git switch');
      // A changed CI definition on a pushed branch could run with the repository's Actions secrets; a person decides.
      // The check compares the base commit with the files as copied into this clone, i.e. what would be committed.
      const before = ciFiles(dir);
      clearTree(dir);
      copyTree(root, dir);
      if (!sameFiles(before, ciFiles(dir))) {
        throw new WorkspaceError('CI の設定（.gitea・.github・.forgejo）が変わっているため push しません。', 'ci-config-changed');
      }
      await git(['add', '-A'], dir, 'git add');
      const title = (result.state === 'needs-human' ? 'WIP: ' : '') + task.title + '（' + task.id + '）';
      await git(['-c', 'user.name=' + options.author.name, '-c', 'user.email=' + options.author.email,
        'commit', '--quiet', '--allow-empty', '--no-verify', '-m', 'aidev: ' + title], dir, 'git commit');
      // An explicit destination under refs/heads/aidev/; no force, so an existing branch is never overwritten.
      await git(['push', '--quiet', 'origin', 'HEAD:refs/heads/' + branch], dir, 'git push');
      const [owner, repo] = repoParts(task.repository as string);
      const pull = await options.client.createPullRequest(owner, repo,
        {head: branch, base: task.baseBranch as string, title, body: pullRequestBody(task, result, root)});
      return {url: pull.html_url};
    },
    async branchExists(repository: string, branch: string): Promise<boolean> {
      if (!options.client) return false;
      const [owner, repo] = repoParts(repository);
      return options.client.branchExists(owner, repo, checkBranch(branch));
    },
  });
}
