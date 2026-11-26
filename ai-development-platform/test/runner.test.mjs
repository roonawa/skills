import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, main, parseRequest } from '../dist/runner.js';
import { BASE, TOKEN, env, fakeChub, task, template } from './chub-fake.mjs';

const sleep = async () => {};
const codes = decision => decision.reasons.map(r => r.code);

test('parseRequest reads the request template and only AC lines under 受け入れ条件', () => {
  const text = template('org/app', ['AC-001: a', 'AC-002：b', 'AC-001: duplicate']) + '\n- AC-009: outside';
  assert.deepEqual(parseRequest(text.replace(/\n/g, '\r\n')),
    {repository: 'org/app', baseBranch: 'main', acceptanceIds: ['AC-001', 'AC-002']});
  assert.deepEqual(parseRequest('受け入れ条件:\n- 件数を出す\n- AC-1 説明なし'), {acceptanceIds: []});
});

test('decide applies the start conditions of 5.2', () => {
  const allowed = ['org/app'];
  assert.deepEqual(codes(decide(task('task-1', 351, template()), 'b', allowed)), []);
  assert.deepEqual(codes(decide(task('task-1', 351, ''), 'b', allowed)),
    ['missing-repository', 'missing-base-branch', 'missing-acceptance', 'spec-missing-out-of-scope']);
  // The specification check of `aidev spec check` is part of the start conditions.
  assert.deepEqual(codes(decide(task('task-1', 351, template() + '\n判断待ち:\n- 0件の表示文言'), 'b', allowed)), ['spec-open-questions']);
  assert.ok(codes(decide(task('task-1', 351, template('org/app', ['AC-001: 文言は ⚠要確認'])), 'b', allowed)).includes('spec-unconfirmed'));
  assert.deepEqual(codes(decide(task('task-' + 'x'.repeat(51), 351, template()), 'b', allowed)), ['invalid-task-id']);
  assert.deepEqual(codes(decide(task('task-1', 351, template('org/other')), 'b', allowed)), ['repository-not-allowed']);
  assert.deepEqual(codes(decide(task('task-1', 351, template('../etc')), 'b', allowed)), ['invalid-repository']);
  assert.deepEqual(codes(decide(task('task-1', 351, template('org/app', [])), 'b', allowed)), ['missing-acceptance']);
  assert.deepEqual(codes(decide(task('task-1', 351, template().replace('main', '-x..y')), 'b', allowed)), ['invalid-base-branch']);
  assert.deepEqual(codes(decide(task('Task_1', 351, template()), 'b', allowed)), ['invalid-task-id']);
  assert.deepEqual(codes(decide(task('task-1', 351, template()), 'b', [])), ['repository-not-allowed']);
});

function config(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aidev-runner-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const file = join(dir, 'runner.json');
  writeFileSync(file, JSON.stringify({boards: ['テスト用ボード', '無いボード'], allowedRepositories: ['org/app'], ...extra}));
  return file;
}

test('dry-run reports decisions oldest first, sends GET only and never prints the token or the address', async t => {
  const {transport, calls} = fakeChub({tasks: [
    task('task-new', 351, template(), {created_at: '2026-11-03 10:00:00'}),
    task('task-old', 351, 'お願いします', {created_at: '2026-11-01 10:00:00'}),
    task('task-mid', 351, template('org/app') + '\n' + TOKEN, {created_at: '2026-11-02 10:00:00'}),
    task('task-run', 352, template()),
    task('task-other', 353, template()),
  ]});
  const {output, exitCode} = await main(['--dry-run', '--config', config(t)], env, {transport, sleep});
  assert.equal(exitCode, 0);
  assert.ok(!output.includes(TOKEN) && !output.includes('chub.example.internal'));
  const report = JSON.parse(output);
  assert.deepEqual(report.tasks.map(d => [d.id, d.eligible]), [['task-old', false], ['task-mid', true], ['task-new', true]]);
  assert.equal(report.next, 'task-mid');
  assert.match(report.tasks[1].taskName, /^task-mid-[0-9a-f]{8}$/);
  assert.deepEqual(report.interrupted, []);
  assert.deepEqual(report.boards.map(b => [b.name, b.found, b.readyCount]), [['テスト用ボード', true, 3], ['無いボード', false, 0]]);
  assert.ok(calls.length > 0 && calls.every(c => c.method === 'GET'));
  assert.ok(calls.some(c => c.url.endsWith('/tasks/task-old')), 'reads the single task for the description');
});

test('a task moved while reading is not eligible', async t => {
  const moved = task('task-moved', 351, template());
  const {transport} = fakeChub({tasks: [moved], overrides: {
    '/api/plugin/task-manager/tasks/task-moved': {status: 200, body: JSON.stringify({data: {task: {...moved, section_id: 352}}})}}});
  const report = JSON.parse((await main(['--dry-run', '--config', config(t)], env, {transport, sleep})).output);
  assert.deepEqual(codes(report.tasks[0]), ['section-changed']);
  assert.equal(report.next, null);
});

test('failures exit 1 without revealing secrets; only --dry-run is accepted', async t => {
  const file = config(t);
  const unauthorized = await main(['--dry-run', '--config', file], env,
    {transport: async () => ({status: 401, body: TOKEN + ' ' + BASE}), sleep});
  assert.equal(unauthorized.exitCode, 1);
  assert.match(JSON.parse(unauthorized.output).error, /401/);
  assert.ok(!unauthorized.output.includes(TOKEN) && !unauthorized.output.includes('chub.example.internal'));
  for (const args of [[], ['--config', file], ['--dry-run', '--apply', '--config', file], ['--dry-run', '--config']]) {
    const result = await main(args, env, {transport: async () => assert.fail('sent')});
    assert.equal(result.exitCode, 1);
    assert.match(JSON.parse(result.output).error, /--dry-run/);
  }
  const noBoards = await main(['--dry-run', '--config', config(t, {boards: []})], env, {transport: async () => assert.fail('sent')});
  assert.match(JSON.parse(noBoards.output).error, /boards/);
});

test('boards can be named by project ID; archived projects are skipped either way', async t => {
  const {transport} = fakeChub({tasks: [task('task-a', 351, template())]});
  const {output} = await main(['--dry-run', '--config', config(t, {boards: ['tp-1', 'tp-old']})], env, {transport, sleep});
  const report = JSON.parse(output);
  assert.deepEqual(report.boards.map(b => [b.name, b.found, b.readyCount]), [['tp-1', true, 1], ['tp-old', false, 0]]);
  assert.equal(report.next, 'task-a');
});
