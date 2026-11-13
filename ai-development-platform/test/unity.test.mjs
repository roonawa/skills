import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkUnity } from '../dist/unity.js';

const template = fileURLToPath(new URL('../templates/unity/', import.meta.url));

test('Unity scaffold pins the Editor and framework, with real execution unavailable', () => {
  const checks = checkUnity(template);
  assert.equal(checks[0].status, 'passed');
  assert.deepEqual(checks.slice(1).map(check => check.name), ['EditMode', 'PlayMode', 'build']);
  assert.ok(checks.slice(1).every(check => check.status === 'unavailable' && check.detail));
});

test('mock runner preserves independent results without claiming real execution', () => {
  const checks = checkUnity(template, name => ({
    EditMode: { status: 'passed', detail: '2 tests' },
    PlayMode: { status: 'failed', detail: '1 failure' },
    build: { status: 'unavailable', detail: 'missing module' }
  })[name]);
  assert.deepEqual(checks.slice(1).map(check => check.status), ['passed', 'failed', 'unavailable']);
  assert.ok(checks.slice(1).every(check => check.detail.startsWith('mock: ')));
});

test('missing project or incompatible package blocks the runner', t => {
  const root = mkdtempSync(join(tmpdir(), 'aidev-unity-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const neverRun = () => assert.fail('invalid project dispatched');
  assert.equal(checkUnity(root, neverRun)[0].status, 'failed');
  mkdirSync(join(root, 'ProjectSettings'));
  mkdirSync(join(root, 'Packages'));
  writeFileSync(join(root, 'ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: 2022.3.62f1\n');
  writeFileSync(join(root, 'Packages/manifest.json'), '{"dependencies":{"com.unity.test-framework":"latest"}}');
  const checks = checkUnity(root, neverRun);
  assert.equal(checks[0].status, 'failed');
  assert.match(checks[0].detail, /com\.unity\.test-framework/);
  assert.ok(checks.slice(1).every(check => check.status === 'unavailable'));
});
