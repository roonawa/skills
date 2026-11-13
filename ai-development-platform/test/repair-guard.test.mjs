import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { captureGuard, CONFIG_PREFIX } from '../dist/repair-guard.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aidev-guard-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  function put(path, value) {
    const dest = join(root, path);
    mkdirSync(dirname(dest), {recursive: true});
    writeFileSync(dest, value);
  }
  return { root, put };
}

test('test file identities survive edits and additions but expose a deletion', t => {
  const { root, put } = fixture(t);
  for (const path of ['src/App.test.tsx','Assets/Tests/EditMode/ScoreTests.cs','test/smoke.mjs','pkg/score_test.go']) put(path,'initial');
  const baseline = captureGuard(root);
  assert.equal(baseline.length,4);
  assert.ok(baseline.every(key => /^[0-9a-f]{64}$/.test(key)));
  put('test/smoke.mjs','updated');
  put('src/New.spec.ts','added');
  assert.ok(baseline.every(key => captureGuard(root).includes(key)));
  unlinkSync(join(root,'src/App.test.tsx'));
  assert.equal(baseline.filter(key => !captureGuard(root).includes(key)).length,1);
});

test('protect individual checks and scanner policies without locking the manifest', t => {
  const { root, put } = fixture(t);
  const scripts = {typecheck:'tsc', lint:'lint', test:'unit', build:'bundle', 'security:audit':'audit'};
  put('package.json',JSON.stringify({scripts}));
  put('.github/workflows/codeql.yml','scan: enabled');
  put('.gitleaks.toml','policy');
  const baseline = captureGuard(root);
  assert.equal(baseline.length,7);
  put('package.json',JSON.stringify({name:'renamed',scripts:{dev:'start',...scripts}},null,2));
  assert.deepEqual(captureGuard(root),baseline);
  put('package.json',JSON.stringify({scripts:{...scripts,'security:audit':'echo ok'}}));
  put('.github/workflows/codeql.yml','scan: disabled');
  assert.equal(baseline.filter(key => !captureGuard(root).includes(key)).length,2);
});

test('ignore output, dependencies, workflow history and directory links', t => {
  const { root, put } = fixture(t);
  const external = fixture(t);
  for (const path of ['node_modules/x/test/x.js','Library/PackageCache/p/tests/x.cs','dist/spec/x.js','.aidev/runs/test/x.js','.git/test/x.js']) put(path,'ignore');
  external.put('test/would-leak.js','outside');
  symlinkSync(external.root,join(root,'linked'),'junction');
  assert.deepEqual(captureGuard(root),[]);
});

test('check settings are protected by content and tagged so additions can be detected', t => {
  const { root, put } = fixture(t);
  put('tsconfig.json','{"compilerOptions":{"strict":true}}');
  put('packages/web/eslint.config.mjs','export default [];');
  put('package.json',JSON.stringify({scripts:{test:'unit'},jest:{testMatch:['**/*.test.js']}}));
  const baseline = captureGuard(root);
  assert.equal(baseline.filter(key => key.startsWith(CONFIG_PREFIX)).length,3);
  put('tsconfig.json','{"compilerOptions":{"strict":false}}');
  put('package.json',JSON.stringify({scripts:{test:'unit'},jest:{testMatch:[]}}));
  assert.equal(baseline.filter(key => !captureGuard(root).includes(key)).length,2);
  put('biome.json','{"linter":{"enabled":false}}');
  const added = captureGuard(root).filter(key => key.startsWith(CONFIG_PREFIX) && !baseline.includes(key));
  assert.equal(added.length,3);
  for (const name of ['.c8rc.json','.nycrc','vitest.config.ts','.eslintrc.json','Directory.Build.props','rules.ruleset','.editorconfig','tsconfig.app.json']) {
    const { root: other, put: write } = fixture(t);
    write(name,'x');
    assert.equal(captureGuard(other).filter(key => key.startsWith(CONFIG_PREFIX)).length,1,name);
  }
});
