import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow, readWorkflowStatus } from '../dist/workflow.js';
import { readReview } from '../dist/review.js';

function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'aidev-workflow-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  return root;
}
const fail = (name, detail) => ({name, status: 'failed', detail});
const pass = [{name: 'build', status: 'passed'}];

test('status reads the last completed result without consuming a repair', async t => {
  const root = project(t);
  assert.throws(() => readWorkflowStatus(root, 'menu'), /記録/);
  const first = await runWorkflow(root, 'menu', () => [fail('build','x')]);
  assert.deepEqual(readWorkflowStatus(root, 'menu'), first);
  assert.deepEqual(readWorkflowStatus(root, 'menu'), first);
  assert.equal((await runWorkflow(root, 'menu', () => pass)).attempts, 1);
});

test('baseline plus three repairs may reach review; terminals replay without execution', async t => {
  const root = project(t);
  const run = checks => runWorkflow(root, 'menu', () => checks);
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await run([fail('build', 'private detail ' + attempt)]);
    assert.deepEqual([result.state, result.attempts], ['repair', attempt]);
  }
  const last = await run(pass);
  assert.deepEqual([last.state, last.attempts, last.exitCode], ['review', 3, 0]);
  assert.deepEqual(await runWorkflow(root, 'menu', () => assert.fail('terminal re-executed')), last);
  const dir = join(root, '.aidev/runs/menu');
  const records = readdirSync(dir).filter(name => name.endsWith('.json'));
  assert.equal(records.length, 4);
  assert.ok(records.every(name => !readFileSync(join(dir,name),'utf8').includes('private detail')));
});

test('repeated individual failure stops despite a different set of failing checks', async t => {
  const root = project(t);
  await runWorkflow(root, 'a', () => [fail('lint','x'), fail('test','y')]);
  const next = await runWorkflow(root, 'a', () => [fail('lint','x'), fail('build','z')]);
  assert.deepEqual([next.state,next.attempts,next.exitCode], ['needs-human',1,1]);
});

test('adapter fingerprints distinguish diagnostics with identical details', async t => {
  const root = project(t);
  const run = fingerprint => runWorkflow(root, 'menu', () => [{...fail('test','exit 1'), fingerprint}]);
  assert.equal((await run('A')).state,'repair');
  assert.equal((await run('B')).state,'repair');
  assert.equal((await run('A')).reason,'repeated-failure');
});

test('an interrupted attempt remains reserved and status identifies it', async t => {
  const root = project(t);
  const last = await runWorkflow(root, 'menu', () => [fail('test','broken')]);
  writeFileSync(join(root, '.aidev/runs/menu/1.claim'), '123');
  assert.deepEqual(readWorkflowStatus(root,'menu'), {...last, pendingAttempt:1});
  await assert.rejects(() => runWorkflow(root, 'menu', () => pass), /中断/);
});

test('unavailable takes precedence and fourth failed check exhausts attempts', async t => {
  const root = project(t);
  const unavailable = await runWorkflow(root, 'a', () => [fail('lint','x'), {name:'build',status:'unavailable'}]);
  assert.deepEqual([unavailable.state, unavailable.exitCode], ['needs-human',2]);
  for (let i=0; i<4; i++) {
    const result = await runWorkflow(root, 'b', () => [fail('test',String(i))]);
    assert.equal(result.state, i === 3 ? 'needs-human' : 'repair');
  }
});

test('exclusive claim blocks a competing runner and unsafe task names', async t => {
  const root = project(t);
  const other = () => assert.fail('concurrent invocation ran checks');
  await assert.rejects(() => runWorkflow(root, '../bad', other));
  const result = await runWorkflow(root, 'a', async () => {
    await assert.rejects(() => runWorkflow(root, 'a', other), /実行中|中断/);
    return pass;
  });
  assert.equal(result.state,'review');
});

for (const change of ['delete test', 'replace gate']) {
  test(change + ' stops before recheck and remains stopped', async t => {
    const root = project(t);
    const file = join(root, 'menu.test.mjs');
    const manifest = join(root, 'package.json');
    writeFileSync(file, 'test("menu", () => {});');
    writeFileSync(manifest, JSON.stringify({scripts:{test:'node --test'}}));
    await runWorkflow(root, 'menu', () => [fail('test','broken')]);
    if (change === 'delete test') rmSync(file);
    else writeFileSync(manifest, JSON.stringify({scripts:{test:'node -e "process.exit(0)"'}}));
    let invocations = 0;
    const run = () => { invocations++; return pass; };
    const result = await runWorkflow(root, 'menu', run);
    assert.deepEqual([result.state,result.reason,invocations], ['needs-human','protected-check-changed',0]);
    assert.deepEqual(await runWorkflow(root, 'menu', run), result);
    assert.equal(invocations, 0);
  });
}

test('a check setting added or changed after the first check stops the task', async t => {
  for (const change of [
    root => writeFileSync(join(root,'biome.json'),'{"linter":{"enabled":false}}'),
    root => writeFileSync(join(root,'tsconfig.json'),'{"compilerOptions":{"strict":false}}'),
  ]) {
    const root = project(t);
    writeFileSync(join(root,'tsconfig.json'),'{"compilerOptions":{"strict":true}}');
    assert.equal((await runWorkflow(root,'menu',() => [fail('lint','x')])).state,'repair');
    change(root);
    const stopped = await runWorkflow(root,'menu',() => pass);
    assert.deepEqual([stopped.state,stopped.reason],['needs-human','protected-check-changed']);
    assert.deepEqual(readWorkflowStatus(root,'menu'),stopped);
  }
});

