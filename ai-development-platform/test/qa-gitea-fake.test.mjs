import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createGiteaClient, fetchGiteaTransport } from '../dist/gitea.js';
import { createIssueFromRun } from '../dist/qa-issue.js';

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

  const byTitle = await (await call(url + '?type=issues&state=all&limit=50&q=' + encodeURIComponent('ボタン'), {headers: auth})).json();
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

test('不正な URL でもサーバーは落ちず、次の要求に答える', async t => {
  const base = await start(t);
  const bad = await call(base + '/api/v1/repos/%E0%A4%A/x/issues', {headers: auth});
  assert.equal(bad.status, 400);
  const ok = await call(base + '/api/v1/repos/o/r/issues', {headers: auth});
  assert.equal(ok.status, 200);
});

test('GET /api/v1/user はトークンが要り、作った Issue に user.login が付く', async t => {
  const base = await start(t);
  assert.equal((await call(base + '/api/v1/user')).status, 401);
  const me = await (await call(base + '/api/v1/user', {headers: auth})).json();
  assert.equal(me.login, 'fake-user');
  const made = await (await call(base + '/api/v1/repos/o/r/issues', {method: 'POST', headers: auth, body: '{"title":"t"}'})).json();
  assert.deepEqual(made.user, {login: 'fake-user'});
  const found = await (await call(base + '/api/v1/repos/o/r/issues?q=t', {headers: auth})).json();
  assert.equal(found[0].user.login, 'fake-user');
});

test('qa issue create の本物の通信で、1回目は作成・2回目は重複として見つかる', async t => {
  const base = await start(t);
  const RUN = 'runs/20261118-fake';
  const result = [
    '# 実行結果', '', '- 環境: new', '',
    '| TC-ID | 結果 | 証跡 | Issue |', '|---|---|---|---|',
    '| TC-fake-001 | NG | runs/20261118-fake/evidence/TC-fake-001/ | |', '',
    '## NG の詳細', '', '### TC-fake-001 確認用の失敗',
    '- 再現手順', '  1. 画面を開く', '- 期待結果: 表示される', '- 実際の結果: 表示されない', '- 再現: 3回とも同じ', '',
  ].join('\n');
  const fresh = () => {
    const root = mkdtempSync(join(tmpdir(), 'aidev-gitea-fake-'));
    t.after(() => { rmSync(root, {recursive: true, force: true}); });
    mkdirSync(join(root, 'knowledge', 'sample-web'), {recursive: true});
    writeFileSync(join(root, 'knowledge', 'sample-web', 'profile.md'),
      '---\nproduct: sample-web\nissue_tracker: {type: gitea, url: ' + base + ', repo: qa-org/sample-web}\n---\n# 観点\n');
    mkdirSync(join(root, ...RUN.split('/')), {recursive: true});
    const file = join(root, ...RUN.split('/'), 'result.md');
    writeFileSync(file, result);
    return {root, read: () => readFileSync(file, 'utf8')};
  };
  const options = root => ({root, profile: 'knowledge/sample-web/profile.md', run: RUN, tc: 'TC-fake-001', dryRun: false, token: TOKEN, giteaUrl: base});
  const a = fresh();
  const first = await createIssueFromRun(options(a.root));
  assert.equal(first.created, true);
  assert.equal(first.issue.number, 1);
  assert.match(a.read(), /\| TC-fake-001 \| NG \|[^|]+\| #1 \|/);
  const b = fresh();
  const second = await createIssueFromRun(options(b.root));
  assert.equal(second.created, false);
  assert.equal(second.issue.number, 1);
  assert.match(b.read(), /\| #1 \|/);
  const all = await (await call(base + '/__issues', {headers: auth})).json();
  assert.equal(all.length, 1);
});

test('page と limit で区切って返す', async t => {
  const base = await start(t);
  const url = base + '/api/v1/repos/o/r/issues';
  for (let i = 1; i <= 7; i++) await call(url, {method: 'POST', headers: auth, body: JSON.stringify({title: 'n' + i})});
  const get = async query => (await (await call(url + '?' + query, {headers: auth})).json()).map(i => i.number);
  assert.deepEqual(await get('limit=3&page=1'), [1, 2, 3]);
  assert.deepEqual(await get('limit=3&page=3'), [7]);
  assert.deepEqual(await get('limit=3&page=4'), []);
  assert.equal((await get('')).length, 7);
});

test('大きすぎる本文には 413 を返し、サーバーは次の要求に答える', async t => {
  const base = await start(t);
  const url = base + '/api/v1/repos/o/r/issues';
  const res = await call(url, {method: 'POST', headers: auth, body: JSON.stringify({title: 't', body: 'x'.repeat(200 * 1024)})});
  assert.equal(res.status, 413);
  assert.equal((await call(url, {headers: auth})).status, 200);
});

test('要求の途中で切れてもサーバーは待ち続けず、次の要求に答える', async t => {
  const base = await start(t);
  const { connect } = await import('node:net');
  await new Promise(resolve => {
    const socket = connect(Number(new URL(base).port), '127.0.0.1', () => {
      socket.write('POST /api/v1/repos/o/r/issues HTTP/1.1\r\nHost: x\r\nAuthorization: token ' + TOKEN + '\r\nContent-Length: 1000\r\n\r\n{"title"');
      setTimeout(() => socket.destroy(), 100);
    });
    socket.on('close', resolve);
    socket.on('error', () => {});
  });
  assert.equal((await call(base + '/api/v1/repos/o/r/issues', {headers: auth})).status, 200);
});

test('413 を返したあとも本文を読み切り、送り手に接続のリセットを返さない', async t => {
  const base = await start(t);
  const { connect } = await import('node:net');
  const body = Buffer.alloc(32 * 1024 * 1024, 'x');
  const got = await new Promise(resolve => {
    let text = '';
    let error;
    const socket = connect(Number(new URL(base).port), '127.0.0.1', () => {
      socket.write('POST /api/v1/repos/o/r/issues HTTP/1.1\r\nHost: x\r\nAuthorization: token ' + TOKEN +
        '\r\nContent-Type: application/json\r\nContent-Length: ' + body.length + '\r\n\r\n');
      socket.write(body);
    });
    socket.setEncoding('utf8');
    socket.on('data', d => { text += d; });
    socket.on('error', e => { error = e.code; });
    socket.on('close', () => resolve({text, error}));
    setTimeout(() => socket.destroy(), 10000);
  });
  assert.equal(got.error, undefined);
  assert.match(got.text, /^HTTP\/1\.1 413 /);
  assert.equal((await call(base + '/api/v1/repos/o/r/issues', {headers: auth})).status, 200);
});
