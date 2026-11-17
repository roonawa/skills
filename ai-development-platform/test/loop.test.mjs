import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLoop } from '../dist/loop.js';
import { readWorkflowStatus } from '../dist/workflow.js';

function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'aidev-loop-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'spec.md'), '- AC-001: 新しい順に並べる\n');
  return root;
}
const pass = () => [{name: 'build', status: 'passed'}];
// The temporary projects may sit inside another git repository, so the tests decide what changed.
const noSnapshot = () => undefined;
const clean = {security: {status: 'passed', findings: []}, spec: {status: 'passed', findings: []}};
const failing = summary => ({security: {status: 'passed', findings: []},
  spec: {status: 'failed', findings: [{kind: 'deviation', ref: 'AC-001', file: 'src/a.ts', summary}]}});

/** Fake sessions: implementation always succeeds; reviews come from the given list in order. */
function fakeRunner(reviews, overrides = {}) {
  const requests = [];
  const runner = async (root, request) => {
    requests.push(request);
    if (request.role === 'implementation') return overrides.implementation?.(request) ?? {ok: true, text: '実装しました', costUsd: 1};
    const next = reviews.shift();
    if (next === undefined) assert.fail('unexpected review session');
    return typeof next === 'function' ? next(request) : {ok: true, text: 'レビューしました', structured: next, costUsd: 0.5};
  };
  return {runner, requests};
}

