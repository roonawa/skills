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
for (const template of ['react', 'unity', 'qa']) {
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
    const manifests = {react:'package-lock.json',unity:'Packages/manifest.json',qa:'plan/acceptance.md'};
    assert.ok(planned.includes(manifests[template]));
    const check = invoke(project,['check'],2);
    assert.equal(check.ok,false);
    assert.ok(check.checks.some(item => item.status === 'unavailable'));
  });
}
test('init --template qa creates the QA repository skeleton', t => {
  const dir = workspace(t);
  invoke(dir,['init','demo','--template','qa']);
  const project = join(dir,'demo');
  for (const file of ['README.md','plan/acceptance.md','cases/README.md','runs/README.md','reports/README.md','knowledge/README.md','knowledge/profile.template.md']) {
    assert.ok(existsSync(join(project,file)), file);
  }
  assert.equal(existsSync(join(project,'files.json')), false);
  const check = invoke(project,['check'],2);
  assert.equal(check.checks[0].status,'unavailable');
});
test('init --template qa creates automation/README.md and a .gitignore that keeps sessions out of git', t => {
  const dir = workspace(t);
  invoke(dir,['init','demo','--template','qa']);
  const project = join(dir,'demo');
  assert.ok(existsSync(join(project,'automation','README.md')));
  const ignore = readFileSync(join(project,'.gitignore'),'utf8').split(/\r?\n/);
  for (const line of ['automation/web/.auth/','node_modules/','test-results/','.qa-scratch/','playwright-report/','automation/desktop/**/bin/','automation/desktop/**/obj/']) {
    assert.ok(ignore.includes(line), line);
  }
  assert.ok(!ignore.some(line => line.includes('evidence')));
});
test('check runs profile checks for each product', t => {
  const dir = workspace(t);
  invoke(dir,['init','demo','--template','qa']);
  const project = join(dir,'demo');
  mkdirSync(join(project,'knowledge','sample-web'),{recursive:true});
  const profile = join(project,'knowledge','sample-web','profile.md');
  writeFileSync(profile,'---\nproduct: sample-web\nroles:\n  - {name: staff, user_env: SAMPLE_STAFF_USER, password_env: SAMPLE_STAFF_PASSWORD}\n---\n# 観点\n');
  const ok = invoke(project,['check'],0);
  assert.equal(ok.checks[0].name,'profile:sample-web');
  assert.equal(ok.checks[0].status,'passed');
  writeFileSync(profile,readFileSync(profile,'utf8')+'password: hunter2\n');
  const ng = invoke(project,['check'],1);
  assert.equal(ng.checks[0].status,'failed');
  assert.ok(ng.checks[0].detail.includes('secret'));
  assert.ok(!JSON.stringify(ng).includes('hunter2'));
});
test('the qa profile template passes with only the product filled in', t => {
  const dir = workspace(t);
  invoke(dir,['init','demo','--template','qa']);
  const project = join(dir,'demo');
  const template = readFileSync(join(project,'knowledge','profile.template.md'),'utf8');
  assert.match(template,/^product: .*$/m);
  mkdirSync(join(project,'knowledge','sample-web'),{recursive:true});
  writeFileSync(join(project,'knowledge','sample-web','profile.md'),template.replace(/^product: .*$/m,'product: sample-web'));
  const result = invoke(project,['check'],0);
  assert.deepEqual(result.checks.map(c => [c.name,c.status]),[['profile:sample-web','passed']]);
});
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
