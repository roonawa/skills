// Stage 2 runner body: run records, one task per run, notifications (docs/autonomous-runner-design.md 5.2, 5.5, 5.6).
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChubClient } from '../dist/chub.js';
import { dryRun, main, runOnce } from '../dist/runner.js';
import { createRunRecords, taskNameOf, taskVersion } from '../dist/run-records.js';
import { BASE, TOKEN, env, fakeChub, task, template } from './chub-fake.mjs';

const sleep = async () => {};
const sections = {ready: 'AI実装待ち', review: '人のレビュー待ち', needsHuman: '人の確認待ち'};
const runnerConfig = {baseUrl: BASE, token: TOKEN, boards: ['tp-1'], sections, allowedRepositories: ['org/app']};

function setup(t, tasks) {
  const dir = mkdtempSync(join(tmpdir(), 'aidev-run-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const {transport, calls} = fakeChub({tasks});
  const client = createChubClient({baseUrl: BASE, token: TOKEN, transport, sleep});
  const records = createRunRecords(join(dir, 'state'));
  const sent = [];
  const loops = [];
  const deps = {
    records,
    prepareWorkspace: async decision => {
      const root = join(dir, 'work', decision.taskName);
      mkdirSync(root, {recursive: true});
      return root;
    },
    runLoop: async (root, name, spec) => {
      loops.push({root, name, spec, text: readFileSync(join(root, spec), 'utf8')});
      return {task: name, state: 'review', reason: 'checks-passed', attempts: 1, exitCode: 0, steps: [], costUsd: 0};
    },
    publish: async () => ({url: 'https://gitea.example.internal/org/app/pulls/5'}),
    notify: async messages => { sent.push(messages); },
  };
  return {dir, client, records, deps, sent, loops, calls};
}

test('the task version ignores line ends and trailing spaces, and changes with the text', () => {
  assert.equal(taskVersion('a\r\nb  \n\n'), taskVersion('a\nb'));
  assert.notEqual(taskVersion('a\nb'), taskVersion('a\nc'));
  assert.match(taskNameOf('task-1', 'x'), /^task-1-[0-9a-f]{8}$/);
});

test('runOnce runs the oldest eligible task once, writes its specification and notifies without moving the card', async t => {
  const tasks = [task('task-a', 351, template(), {created_at: '2026-11-01 09:00:00'}),
    task('task-b', 351, template('org/app', ['AC-001: 別の条件']), {created_at: '2026-11-02 09:00:00'})];
  const {client, records, deps, sent, loops, calls} = setup(t, tasks);
  const first = await runOnce(client, runnerConfig, deps);
  assert.equal(first.exitCode, 0);
  const name = taskNameOf('task-a', template());
  assert.deepEqual(first.report.ran, {taskId: 'task-a', taskName: name,
    result: {state: 'review', reason: 'checks-passed', attempts: 1, url: 'https://gitea.example.internal/org/app/pulls/5'}});
  assert.deepEqual(loops.map(l => [l.name, l.spec, l.text]), [[name, '.aidev/specs/' + name + '.md', template()]]);
  assert.equal(sent.length, 1);
  assert.ok(sent[0][0].startsWith('【review】タスク task-a（task-a）: 全ゲート合格（試行 1 回）。 PR: https://gitea'), sent[0][0]);
  assert.ok(sent[0][0].endsWith('カードを「人のレビュー待ち」へ移してください。'), sent[0][0]);
  assert.equal(records.read(name).result.state, 'review');
  assert.ok(calls.every(c => c.method === 'GET'), 'C-HUB is only read');
  // The next run takes the next task; task-a is not run again although its card is still in the ready section.
  const second = await runOnce(client, runnerConfig, deps);
  assert.equal(second.report.ran.taskId, 'task-b');
  const third = await runOnce(client, runnerConfig, deps);
  assert.equal(third.report.ran, null);
  assert.equal(sent.length, 2, 'nothing new, nothing sent');
});

test('needs-human is notified with the reason and where to move the card', async t => {
  const {client, deps, sent} = setup(t, [task('task-n', 351, template())]);
  deps.runLoop = async name => ({task: name, state: 'needs-human', reason: 'repeated-failure', attempts: 2, exitCode: 2, steps: [], costUsd: 0});
  const {report, exitCode} = await runOnce(client, runnerConfig, deps);
  assert.equal(exitCode, 0);
  assert.equal(report.ran.result.state, 'needs-human');
  assert.ok(sent[0][0].startsWith('【人の確認待ち】タスク task-n（task-n）: repeated-failure（試行 2 回）。'), sent[0][0]);
  assert.ok(sent[0][0].endsWith('カードを「人の確認待ち」へ移してください。'), sent[0][0]);
});

test('an ineligible task is notified once per version; a corrected description is checked again', async t => {
  const draft = task('task-c', 351, '対象リポジトリ: org/app\n基準ブランチ: main\n受け入れ条件:\n- AC-001: 件数を出す');
  const {client, records, deps, sent, loops} = setup(t, [draft]);
  const first = await runOnce(client, runnerConfig, deps);
  assert.deepEqual(first.report.notEligible.map(n => n.reasons), [['spec-missing-out-of-scope']]);
  assert.ok(sent[0][0].startsWith('【着手条件不足】') && sent[0][0].includes('やらないこと'), sent[0][0]);
  assert.ok(sent[0][0].endsWith('カードを「人の確認待ち」へ移してください。'), sent[0][0]);
  await runOnce(client, runnerConfig, deps);
  assert.equal(sent.length, 1, 'the same version is not notified twice');
  assert.equal(loops.length, 0);
  // The fake C-HUB serialises its replies when created, so the corrected task gets a new one.
  const corrected = createChubClient({baseUrl: BASE, token: TOKEN, sleep,
    transport: fakeChub({tasks: [{...draft, description: draft.description + '\nやらないこと:\n- 検索'}]}).transport});
  const fixed = await runOnce(corrected, runnerConfig, deps);
  assert.equal(fixed.report.ran.taskId, 'task-c');
  assert.equal(records.list().length, 2);
});

test('a run that stopped before its result is closed as interrupted and not run again', async t => {
  const {client, records, deps, sent, loops} = setup(t, [task('task-d', 351, template())]);
  const name = taskNameOf('task-d', template());
  records.start({name, taskId: 'task-d', board: 'tp-1', title: 'タスク task-d'});
  const dry = await dryRun(client, runnerConfig, records);
  assert.deepEqual(dry.interrupted, [{taskName: name, taskId: 'task-d', board: 'tp-1'}]);
  assert.equal(dry.next, null, 'a started version is not offered again');
  const {report} = await runOnce(client, runnerConfig, deps);
  assert.equal(report.ran, null);
  assert.equal(loops.length, 0);
  assert.ok(sent[0][0].startsWith('【中断】タスク task-d（task-d）: '), sent[0][0]);
  assert.equal(records.read(name).result.state, 'interrupted');
  assert.deepEqual((await runOnce(client, runnerConfig, deps)).report.interrupted, []);
});

test('a runner failure records only its stage; an existing work branch and a failed notification are handled', async t => {
  const {client, records, deps, sent} = setup(t, [task('task-e', 351, template()), task('task-f', 351, template('org/app', ['AC-001: x']))]);
  deps.prepareWorkspace = async () => { throw new Error('clone failed: ' + TOKEN + ' ' + BASE); };
  deps.branchExists = async (repository, branch) => branch.startsWith('aidev/task-f-');
  const {report, exitCode} = await runOnce(client, runnerConfig, deps);
  assert.equal(exitCode, 1);
  assert.deepEqual(report.ran.result, {state: 'runner-error', reason: 'workspace'});
  assert.ok(!JSON.stringify(report).includes(TOKEN) && !sent.flat().join('').includes(TOKEN));
  assert.ok(sent[0][0].startsWith('【実行不能】') && sent[0][0].includes('workspace で止まりました。'), sent[0][0]);
  assert.equal(records.read(taskNameOf('task-f', template('org/app', ['AC-001: x']))), undefined, 'task-f is skipped, not recorded');
  deps.notify = async () => { throw new Error('down'); };
  records.start({name: 'task-z-00000000', taskId: 'task-z', board: 'tp-1', title: ''});
  const failed = await runOnce(client, runnerConfig, deps);
  assert.match(failed.report.notifyError, /Gitea/);
  assert.equal(failed.exitCode, 0);
});

test('a damaged run record still counts as handled and is closed as interrupted', async t => {
  const {dir, client, records, deps} = setup(t, [task('task-k', 351, template())]);
  const name = taskNameOf('task-k', template());
  records.start({name, taskId: 'task-k', board: 'tp-1', title: ''});
  writeFileSync(join(dir, 'state', 'runs', name + '.json'), '{broken');
  const {report} = await runOnce(client, runnerConfig, deps);
  assert.equal(report.ran, null);
  assert.equal(records.read(name).result.state, 'interrupted');
});

test('stateDir must be an absolute path; dry-run with it marks processed versions', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'aidev-state-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const file = (extra) => {
    const path = join(dir, 'runner.json');
    writeFileSync(path, JSON.stringify({boards: ['tp-1'], allowedRepositories: ['org/app'], ...extra}));
    return path;
  };
  const relative = await main(['--dry-run', '--config', file({stateDir: 'state'})], env, {transport: async () => assert.fail('sent')});
  assert.match(JSON.parse(relative.output).error, /stateDir/);
  const state = join(dir, 'state');
  const records = createRunRecords(state);
  records.start({name: taskNameOf('task-g', template()), taskId: 'task-g', board: 'tp-1', title: ''});
  records.finish(taskNameOf('task-g', template()), {state: 'review', reason: 'checks-passed'});
  const {transport} = fakeChub({tasks: [task('task-g', 351, template()), task('task-h', 351, template('org/app', ['AC-001: y']))]});
  const report = JSON.parse((await main(['--dry-run', '--config', file({stateDir: state})], env, {transport, sleep})).output);
  assert.deepEqual(report.tasks.map(d => [d.id, d.processed]), [['task-g', true], ['task-h', false]]);
  assert.equal(report.next, 'task-h');
  assert.ok(existsSync(join(state, 'runs')));
});