test('baselines recorded before setting protection are not stopped by existing settings', async t => {
  const root = project(t);
  writeFileSync(join(root,'tsconfig.json'),'{}');
  await runWorkflow(root,'menu',() => [fail('lint','x')]);
  const first = join(root,'.aidev/runs/menu/0.json');
  const record = JSON.parse(readFileSync(first,'utf8'));
  delete record.guardVersion;
  record.guard = record.guard.filter(key => !key.startsWith('config:'));
  writeFileSync(first,JSON.stringify(record) + String.fromCharCode(10));
  assert.equal((await runWorkflow(root,'menu',() => pass)).state,'review');
});

const gate = (name, findings) => ({name, status: findings.length ? 'failed' : 'passed', ...(findings.length ? {findings} : {})});
const spec = (ref, summary, kind = 'deviation') => ({kind, ref, file: 'src/menu.ts', summary});
const security = (ref, summary) => ({ref, file: 'src/api.ts', summary});

test('review gates with new causes loop three repairs, then hand the task to a person', async t => {
  const root = project(t);
  const findings = [
    [spec('AC-001', 'empty input accepted')],
    [security('CWE-79', 'title rendered as raw HTML')],
    [spec('EXCESS-1', 'unrequested CSV export added', 'excess')],
    [spec('AC-002', 'boundary uses > instead of >=')],
  ];
  for (const [attempt, list] of findings.entries()) {
    const review = [gate('security', list.filter(f => !f.kind)), gate('spec', list.filter(f => f.kind))];
    const result = await runWorkflow(root, 'menu', () => pass, review);
    assert.equal(result.state, attempt === 3 ? 'needs-human' : 'repair');
  }
  const last = readWorkflowStatus(root, 'menu');
  assert.deepEqual([last.reason, last.attempts, last.handoff], ['repair-limit', 3, '.aidev/runs/menu/handoff.md']);
  const handoff = readFileSync(join(root, last.handoff), 'utf8');
  for (const text of ['[仕様乖離 AC-001] src/menu.ts: empty input accepted', 'セキュリティ: 失敗',
    '[CWE-79] src/api.ts: title rendered as raw HTML', '[過剰実装 EXCESS-1]', '### 修正3回目の後', 'repair-limit']) {
    assert.ok(handoff.includes(text), text);
  }
});

test('an unresolved review finding stops before the third repair', async t => {
  const root = project(t);
  const review = summary => [gate('security', []), gate('spec', [spec('AC-001', summary)])];
  assert.equal((await runWorkflow(root, 'menu', () => pass, review('first wording'))).state, 'repair');
  // The wording differs, but the same AC in the same file is still open.
  const next = await runWorkflow(root, 'menu', () => pass, review('second wording'));
  assert.deepEqual([next.state, next.reason, next.attempts], ['needs-human', 'repeated-failure', 1]);
  assert.match(readFileSync(join(root, next.handoff), 'utf8'), /second wording/);
});

test('all gates passing goes to review without a handoff', async t => {
  const root = project(t);
  const result = await runWorkflow(root, 'menu', () => pass, [gate('security', []), gate('spec', [])]);
  assert.deepEqual([result.state, result.handoff], ['review', undefined]);
  assert.equal(readdirSync(join(root, '.aidev/runs/menu')).includes('handoff.md'), false);
});

test('an existing handoff is kept and a missing one is written on replay', async t => {
  const root = project(t);
  await runWorkflow(root, 'a', () => [fail('test', 'x')]);
  const stopped = await runWorkflow(root, 'a', () => [fail('test', 'x')]);
  const path = join(root, stopped.handoff);
  writeFileSync(path, 'person notes');
  assert.deepEqual(await runWorkflow(root, 'a', () => assert.fail('re-executed')), stopped);
  assert.equal(readFileSync(path, 'utf8'), 'person notes');
  rmSync(path);
  await runWorkflow(root, 'a', () => assert.fail('re-executed'));
  assert.match(readFileSync(path, 'utf8'), /repeated-failure/);
});

test('review files are validated before use', t => {
  const root = project(t);
  const write = data => { writeFileSync(join(root, 'review.json'), JSON.stringify(data)); return 'review.json'; };
  const ok = {status: 'passed', findings: []};
  assert.deepEqual(readReview(root, write({security: ok, spec: ok})).map(c => c.status), ['passed', 'passed']);
  for (const bad of [
    {security: ok},
    {security: ok, spec: ok, extra: ok},
    {security: {status: 'failed', findings: []}, spec: ok},
    {security: {status: 'passed', findings: [security('CWE-1', 'x')]}, spec: ok},
    {security: ok, spec: {status: 'failed', findings: [{ref: 'AC-1', file: 'a', summary: 'no kind'}]}},
    {security: {status: 'failed', findings: [{...security('CWE-1', 'x'), kind: 'excess'}]}, spec: ok},
    {security: {status: 'failed', findings: [security('CWE 1', 'bad ref')]}, spec: ok},
    {security: {status: 'failed', findings: [security('CWE-1', 'line\nbreak')]}, spec: ok},
  ]) assert.throws(() => readReview(root, write(bad)), /形式/);
  assert.throws(() => readReview(root, 'missing.json'), /ありません/);
  assert.throws(() => readReview(root, '../outside.json'));
});
