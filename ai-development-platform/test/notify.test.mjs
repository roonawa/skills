// Buddy notifications (sugar-forum digest): one POST endpoint, 5 a day, held messages go out the next day.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createDigestNotifier, digestPath, fetchDigestTransport, japanDay, maxDigestChars } from '../dist/notify.js';
import { main } from '../dist/runner.js';
import { BASE, TOKEN, env as chubEnv, fakeChub, task, template } from './chub-fake.mjs';

function setup(t, start = '2026-11-26T00:30:00Z') {
  const dir = mkdtempSync(join(tmpdir(), 'aidev-notify-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const calls = [];
  let status = 200;
  const clock = {now: new Date(start)};
  const notifier = createDigestNotifier({baseUrl: BASE + '/', token: TOKEN, stateDir: dir, now: () => clock.now,
    transport: async request => { calls.push(request); return {status}; }});
  const contents = () => calls.map(call => JSON.parse(call.body).content);
  return {dir, calls, contents, notifier, clock, setStatus: value => { status = value; }};
}

test('one POST to the digest path with the key in the header; nothing is sent without messages', async t => {
  const {calls, notifier} = setup(t);
  assert.deepEqual(await notifier.notify([]), {sent: false, waiting: 0});
  assert.equal(calls.length, 0);
  assert.deepEqual(await notifier.notify(['【review】A', '【着手条件不足】B']), {sent: true, waiting: 0});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, BASE + digestPath);
  assert.equal(calls[0].headers.Authorization, 'Bearer ' + TOKEN);
  assert.deepEqual(JSON.parse(calls[0].body), {content: '【review】A\n【着手条件不足】B'});
  assert.ok(!calls[0].body.includes(TOKEN));
});

test('four notifications a day go out as they come; the fifth says the rest comes tomorrow; later ones wait', async t => {
  const {contents, notifier, clock} = setup(t);
  for (const n of [1, 2, 3, 4]) assert.equal((await notifier.notify(['結果' + n])).sent, true);
  assert.equal((await notifier.notify(['結果5'])).sent, true);
  assert.match(contents()[4], /^結果5\n（本日の通知はこれが最後です。/);
  assert.deepEqual(await notifier.notify(['結果6']), {sent: false, waiting: 1});
  assert.deepEqual(await notifier.notify(['結果7']), {sent: false, waiting: 2});
  assert.equal(contents().length, 5);
  // Next day in Japan time (00:30 UTC is 09:30 JST; 15:30 UTC is 00:30 JST the next day): held messages go first.
  clock.now = new Date('2026-11-26T15:30:00Z');
  assert.equal(japanDay(clock.now), '2026-11-27');
  assert.deepEqual(await notifier.notify([]), {sent: true, waiting: 0});
  assert.equal(contents()[5], '結果6\n結果7');
});

test('a refused or failed send keeps its messages for the next start', async t => {
  const {contents, notifier, setStatus} = setup(t);
  setStatus(400);
  await assert.rejects(notifier.notify(['結果A']), error => /400/.test(error.message) && /未確認/.test(error.message) && !error.message.includes(TOKEN));
  assert.deepEqual(notifier.pending(), ['結果A']);
  setStatus(201);
  assert.equal((await notifier.notify(['結果B'])).sent, true);
  assert.equal(contents().at(-1), '結果A\n結果B');
  assert.deepEqual(notifier.pending(), []);
});

test('messages beyond 4000 characters wait for the next notification; one overlong message is cut', async t => {
  const {contents, notifier} = setup(t);
  const long = 'あ'.repeat(2500);
  await notifier.notify([long, long, 'い'.repeat(5000)]);
  assert.equal(contents()[0], long);
  assert.deepEqual(notifier.pending().map(m => m.length), [2500, 5000]);
  await notifier.notify([]);
  assert.equal(contents()[1], long);
  await notifier.notify([]);
  assert.ok(contents()[2].length <= maxDigestChars);
});

test('a damaged counter file starts over instead of stopping notifications', async t => {
  const {dir, notifier} = setup(t);
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'notify.json'), '{broken');
  assert.equal((await notifier.notify(['結果'])).sent, true);
});

test('the default transport posts only to the digest path', async () => {
  for (const request of [{method: 'POST', url: BASE + '/api/plugin/task-manager/tasks/1', headers: {}, body: '{}'},
    {method: 'GET', url: BASE + digestPath, headers: {}, body: ''}]) {
    await assert.rejects(fetchDigestTransport(request), /通知の送り先以外/);
  }
});

test('--once sends the run messages to the buddy with the C-HUB key, and notify:false turns it off', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'aidev-notify-run-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const git = (cwd, ...args) => assert.equal(spawnSync('git', args, {cwd}).status, 0);
  const seed = join(dir, 'seed');
  mkdirSync(seed);
  writeFileSync(join(seed, 'README.md'), 'x\n');
  git(dir, 'init', '--quiet', '--initial-branch=main', seed);
  git(seed, 'add', '-A');
  git(seed, '-c', 'user.name=s', '-c', 'user.email=s@localhost', 'commit', '--quiet', '-m', 's');
  const origin = join(dir, 'origin.git');
  git(dir, 'clone', '--quiet', '--bare', seed, origin);
  const config = notify => {
    const file = join(dir, 'runner-' + notify + '.json');
    writeFileSync(file, JSON.stringify({boards: ['tp-1'], allowedRepositories: ['org/app'], stateDir: join(dir, 'state-' + notify),
      gitea: {baseUrl: 'https://gitea.example.internal'}, notify}));
    return file;
  };
  const posts = [];
  // Each run uses its own task: the first run's work branch is already in origin, and pushes never force.
  const deps = id => ({transport: fakeChub({tasks: [task(id, 351, template())]}).transport, sleep: async () => {},
    giteaTransport: async request => request.method === 'GET' ? {status: 404, body: ''} :
      {status: 201, body: JSON.stringify({number: 1, html_url: 'https://gitea.example.internal/org/app/pulls/1'})},
    remoteUrl: () => 'file:///' + origin.replace(/\\/g, '/').replace(/^\//, ''),
    runLoop: async name => ({task: name, state: 'review', reason: 'checks-passed', attempts: 1, exitCode: 0, costUsd: 0, steps: []}),
    digestTransport: async request => { posts.push(request); return {status: 200}; }});
  const env = {...chubEnv, GITEA_TOKEN: 'gitea_token_for_notify_test'};
  const on = await main(['--once', '--config', config(true)], env, deps('task-a'));
  assert.equal(on.exitCode, 0, on.output);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].headers.Authorization, 'Bearer ' + TOKEN);
  assert.match(JSON.parse(posts[0].body).content, /^【review】タスク task-a（task-a）: 全ゲート合格/);
  const off = await main(['--once', '--config', config(false)], env, deps('task-b'));
  assert.equal(off.exitCode, 0, off.output);
  assert.equal(posts.length, 1, 'notify:false sends nothing');
  assert.equal(JSON.parse(off.output).notifications.length, 1, 'the text is still in the output');
});
