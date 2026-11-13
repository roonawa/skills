import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { checkReact } from '../dist/react.js';

test('React fingerprints distinguish causes but ignore temporary paths and durations', async t => {
  const root = mkdtempSync(join(tmpdir(), 'aidev-react-fingerprint-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root,'package.json'), JSON.stringify({scripts:{test:'node failure.cjs'}}));
  // A large progress log must not change the exit status or appear in the result.
  writeFileSync(join(root,'failure.cjs'), [
    "const fs = require('node:fs');",
    "process.stdout.write('x'.repeat(2 * 1024 * 1024) + '\\n');",
    "process.stderr.write(fs.readFileSync('diagnostic.txt'));",
    "process.exitCode = 7;"
  ].join('\n'));

  async function run(runId, elapsed, cause) {
    const temporaryFile = join(tmpdir(),runId,'fixture.ts');
    const message = 'Error: '+cause+' at '+temporaryFile+' after '+elapsed+'ms SECRET_FIXTURE_VALUE';
    writeFileSync(join(root,'diagnostic.txt'),message);
    const checks = await checkReact(root);
    assert.ok(!JSON.stringify(checks).includes('SECRET_FIXTURE_VALUE'));
    const failed = checks.find(check => check.name === 'test');
    assert.equal(failed.status,'failed');
    assert.match(failed.detail,/7$/);
    assert.match(failed.fingerprint,/^[a-f0-9]{64}$/);
    return failed.fingerprint;
  }
  const first = await run('temp-1',12,'Missing export');
  assert.equal(await run('temp-2',93.2,'Missing export'),first);
  assert.notEqual(await run('temp-3',93.2,'Invalid import'),first);
});

test('coverage runs its own script and explains how to recover', async t => {
  const root = mkdtempSync(join(tmpdir(),'aidev-react-coverage-'));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  mkdirSync(join(root,'node_modules'));
  const ok = 'node -e "process.exit(0)"';
  const scripts = {typecheck:ok,lint:ok,test:ok,build:ok};
  writeFileSync(join(root,'package.json'), JSON.stringify({scripts}));
  const missing = (await checkReact(root)).find(check => check.name === 'coverage');
  assert.equal(missing.status,'failed');
  assert.match(missing.detail,/test:coverage/);
  writeFileSync(join(root,'package.json'), JSON.stringify({scripts:{...scripts,
    'test:coverage':'node -e "console.error(\'ERROR: Coverage for lines (50%) does not meet global threshold (80%)\');process.exit(1)"'}}));
  const checks = await checkReact(root);
  assert.deepEqual(checks.map(check => [check.name,check.status]),
    [['typecheck','passed'],['lint','passed'],['test','passed'],['coverage','failed'],['build','passed']]);
  const coverage = checks.find(check => check.name === 'coverage');
  assert.match(coverage.detail,/npm run test:coverage/);
  assert.match(coverage.detail,/テストを追加/);
  assert.match(coverage.fingerprint,/^[a-f0-9]{64}$/);
});

test('timed-out npm gate stops its descendants and skips later gates', async t => {
  const root = mkdtempSync(join(tmpdir(),'aidev-react-timeout-'));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  mkdirSync(join(root,'node_modules'));
  writeFileSync(join(root,'parent.cjs'),
    "require('node:child_process').spawn(process.execPath, ['worker.cjs'], {stdio:'ignore'});");
  writeFileSync(join(root,'worker.cjs'), [
    "const fs = require('node:fs');",
    "setInterval(() => fs.appendFileSync('heartbeat', '.'), 50);",
    "setTimeout(() => process.exit(), 15000);"
  ].join('\n'));
  const later = 'node -e "require(\'node:fs\').writeFileSync(\'unexpected\',\'ran\')"';
  writeFileSync(join(root,'package.json'), JSON.stringify({
    scripts:{typecheck:'node parent.cjs',lint:later,test:later,'test:coverage':later,build:later}
  }));
  const checks = await checkReact(root,6000);
  assert.ok(checks.every(check => check.status === 'unavailable'));
  assert.match(checks[0].detail,/タイムアウト/);
  const heartbeat = join(root,'heartbeat');
  const before = readFileSync(heartbeat,'utf8');
  assert.ok(before.length > 0);
  await delay(300);
  assert.equal(readFileSync(heartbeat,'utf8'),before);
  assert.equal(existsSync(join(root,'unexpected')),false);
});
