import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGiteaClient, fetchGiteaTransport } from '../dist/gitea.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = join(root, 'templates', 'qa', 'samples', 'gitea-fake', 'server.mjs');
// 架空の値。実在のトークンではない。
const TOKEN = 'fake-token-for-test';

async function start(t, env = {GITEA_FAKE_TOKEN: TOKEN}) {
  const child = spawn(process.execPath, [serverPath, '--port', '0'], {
    env: {...process.env, GITEA_FAKE_TOKEN: '', ...env}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { child.kill(); });
  let buf = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start: ' + buf)), 10000);
    child.stdout.on('data', d => {
      buf += d;
      const m = /listening http:\/\/localhost:(\d+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + ': ' + buf)); });
  });
  return 'http://127.0.0.1:' + port;
}
const auth = {Authorization: 'token ' + TOKEN};
const call = (url, init = {}) => fetch(url, {signal: AbortSignal.timeout(10000), ...init});

test('トークンが無いと起動せず、値を出力しない', () => {
  const r = spawnSync(process.execPath, [serverPath, '--port', '0'], {
    env: {...process.env, GITEA_FAKE_TOKEN: ''}, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GITEA_FAKE_TOKEN/);
});

test('作成・検索・確認用の一覧', async t => {
  const base = await start(t);
  const url = base + '/api/v1/repos/o/r/issues';
  const created = await call(url, {method: 'POST', headers: {...auth, 'Content-Type': 'application/json'},
    body: JSON.stringify({title: 'ボタンが効かない', body: '詳細 alpha'})});
  assert.equal(created.status, 201);
  const issue = await created.json();
  assert.equal(issue.number, 1);
  assert.equal(issue.title, 'ボタンが効かない');
  assert.equal(issue.body, '詳細 alpha');
  assert.equal(issue.state, 'open');
  assert.match(issue.html_url, /^http:\/\/127\.0\.0\.1:\d+\/o\/r\/issues\/1$/);
  await call(url, {method: 'POST', headers: {...auth, 'Content-Type': 'application/json'}, body: JSON.stringify({title: 'other', body: 'x'})});

  const byTitle = await (await call(url + '?type=issues&state=all&q=' + encodeURIComponent('ボタン'), {headers: auth})).json();
  assert.deepEqual(byTitle.map(i => i.number), [1]);
  const byBody = await (await call(url + '?q=alpha', {headers: auth})).json();
  assert.deepEqual(byBody.map(i => i.number), [1]);
  const all = await (await call(url, {headers: auth})).json();
  assert.equal(all.length, 2);

  const dump = await call(base + '/__issues', {headers: auth});
  assert.equal(dump.status, 200);
  assert.equal((await dump.json()).length, 2);
});

test('トークンが違う・無いと 401（確認用の一覧も）', async t => {
  const base = await start(t);
  const url = base + '/api/v1/repos/o/r/issues';
  for (const headers of [{}, {Authorization: 'token wrong'}, {Authorization: 'Bearer ' + TOKEN}]) {
    assert.equal((await call(url, {headers})).status, 401);
    assert.equal((await call(url, {method: 'POST', headers, body: '{}'})).status, 401);
    assert.equal((await call(base + '/__issues', {headers})).status, 401);
  }
});

test('未対応の経路は 404、不正な本文は 422', async t => {
  const base = await start(t);
  assert.equal((await call(base + '/nothing', {headers: auth})).status, 404);
  const bad = await call(base + '/api/v1/repos/o/r/issues', {method: 'POST', headers: auth, body: 'not json'});
  assert.equal(bad.status, 422);
  const noTitle = await call(base + '/api/v1/repos/o/r/issues', {method: 'POST', headers: auth, body: '{"body":"x"}'});
  assert.equal(noTitle.status, 422);
});

test('src/gitea.ts の本物の fetch 通信で作成してから探せる', async t => {
  const base = await start(t);
  const client = createGiteaClient({baseUrl: base, token: TOKEN, transport: fetchGiteaTransport});
  const made = await client.createIssue('own', 'repo', {title: '検索の件数が 0', body: '本文 marker-123'});
  assert.equal(made.html_url, base + '/own/repo/issues/1');
  const found = await client.findIssues('own', 'repo', 'marker-123');
  assert.equal(found.length, 1);
  assert.equal(found[0].number, made.number);
  assert.deepEqual(await client.findIssues('own', 'repo', 'no-such-text'), []);
  const wrong = createGiteaClient({baseUrl: base, token: 'wrong', transport: fetchGiteaTransport});
  await assert.rejects(wrong.findIssues('own', 'repo', 'x'), /401/);
});
