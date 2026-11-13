import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aidev-adapters-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  return dir;
}
function invoke(cwd, args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {cwd, encoding: 'utf8'});
  assert.equal(result.status, expected, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}
for (const template of ['react', 'unity']) {
  test(template + ' init plans and installs a reproducible template', t => {
    const dir = workspace(t);
    const args = ['init','demo','--template',template];
    const planned = invoke(dir, [...args, '--dry-run']).pending;
    assert.equal(existsSync(join(dir,'demo')), false);
    assert.deepEqual(invoke(dir,args).pending, planned);
    assert.deepEqual(invoke(dir,args).pending, []);
    const project = join(dir,'demo');
    assert.equal(invoke(project,['doctor']).template,template);
    assert.deepEqual(invoke(project,['verify']).skills,[]);
    assert.equal(existsSync(join(project,'files.json')), false);
    const manifests = {react:'package-lock.json',unity:'Packages/manifest.json'};
    assert.ok(planned.includes(manifests[template]));
    const check = invoke(project,['check'],2);
    assert.equal(check.ok,false);
    assert.ok(check.checks.some(item => item.status === 'unavailable'));
  });
}
test('React check reports individual gates and excludes child output from JSON', t => {
  const dir = workspace(t);
  invoke(dir,['init','demo','--template','react']);
  const cwd = join(dir,'demo');
  const file = join(cwd,'package.json');
  const pkg = JSON.parse(readFileSync(file,'utf8'));
  mkdirSync(join(cwd,'node_modules'));
  for (const script of ['typecheck','lint','test','test:coverage','build']) pkg.scripts[script] = 'node -e "process.exit(0)"';
  pkg.scripts.lint = 'node -e "console.log(43210987);process.exit(7)"';
  writeFileSync(file,JSON.stringify(pkg));
  const result = invoke(cwd,['check'],1);
  assert.equal(result.ok,false);
  const names = ['typecheck','lint','test','coverage','build'];
  assert.deepEqual(result.checks.map(c => [c.name,c.status]),names.map(n => [n,n === 'lint' ? 'failed' : 'passed']));
  assert.ok(!JSON.stringify(result).includes('43210987'));
});
test('core check explicitly reports no application adapter', t => {
  const root = workspace(t);
  invoke(root,['init','demo']);
  const result = invoke(join(root,'demo'),['check'],2);
  assert.equal(result.checks[0].status, 'unavailable');
});

test('CLI records a failing baseline and routes a verified repair to review', t => {
  const root = workspace(t);
  invoke(root, ['init','demo','--template','react']);
  const project = join(root,'demo');
  mkdirSync(join(project,'node_modules'));
  const manifest = join(project,'package.json');
  const pkg = JSON.parse(readFileSync(manifest,'utf8'));
  for (const gate of ['typecheck','lint','test','test:coverage','build']) pkg.scripts[gate] = 'node -e "process.exit(0)"';
  // Keep the same test throughout. Only the implementation changes between checks.
  pkg.scripts.test = 'node regression.cjs';
  writeFileSync(manifest,JSON.stringify(pkg));
  writeFileSync(join(project,'regression.cjs'),"require('node:assert/strict').equal(require('./answer.cjs'),42);");
  const implementation = join(project,'answer.cjs');
  writeFileSync(implementation,'module.exports = 0;');
  writeFileSync(join(project,'review.json'),JSON.stringify({security:{status:'passed',findings:[]},spec:{status:'passed',findings:[]}}));
  // Without a review result the attempt is not reserved.
  assert.match(invoke(project,['workflow','check','answer-fix'],1).error,/--review/);
  const args = ['workflow','check','answer-fix','--review','review.json'];
  const baseline = invoke(project,args,1);
  assert.deepEqual([baseline.state,baseline.attempts],['repair',0]);
  assert.deepEqual(invoke(project,['workflow','status','answer-fix'],1),baseline);
  writeFileSync(implementation,'module.exports = 42;');
  const repaired = invoke(project,args);
  assert.deepEqual([repaired.state,repaired.attempts],['review',1]);
  assert.deepEqual(invoke(project,args),repaired);
});
