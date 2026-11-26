// Gitea side of the unattended runner: working copy, publishing in a fresh clone, pull request (design 5.4, 5.5).
// git runs for real against a local bare repository; the Gitea API and C-HUB are fakes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { main } from '../dist/runner.js';
import { createHooksDirectory, gitEnvironment, notCopied } from '../dist/workspace.js';
import { taskNameOf } from '../dist/run-records.js';
import { env as chubEnv, fakeChub, task, template } from './chub-fake.mjs';
import { BASE as GITEA, TOKEN as GITEA_TOKEN, fakeGitea } from './gitea-fake.mjs';

const sleep = async () => {};
const git = (cwd, ...args) => {
  const result = spawnSync('git', args, {cwd, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

test('git gets the token only as a header, with no credentials from the runner and no credential helper', () => {
  const env = gitEnvironment({url: () => '', token: GITEA_TOKEN, noRevocationCheck: true},
    {PATH: 'p', GITEA_TOKEN, CHUB_TOKEN: 'c', ANTHROPIC_API_KEY: 'k', HOME: 'h'});
  assert.equal(env.GITEA_TOKEN, undefined);
  assert.equal(env.CHUB_TOKEN, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  const config = Object.fromEntries(Array.from({length: Number(env.GIT_CONFIG_COUNT)},
    (_, i) => [env['GIT_CONFIG_KEY_' + i], env['GIT_CONFIG_VALUE_' + i]]));
  assert.equal(config['credential.helper'], '');
  assert.equal(config['http.followRedirects'], 'false');
  assert.equal(config['http.schannelCheckRevoke'], 'false');
  assert.equal(config['http.extraHeader'], 'Authorization: Basic ' + Buffer.from(GITEA_TOKEN + ':x-oauth-basic').toString('base64'));
  assert.ok(!Object.values(env).some(value => value === GITEA_TOKEN), 'the raw token is not in any variable');
  assert.equal(config['core.protectNTFS'], 'true');
  assert.match(config['core.hooksPath'], /^(NUL|\/dev\/null)$/, 'hooks point at the null device, which nobody can fill');
});

test('git reads neither the user nor the system configuration, nor git settings from the environment', () => {
  const source = {PATH: 'p', GIT_CONFIG_GLOBAL: '/home/u/evil.gitconfig', GIT_CONFIG_PARAMETERS: "'url.x.insteadof'='y'",
    GIT_SSH_COMMAND: 'evil', GIT_EXEC_PATH: '/evil', GIT_CONFIG_KEY_9: 'url.x.insteadOf', Git_Exec_Path: '/evil', git_config_global: 'x'};
  const windows = gitEnvironment({url: () => ''}, source, 'win32');
  const linux = gitEnvironment({url: () => ''}, source, 'linux');
  for (const env of [windows, linux]) {
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
    assert.match(env.GIT_CONFIG_GLOBAL, /^(NUL|\/dev\/null)$/);
    assert.equal(env.GIT_CONFIG_PARAMETERS, undefined);
    assert.equal(env.GIT_SSH_COMMAND, undefined);
    assert.equal(env.GIT_EXEC_PATH, undefined);
    assert.equal(env.GIT_CONFIG_KEY_9, undefined);
    assert.deepEqual(Object.keys(env).filter(name => /^git_/i.test(name) && name !== name.toUpperCase()), [],
      'Windows reads variable names without regard to case');
  }
  assert.throws(() => gitEnvironment({url: () => ''}, {}, 'win32', 'hooks'), /絶対パス/);
  const values = env => Array.from({length: Number(env.GIT_CONFIG_COUNT)}, (_, i) => env['GIT_CONFIG_KEY_' + i] + '=' + env['GIT_CONFIG_VALUE_' + i]);
  assert.ok(values(windows).includes('http.sslBackend=schannel'), 'the Windows store holds the in-house CA');
  assert.ok(!values(linux).some(value => value.startsWith('http.sslBackend')));
});

test('the hooks path lies below a regular file, so no hook can be created there', t => {
  assert.equal(createHooksDirectory('linux').path, '/dev/null');
  assert.equal(createHooksDirectory('win32', 'C:\\Windows').path, 'C:\\Windows\\System32\\kernel32.dll\\nohooks');
  // Without the system file the runner refuses to run git rather than fall back to a writable folder.
  const dir = mkdtempSync(join(tmpdir(), 'aidev-root-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  assert.throws(() => createHooksDirectory('win32', dir).check(), /System32/);
  if (process.platform === 'win32') {
    const hooks = createHooksDirectory();
    assert.ok(isAbsolute(hooks.path));
    hooks.check();
    assert.throws(() => mkdirSync(hooks.path, {recursive: true}), 'a folder cannot be made below a file');
  }
});

test('names that Windows maps onto .git are never copied', () => {
  for (const name of ['.git', '.GIT', '.git.', '.git ', '.Git. .', 'GIT~1', 'git~12', 'node_modules', 'Node_Modules.', 'a:b', '...',
    'NUL', 'nul.txt', 'Con', 'com1.log', 'LPT9', 'aux.tar.gz']) {
    assert.ok(notCopied(name), name);
  }
  for (const name of ['.gitignore', '.github', 'git~', 'src', '.aidev']) assert.ok(!notCopied(name), name);
});

function setup(t, {branchExists = false} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aidev-ws-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  // Origin: a bare repository whose main has README.md and src/keep.txt.
  const seed = join(dir, 'seed');
  mkdirSync(join(seed, 'src'), {recursive: true});
  writeFileSync(join(seed, 'README.md'), '# app\n');
  writeFileSync(join(seed, 'src', 'keep.txt'), 'keep\n');
  git(dir, 'init', '--quiet', '--initial-branch=main', seed);
  git(seed, 'add', '-A');
  git(seed, '-c', 'user.name=seed', '-c', 'user.email=seed@localhost', 'commit', '--quiet', '-m', 'seed');
  const origin = join(dir, 'origin.git');
  git(dir, 'clone', '--quiet', '--bare', seed, origin);
  const state = join(dir, 'state');
  const file = join(dir, 'runner.json');
  writeFileSync(file, JSON.stringify({boards: ['tp-1'], allowedRepositories: ['org/app'], stateDir: state, gitea: {baseUrl: GITEA}}));
  const pulls = [];
  const gitea = fakeGitea(request => {
    if (request.method === 'GET' && request.url.includes('/branches/')) return {status: branchExists ? 200 : 404, body: ''};
    if (request.method === 'POST' && request.url.endsWith('/repos/org/app/pulls')) {
      pulls.push(JSON.parse(request.body));
      return {status: 201, body: JSON.stringify({number: 3, html_url: GITEA + '/org/app/pulls/3'})};
    }
    return {status: 404, body: ''};
  });
  // A marker that a command run through the working copy's tampered .git/config would create.
  const marker = join(dir, 'MARKER');
  const script = join(dir, 'marker.cjs');
  writeFileSync(script, 'require("fs").writeFileSync(' + JSON.stringify(marker) + ', "ran")');
  return {dir, file, state, origin, pulls, gitea, marker, script, remoteUrl: () => 'file:///' + origin.replace(/\\/g, '/').replace(/^\//, '')};
}

const env = {...chubEnv, GITEA_TOKEN};

test('--once clones the base branch, runs the loop, commits in a fresh clone, pushes aidev/<task> and opens the pull request', async t => {
  const s = setup(t);
  const {transport} = fakeChub({tasks: [task('task-a', 351, template())]});
  const name = taskNameOf('task-a', template());
  const startedFrom = git(s.origin, 'rev-parse', 'main');
  let workRoot;
  const runLoop = async (root, taskName, spec) => {
    workRoot = root;
    assert.equal(readFileSync(join(root, spec), 'utf8'), template());
    assert.ok(!readFileSync(join(root, '.git', 'config'), 'utf8').includes('extraHeader'), 'no header stored in the working copy');
    // The "implementation": add a file, delete one, leave packages and a symbolic-link-free tree.
    writeFileSync(join(root, 'src', 'count.js'), 'export const count = 1;\n');
    rmSync(join(root, 'README.md'));
    mkdirSync(join(root, 'node_modules', 'x'), {recursive: true});
    writeFileSync(join(root, 'node_modules', 'x', 'index.js'), '');
    // Project code may tamper with the working copy's git configuration; it must not run during publishing.
    appendFileSync(join(root, '.git', 'config'), '\n[core]\n\tfsmonitor = node "' + s.script.replace(/\\/g, '/') + '"\n');
    mkdirSync(join(root, '.aidev', 'runs', taskName), {recursive: true});
    writeFileSync(join(root, '.aidev', 'runs', taskName, 'state.json'), '{}');
    // Someone else adds a commit to main while the task runs.
    const other = join(s.dir, 'other');
    git(s.dir, 'clone', '--quiet', s.origin, other);
    writeFileSync(join(other, 'NEWS.md'), 'news\n');
    git(other, 'add', '-A');
    git(other, '-c', 'user.name=o', '-c', 'user.email=o@localhost', 'commit', '--quiet', '-m', 'news');
    git(other, 'push', '--quiet', 'origin', 'HEAD:main');
    return {task: taskName, state: 'review', reason: 'checks-passed', attempts: 1, exitCode: 0, costUsd: 0, notes: ['0件の文言は仮'],
      steps: [{attempt: 1, implementation: {ok: true, report: ''}, review: {ok: true}, state: 'review', reason: 'checks-passed'}]};
  };
  const {output, exitCode} = await main(['--once', '--config', s.file], env,
    {transport, sleep, giteaTransport: s.gitea.transport, remoteUrl: s.remoteUrl, runLoop, notify: async () => {}});
  assert.equal(exitCode, 0, output);
  const report = JSON.parse(output);
  assert.equal(report.ran.result.url, GITEA + '/org/app/pulls/3');
  assert.ok(!output.includes(GITEA_TOKEN) && !output.includes(chubEnv.CHUB_TOKEN));
  // The branch in origin has the change, without node_modules, on top of main.
  const branch = 'aidev/' + name;
  const files = git(s.origin, 'ls-tree', '-r', '--name-only', branch).split('\n');
  assert.ok(files.includes('src/count.js') && files.includes('src/keep.txt') && files.includes('.aidev/specs/' + name + '.md'), files.join(','));
  assert.ok(!files.includes('README.md') && !files.some(f => f.startsWith('node_modules/')), files.join(','));
  assert.equal(git(s.origin, 'log', '-1', '--format=%an', branch), 'aidev-runner');
  // The work branch starts where the working copy started, so the commit added to main meanwhile is not undone.
  assert.equal(git(s.origin, 'rev-parse', branch + '~1'), startedFrom);
  assert.notEqual(git(s.origin, 'rev-parse', 'main'), startedFrom);
  assert.ok(!files.includes('NEWS.md'), 'the branch does not contain the later commit, nor a deletion of it');
  assert.ok(!existsSync(s.marker), 'nothing from the tampered working copy ran');
  // The pull request goes from the work branch into the base branch.
  assert.equal(s.pulls.length, 1);
  assert.equal(s.pulls[0].head, branch);
  assert.equal(s.pulls[0].base, 'main');
  assert.equal(s.pulls[0].title, 'タスク task-a（task-a）');
  assert.match(s.pulls[0].body, /AC-001[\s\S]*AC-002[\s\S]*\| 1 \| 完了 \| 完了 \| review（checks-passed） \|[\s\S]*0件の文言は仮/);
  // No token in any file the runner left on disk (working copies, run records).
  const leaks = [];
  const scan = path => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) scan(full);
      else if (readFileSync(full).includes(GITEA_TOKEN) || readFileSync(full).includes(Buffer.from(GITEA_TOKEN + ':x-oauth-basic').toString('base64'))) leaks.push(full);
    }
  };
  scan(s.state);
  assert.deepEqual(leaks, []);
  assert.ok(workRoot.startsWith(join(s.state, 'work')));
});

test('needs-human opens a WIP pull request with the hand-off; an existing work branch is not run again', async t => {
  const s = setup(t);
  const {transport} = fakeChub({tasks: [task('task-b', 351, template())]});
  const runLoop = async (root, taskName) => {
    const handoff = '.aidev/runs/' + taskName + '/handoff.md';
    mkdirSync(join(root, '.aidev', 'runs', taskName), {recursive: true});
    writeFileSync(join(root, handoff), '# 引継ぎ票\n同じ指摘が再発しました。\n');
    return {task: taskName, state: 'needs-human', reason: 'repeated-failure', attempts: 2, exitCode: 2, costUsd: 0, handoff, steps: []};
  };
  const {output, exitCode} = await main(['--once', '--config', s.file], env,
    {transport, sleep, giteaTransport: s.gitea.transport, remoteUrl: s.remoteUrl, runLoop});
  assert.equal(exitCode, 0, output);
  assert.match(s.pulls[0].title, /^WIP: /);
  assert.match(s.pulls[0].body, /## 引継ぎ票[\s\S]*同じ指摘が再発しました。/);

  // Project code links the hand-off's folder to a file elsewhere on the runner host: it must not reach the PR.
  const linked = setup(t);
  const outside = join(linked.dir, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'handoff.md'), 'SECRET-ON-HOST');
  const linkLoop = async (root, taskName) => {
    mkdirSync(join(root, '.aidev', 'runs'), {recursive: true});
    symlinkSync(outside, join(root, '.aidev', 'runs', taskName), 'junction');
    return {task: taskName, state: 'needs-human', reason: 'repair-limit', attempts: 3, exitCode: 2, costUsd: 0,
      handoff: '.aidev/runs/' + taskName + '/handoff.md', steps: []};
  };
  const {transport: linkTransport} = fakeChub({tasks: [task('task-l', 351, template())]});
  const linkedRun = await main(['--once', '--config', linked.file], env, {transport: linkTransport, sleep,
    giteaTransport: linked.gitea.transport, remoteUrl: linked.remoteUrl, runLoop: linkLoop});
  assert.equal(linkedRun.exitCode, 0, linkedRun.output);
  assert.ok(!linked.pulls[0].body.includes('SECRET-ON-HOST'));
  assert.match(linked.pulls[0].body, /引継ぎ票を読めません/);

  const again = setup(t, {branchExists: true});
  const second = await main(['--once', '--config', again.file], env, {transport, sleep, giteaTransport: again.gitea.transport,
    remoteUrl: again.remoteUrl, runLoop: async () => assert.fail('ran')});
  assert.equal(JSON.parse(second.output).ran, null);
});

for (const ciDir of ['.gitea', '.GitHub']) test('a changed CI definition is not pushed and goes to a person: ' + ciDir, async t => {
  const s = setup(t);
  const {transport} = fakeChub({tasks: [task('task-ci', 351, template())]});
  const runLoop = async (root, taskName) => {
    mkdirSync(join(root, ciDir, 'workflows'), {recursive: true});
    writeFileSync(join(root, ciDir, 'workflows', 'leak.yml'), 'on: push\n');
    return {task: taskName, state: 'review', reason: 'checks-passed', attempts: 1, exitCode: 0, costUsd: 0, steps: []};
  };
  const {output, exitCode} = await main(['--once', '--config', s.file], env,
    {transport, sleep, giteaTransport: s.gitea.transport, remoteUrl: s.remoteUrl, runLoop});
  const report = JSON.parse(output);
  assert.equal(exitCode, 0, output);
  assert.deepEqual(report.ran.result, {state: 'needs-human', reason: 'ci-config-changed'});
  assert.match(report.notifications[0], /CI の設定.*push していません/);
  assert.equal(s.pulls.length, 0);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'aidev/' + taskNameOf('task-ci', template())], {cwd: s.origin}).status, 1,
    'no branch was pushed');
});

test('--once needs stateDir and the Gitea token from the environment; a failed clone is a runner error', async t => {
  const s = setup(t);
  const {transport} = fakeChub({tasks: [task('task-c', 351, template())]});
  const noToken = await main(['--once', '--config', s.file], chubEnv, {transport, sleep});
  assert.match(JSON.parse(noToken.output).error, /GITEA_TOKEN/);
  writeFileSync(join(s.dir, 'nostate.json'), JSON.stringify({boards: ['tp-1'], allowedRepositories: ['org/app'], gitea: {baseUrl: GITEA}}));
  const noState = await main(['--once', '--config', join(s.dir, 'nostate.json')], env, {transport, sleep});
  assert.match(JSON.parse(noState.output).error, /stateDir/);
  const broken = await main(['--once', '--config', s.file], env, {transport, sleep, giteaTransport: s.gitea.transport,
    remoteUrl: () => join(s.dir, 'missing.git'), runLoop: async () => assert.fail('ran')});
  assert.equal(broken.exitCode, 1);
  assert.deepEqual(JSON.parse(broken.output).ran.result, {state: 'runner-error', reason: 'workspace'});
  assert.match(JSON.parse(broken.output).notifications[0], /^【実行不能】/);
  for (const args of [['--once', '--dry-run'], ['--once', '--apply']]) {
    assert.match(JSON.parse((await main(args, env, {})).output).error, /--once/);
  }
});
