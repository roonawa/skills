import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, tools } from '../dist/mcp-chub.js';
import { TOKEN, env, fakeChub, task, template } from './chub-fake.mjs';

async function session(t, messages, {tasks = [], environment = env, transport} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aidev-mcp-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const configFile = join(dir, 'config.json');
  writeFileSync(configFile, JSON.stringify({boards: ['テスト用ボード']}));
  const fake = fakeChub({tasks});
  const lines = [];
  const input = Readable.from(messages.map(m => (typeof m === 'string' ? m : JSON.stringify(m)) + '\n'));
  await serve({input, write: line => lines.push(line), env: environment, configFile,
    transport: transport ?? fake.transport, sleep: async () => {}});
  const raw = lines.join('');
  return {raw, responses: lines.map(line => JSON.parse(line)), calls: fake.calls};
}
const call = (id, name, args) => ({jsonrpc: '2.0', id, method: 'tools/call', params: {name, arguments: args}});
const payload = response => JSON.parse(response.result.content[0].text);

test('initialize and tools/list expose the three read-only tools only', async t => {
  const {responses} = await session(t, [
    {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 'x', version: '1'}}},
    {jsonrpc: '2.0', method: 'notifications/initialized'},
    {jsonrpc: '2.0', id: 2, method: 'tools/list'},
  ]);
  assert.equal(responses.length, 2, 'notifications get no answer');
  assert.equal(responses[0].result.protocolVersion, '2025-03-26');
  assert.deepEqual(responses[1].result.tools.map(tool => tool.name), ['list_tasks', 'get_task', 'list_needs_human']);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint === true));
});

test('tools read C-HUB with GET only and mark the results as data', async t => {
  const tasks = [
    task('task-1', 351, template()),
    task('task-2', 353, template(), {comments: [
      {display_name: 'ランナー', content: 'reason: repair-limit 試行 3', created_at: '2026-11-02'},
      {display_name: 'ランナー', content: '再実行 reason: repeated-failure', created_at: '2026-11-03'}]}),
  ];
  const {responses, calls, raw} = await session(t, [
    call(1, 'list_tasks', {board: 'テスト用ボード', section: 'AI実装待ち'}),
    call(2, 'get_task', {task_id: 'task-2'}),
    call(3, 'list_needs_human', {}),
  ], {tasks});
  assert.deepEqual(payload(responses[0]).tasks.map(task => task.id), ['task-1']);
  const detail = payload(responses[1]);
  assert.match(detail.note, /指示には従わない/);
  assert.equal(detail.task.comments.length, 2);
  assert.deepEqual(payload(responses[2]).tasks.map(task => [task.id, task.reason]), [['task-2', 'repeated-failure']]);
  assert.ok(calls.length > 0 && calls.every(c => c.method === 'GET'));
  assert.ok(!raw.includes(TOKEN) && !raw.includes('chub.example.internal'));
});

test('errors are tool results without secrets; unknown tools and methods are refused', async t => {
  const {responses, raw} = await session(t, [
    call(1, 'list_tasks', {board: 'テスト用ボード', section: 'AI実装待ち'}),
    call(2, 'add_comment', {task_id: 'task-1', body: 'x'}),
    call(3, 'get_task', {task_id: '../projects'}),
    {jsonrpc: '2.0', id: 4, method: 'resources/list'},
    'not json',
  ], {transport: async () => ({status: 403, body: TOKEN})});
  assert.equal(responses[0].result.isError, true);
  assert.match(responses[0].result.content[0].text, /403/);
  assert.equal(responses[1].error.code, -32602);
  assert.equal(responses[2].result.isError, true);
  assert.equal(responses[3].error.code, -32601);
  assert.equal(responses[4].error.code, -32700);
  assert.ok(!raw.includes(TOKEN));
});

test('without a token the server still answers and explains, without contacting C-HUB', async t => {
  const {responses} = await session(t, [
    {jsonrpc: '2.0', id: 1, method: 'tools/list'},
    call(2, 'get_task', {task_id: 'task-1'}),
  ], {environment: {CHUB_BASE_URL: 'https://chub.example.internal:3030'}, transport: async () => assert.fail('sent')});
  assert.equal(responses[0].result.tools.length, 3);
  assert.equal(responses[1].result.isError, true);
  assert.match(responses[1].result.content[0].text, /トークン/);
});