test('loops implementation, a separate review and the gate until review, passing earlier reviews on', async t => {
  const root = project(t);
  const {runner, requests} = fakeRunner([failing('古い順'), {...clean, notes: ['タイムゾーンが仕様にない']}]);
  const result = await runLoop(root, 'menu', 'docs/spec.md', {runner, checks: pass, snapshot: noSnapshot});
  assert.deepEqual([result.state, result.attempts, result.exitCode, result.notes], ['review', 1, 0, ['タイムゾーンが仕様にない']]);
  assert.equal(result.costUsd, 3);
  assert.deepEqual(requests.map(r => r.role), ['implementation', 'review', 'implementation', 'review']);
  // The review session is read-only and must answer in the review schema.
  for (const review of requests.filter(r => r.role === 'review')) {
    assert.ok(review.jsonSchema);
    assert.ok(!review.allowedTools.some(tool => /^(Edit|Write)$/.test(tool)));
  }
  assert.match(requests[2].prompt, /\.aidev\/reviews\/menu-0\.json/);
  assert.match(requests[2].prompt, /古い順/);
  assert.match(requests[3].prompt, /\.aidev\/reviews\/menu-0\.json/);
  assert.doesNotMatch(requests[1].prompt, /menu-0\.json/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.aidev/reviews/menu-0.json'), 'utf8')), failing('古い順'));
  assert.ok(existsSync(join(root, '.aidev/runs/menu/reports/1-implementation.md')));
  assert.ok(existsSync(join(root, '.aidev/runs/menu/reports/1-review.md')));
  // The terminal result replays without starting sessions.
  const again = await runLoop(root, 'menu', 'docs/spec.md', {runner: () => assert.fail('session started'), checks: pass, snapshot: noSnapshot});
  assert.deepEqual([again.state, again.attempts, again.steps.length], ['review', 1, 0]);
});

test('an unresolved finding stops at once with a handoff', async t => {
  const root = project(t);
  const {runner} = fakeRunner([failing('古い順'), failing('まだ古い順')]);
  const result = await runLoop(root, 'menu', 'docs/spec.md', {runner, checks: pass, snapshot: noSnapshot});
  assert.deepEqual([result.state, result.reason, result.attempts, result.exitCode], ['needs-human', 'repeated-failure', 1, 1]);
  assert.match(readFileSync(join(root, result.handoff), 'utf8'), /まだ古い順/);
});

test('findings with new causes stop after the third repair', async t => {
  const root = project(t);
  const reviews = [1, 2, 3, 4].map(n => ({security: {status: 'passed', findings: []},
    spec: {status: 'failed', findings: [{kind: 'deviation', ref: 'AC-00' + n, file: 'src/a.ts', summary: 'x'}]}}));
  const {runner, requests} = fakeRunner(reviews);
  const result = await runLoop(root, 'menu', 'docs/spec.md', {runner, checks: pass, snapshot: noSnapshot});
  assert.deepEqual([result.state, result.reason, result.attempts], ['needs-human', 'repair-limit', 3]);
  assert.equal(requests.filter(r => r.role === 'implementation').length, 4);
});

test('an invalid review is retried once; two invalid reviews stop without using an attempt', async t => {
  const root = project(t);
  const duplicate = {security: {status: 'passed', findings: []}, spec: {status: 'failed', findings: [
    {kind: 'deviation', ref: 'AC-001', file: 'a', summary: 'x'}, {kind: 'deviation', ref: 'AC-001', file: 'a', summary: 'y'}]}};
  const retried = fakeRunner([duplicate, clean]);
  assert.equal((await runLoop(root, 'ok', 'docs/spec.md', {runner: retried.runner, checks: pass, snapshot: noSnapshot})).state, 'review');
  const broken = fakeRunner([duplicate, async () => ({ok: false, text: '', error: 'error_max_budget_usd'})]);
  const stopped = await runLoop(root, 'broken', 'docs/spec.md', {runner: broken.runner, checks: pass, snapshot: noSnapshot});
  assert.deepEqual([stopped.state, stopped.reason, stopped.exitCode, stopped.attempts], ['repair', 'review-session-failed', 2, null]);
  assert.equal(stopped.steps[0].review.error, 'error_max_budget_usd');
  assert.throws(() => readWorkflowStatus(root, 'broken'), /実行記録がありません/);
});

test('a failed implementation session stops before the gate and the task can be resumed', async t => {
  const root = project(t);
  const failed = fakeRunner([], {implementation: () => ({ok: false, text: '', error: 'timeout'})});
  const stopped = await runLoop(root, 'menu', 'docs/spec.md', {runner: failed.runner, checks: pass, snapshot: noSnapshot});
  assert.deepEqual([stopped.state, stopped.reason, stopped.exitCode], ['repair', 'implementation-session-failed', 2]);
  const resumed = fakeRunner([clean]);
  const result = await runLoop(root, 'menu', 'docs/spec.md', {runner: resumed.runner, checks: pass, snapshot: noSnapshot});
  assert.deepEqual([result.state, result.attempts], ['review', 0]);
});

test('a missing specification or an unsafe task name stops before any session', async t => {
  const root = project(t);
  const runner = () => assert.fail('session started');
  await assert.rejects(() => runLoop(root, 'menu', 'docs/missing.md', {runner, checks: pass, snapshot: noSnapshot}), /仕様書/);
  await assert.rejects(() => runLoop(root, '../bad', 'docs/spec.md', {runner, checks: pass, snapshot: noSnapshot}));
  await assert.rejects(() => runLoop(root, 'menu', '../spec.md', {runner, checks: pass, snapshot: noSnapshot}));
});

test('sessions get exact commands, cannot edit the gate settings and do not inherit other credentials', async t => {
  const {implementationTools, implementationDenied, reviewTools, sessionEnvironment} = await import('../dist/loop.js');
  for (const tool of [...implementationTools, ...reviewTools]) assert.doesNotMatch(tool, /^(Bash|PowerShell)\(.*\*\)$/, tool);
  // Windows sessions run commands through the PowerShell tool, so every command is allowed for both shells.
  for (const command of ['npm run test', 'npm run build', 'git diff']) {
    assert.ok(implementationTools.includes('Bash(' + command + ')') && implementationTools.includes('PowerShell(' + command + ')'), command);
  }
  assert.ok(!reviewTools.some(tool => /^(Edit|Write)/.test(tool)));
  for (const path of ['package.json', '.aidev/**', 'biome.json', 'tsconfig*.json']) {
    assert.ok(implementationDenied.includes('Edit(' + path + ')') && implementationDenied.includes('Write(' + path + ')'), path);
  }
  const env = sessionEnvironment({PATH: 'p', ANTHROPIC_API_KEY: 'k', CHUB_TOKEN: 'c', GITEA_TOKEN: 'g', AWS_SECRET_ACCESS_KEY: 's',
    NPM_TOKEN: 'n', DB_PASSWORD: 'd', CHUB_BASE_URL: 'u', HOME: 'h'});
  assert.deepEqual(Object.keys(env).sort(), ['ANTHROPIC_API_KEY', 'HOME', 'PATH']);
  const root = project(t);
  const {runner, requests} = fakeRunner([clean]);
  await runLoop(root, 'menu', 'docs/spec.md', {runner, checks: pass, snapshot: noSnapshot});
  assert.deepEqual(requests[0].deniedTools, implementationDenied);
});

test('prompts list the allowed commands to be run verbatim', async t => {
  const root = project(t);
  const {runner, requests} = fakeRunner([clean]);
  await runLoop(root, 'menu', 'docs/spec.md', {runner, checks: pass, snapshot: noSnapshot});
  const [implementation, review] = requests;
  for (const command of ['npm run typecheck', 'npm run test:coverage', 'git diff']) assert.match(implementation.prompt, new RegExp('- ' + command));
  assert.match(review.prompt, /- git ls-files --others --exclude-standard/);
  assert.doesNotMatch(review.prompt, /npm run/);
  for (const prompt of [implementation.prompt, review.prompt]) assert.match(prompt, /つなげない/);
});

test('npm and environment files are protected, and gate scripts run without credentials', async () => {
  const {implementationDenied} = await import('../dist/loop.js');
  const {withoutCredentials} = await import('../dist/environment.js');
  for (const path of ['.npmrc', '**/.npmrc', '**/package.json', '.env*', '**/.env*', '.yarnrc*']) {
    assert.ok(implementationDenied.includes('Edit(' + path + ')') && implementationDenied.includes('Write(' + path + ')'), path);
  }
  // The gate keeps nothing: the tests it runs need no credentials, not even Claude Code's.
  const env = withoutCredentials({PATH: 'p', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 'o', CHUB_TOKEN: 'c', SystemRoot: 'w'});
  assert.deepEqual(Object.keys(env).sort(), ['PATH', 'SystemRoot']);
});

test('an implementation session that changes nothing is retried once, then the gate decides', async t => {
  const root = project(t);
  const {runner, requests} = fakeRunner([clean, clean]);
  // The tree changes only after the second implementation session of attempt 0.
  let state = 'before';
  const counting = async (r, request) => {
    const result = await runner(r, request);
    if (request.role === 'implementation' && requests.filter(q => q.role === 'implementation').length === 2) state = 'after';
    return result;
  };
  const result = await runLoop(root, 'menu', 'docs/spec.md', {runner: counting, checks: pass, snapshot: () => state});
  assert.equal(result.state, 'review');
  assert.deepEqual(requests.map(r => r.role), ['implementation', 'implementation', 'review']);
  assert.match(requests[1].prompt, /変更せずに終わった/);
  assert.doesNotMatch(requests[0].prompt, /変更せずに終わった/);
  assert.deepEqual([result.steps[0].implementation.retried, result.steps[0].implementation.unchanged], [true, false]);
  // Still unchanged after the retry: the review and the gate run, and the step records it.
  const other = project(t);
  const twice = fakeRunner([clean]);
  const stuck = await runLoop(other, 'menu', 'docs/spec.md', {runner: twice.runner, checks: pass, snapshot: () => 'same'});
  assert.deepEqual(twice.requests.map(r => r.role), ['implementation', 'implementation', 'review']);
  assert.deepEqual([stuck.state, stuck.steps[0].implementation.unchanged], ['review', true]);
});

test('the review sees the implementation report and empty notes are dropped', async t => {
  const root = project(t);
  const {runner, requests} = fakeRunner([{...clean, notes: ['なし']}]);
  const result = await runLoop(root, 'menu', 'docs/spec.md', {runner, checks: pass, snapshot: noSnapshot});
  assert.match(requests[1].prompt, /\.aidev\/runs\/menu\/reports\/0-implementation\.md/);
  assert.match(requests[1].prompt, /解釈を notes に必ず書く|どう解釈したかを notes に必ず書く/);
  assert.match(requests[0].prompt, /どう解釈したかを報告の「仮定」に必ず書く/);
  assert.equal(result.notes, undefined);
  assert.equal(JSON.parse(readFileSync(join(root, '.aidev/reviews/menu-0.json'), 'utf8')).notes, undefined);
  const {withoutEmptyNotes} = await import('../dist/loop.js');
  assert.deepEqual(withoutEmptyNotes({notes: ['特になし。', 'AC-001 を呼び出し側の責任と解釈した']}).notes, ['AC-001 を呼び出し側の責任と解釈した']);
});

test('the git snapshot sees changes to tracked and untracked files but not .aidev', async t => {
  const {gitSnapshot} = await import('../dist/loop.js');
  const {execFileSync} = await import('node:child_process');
  const root = project(t);
  const git = (...args) => execFileSync('git', args, {cwd: root, stdio: 'ignore'});
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'base');
  const base = gitSnapshot(root);
  assert.ok(base);
  mkdirSync(join(root, '.aidev'), {recursive: true});
  writeFileSync(join(root, '.aidev', 'report.md'), 'x');
  assert.equal(gitSnapshot(root), base);
  writeFileSync(join(root, 'new.ts'), 'a');
  const added = gitSnapshot(root);
  assert.notEqual(added, base);
  writeFileSync(join(root, 'new.ts'), 'b');
  assert.notEqual(gitSnapshot(root), added);
  writeFileSync(join(root, 'docs', 'spec.md'), 'changed');
  assert.notEqual(gitSnapshot(root), added);
});
