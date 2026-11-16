import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChubClient, fetchTransport, isArchived, loadChubConfig, redact, ChubHttpError } from '../dist/chub.js';
import { BASE, TOKEN, fakeChub, task } from './chub-fake.mjs';

const noSleep = async () => {};

test('reads projects, sections, tasks and a single task with GET and the bearer token only', async () => {
  const {transport, calls} = fakeChub({tasks: [task('task-1', 351, 'x')]});
  const client = createChubClient({baseUrl: BASE + '/', token: TOKEN, transport, sleep: noSleep});
  const projects = await client.listProjects();
  assert.deepEqual(projects.map(p => [p.title, p.archived]), [['テスト用ボード', false], ['古いボード', true]]);
  assert.deepEqual((await client.listSections('tp-1'))[0], {id: '351', name: 'AI実装待ち'});
  assert.equal(calls[1].url, BASE + '/api/plugin/task-manager/projects/tp-1');
  assert.equal((await client.listTasks('tp-1', true))[0].id, 'task-1');
  assert.equal((await client.getTask('task-1')).description, 'x');
  assert.ok(calls.every(c => c.method === 'GET' && c.headers.Authorization === 'Bearer ' + TOKEN));
  assert.equal(calls[2].url, BASE + '/api/plugin/task-manager/projects/tp-1/tasks?show_completed=true');
});

test('the client exposes read functions only', () => {
  const client = createChubClient({baseUrl: BASE, token: TOKEN, transport: async () => assert.fail()});
  assert.deepEqual(Object.keys(client).sort(), ['getTask', 'listProjects', 'listSections', 'listTasks']);
  assert.ok(Object.isFrozen(client));
});

test('the default transport refuses non-GET methods and does not follow redirects', async t => {
  await assert.rejects(fetchTransport({method: 'POST', url: 'http://127.0.0.1:1/', headers: {}}), /書き込み/);
  const seen = [];
  const server = createServer((req, res) => {
    seen.push([req.method, req.url]);
    if (req.url === '/redirect') { res.writeHead(302, {Location: '/elsewhere'}); res.end(); return; }
    res.writeHead(200, {'content-type': 'application/json'}); res.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const root = 'http://127.0.0.1:' + server.address().port;
  assert.deepEqual(await fetchTransport({method: 'GET', url: root + '/a', headers: {}}), {status: 200, body: '{"ok":true}'});
  assert.equal((await fetchTransport({method: 'GET', url: root + '/redirect', headers: {}})).status, 302);
  assert.deepEqual(seen, [['GET', '/a'], ['GET', '/redirect']]);
});

test('connection errors and HTTP errors do not reveal the token or the address', async () => {
  const error = await fetchTransport({method: 'GET', url: 'http://127.0.0.1:1/?k=' + TOKEN, headers: {}}).catch(e => e);
  assert.match(error.message, /接続できません（[A-Z0-9_]+）/);
  assert.ok(!error.message.includes(TOKEN) && !error.message.includes('127.0.0.1'));
  const client = createChubClient({baseUrl: BASE, token: TOKEN, transport: async () => ({status: 401, body: TOKEN}), sleep: noSleep});
  const httpError = await client.listProjects().catch(e => e);
  assert.ok(httpError instanceof ChubHttpError);
  assert.equal(httpError.status, 401);
  assert.ok(!httpError.message.includes(TOKEN) && !httpError.message.includes('chub.example'));
});

test('retries once after 429 and waits between requests', async () => {
  const waits = [];
  const statuses = [429, 200, 200];
  const client = createChubClient({baseUrl: BASE, token: TOKEN, sleep: async ms => { waits.push(ms); },
    transport: async () => ({status: statuses.shift(), body: '{"data":{"projects":[]}}'})});
  await client.listProjects();
  await client.listProjects();
  assert.deepEqual(waits, [60000, 500]);
});

test('rejects ids that could change the request path', async () => {
  const client = createChubClient({baseUrl: BASE, token: TOKEN, transport: async () => assert.fail('sent')});
  await assert.rejects(client.getTask('../projects'), /形式/);
  await assert.rejects(client.listTasks('tp-1?x=1'), /形式/);
});

test('archived accepts numbers and strings', () => {
  assert.deepEqual([0, 1, '0', '1', 'true', null, undefined].map(isArchived), [false, true, false, true, true, false, false]);
});

test('config: environment wins over the file, https only, errors never contain the values', t => {
  const dir = mkdtempSync(join(tmpdir(), 'aidev-chub-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify({chub: {baseUrl: 'https://from-file:3030', token: 'file_token_9999'},
    boards: ['テスト用ボード'], allowedRepositories: ['org/app']}));
  const fromFile = loadChubConfig(file, {});
  assert.deepEqual([fromFile.baseUrl, fromFile.token, fromFile.sections.ready], ['https://from-file:3030', 'file_token_9999', 'AI実装待ち']);
  assert.equal(loadChubConfig(file, {CHUB_TOKEN: TOKEN}).token, TOKEN);
  for (const [bad, pattern] of [[{CHUB_TOKEN: TOKEN, CHUB_BASE_URL: 'http://plain:3030'}, /https/],
    [{CHUB_BASE_URL: BASE}, /トークンがありません/], [{CHUB_TOKEN: TOKEN, CHUB_BASE_URL: 'https://u:' + TOKEN + '@h'}, /認証情報/]]) {
    const error = (() => { try { loadChubConfig(undefined, bad); } catch (e) { return e; } })();
    assert.match(error.message, pattern);
    assert.ok(!error.message.includes(TOKEN));
  }
  writeFileSync(file, '{"chub":{"token":"' + TOKEN + '"');
  const broken = (() => { try { loadChubConfig(file, {}); } catch (e) { return e; } })();
  assert.ok(!broken.message.includes(TOKEN));
  assert.equal(redact('a ' + TOKEN + ' b', [TOKEN, undefined]), 'a [redacted] b');
});
