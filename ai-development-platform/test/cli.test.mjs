import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
function run(cwd, args, status = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, status, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}
function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'aidev-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  return root;
}
test('initialize, discover, install, repeat and detect drift', t => {
  const root = sandbox(t);
  const project = join(root, 'demo');
  run(root, ['init','demo','--template','core','--dry-run']);
  assert.equal(existsSync(project), false);
  run(root, ['init','demo','--template','core']);
  assert.deepEqual(run(root, ['init','demo']).pending, []);
  assert.ok(run(project,['skill','list']).skills.some(skill => skill.name === 'aidev-project-verification'));
  run(project,['skill','validate','aidev-project-verification']);
  run(project,['doctor']);
  const add = ['skill','add','aidev-project-verification'];
  run(project,[...add,'--dry-run']);
  assert.equal(existsSync(join(project,'.agents')),false);
  run(project,add);
  assert.deepEqual(run(project,add).pending,[]);
  assert.deepEqual(run(project,['verify']).skills,['aidev-project-verification']);
  const path = join(project,'.claude/skills/aidev-project-verification/SKILL.md');
  unlinkSync(path);
  run(project,['verify'],1);
  run(project,add);
  writeFileSync(path,'local edits');
  run(project,add,1);
  run(project,['verify'],1);
  assert.equal(readFileSync(path,'utf8'),'local edits');
});
test('distribute all eight core workflows to both hosts', t => {
  const root = sandbox(t);
  run(root, ['init', 'demo']);
  const project = join(root, 'demo');
  const core = ['architecture', 'code-review', 'debugging', 'implementation',
    'requirements', 'skill-evolution', 'task-planning', 'testing'].map(name => 'aidev-' + name);
  const available = run(project, ['skill', 'list']).skills.map(skill => skill.name);
  for (const name of core) {
    assert.ok(available.includes(name), 'missing core skill: ' + name);
    assert.equal(run(project, ['skill', 'validate', name]).skill.name, name);
    run(project, ['skill', 'add', name]);
    const source = readFileSync(new URL('../skills/core/' + name + '/SKILL.md', import.meta.url));
    for (const host of ['.claude', '.agents']) {
      assert.deepEqual(readFileSync(join(project, host, 'skills', name, 'SKILL.md')), source);
    }
  }
  assert.deepEqual(run(project, ['verify']).skills, core);
});
test('reject unsafe paths, unknown command arguments and unsupported config', t => {
  const root = sandbox(t);
  for (const name of ['../escape','CON','a/b']) run(root,['init',name],1);
  run(root,['init','demo','--template','unknown'],1);
  run(root,['skill','list','unexpected'],1);
  run(root,['init','demo']);
  const project = join(root,'demo');
  run(project,['skill','add','../x'],1);
  writeFileSync(join(project,'aidev.json'),'{"schemaVersion":99}');
  run(project,['verify'],1);
});
test('block linked parent before any installation write', t => {
  const root = sandbox(t);
  run(root,['init','demo']);
  const project = join(root,'demo');
  const outside = join(root,'outside');
  mkdirSync(outside);
  symlinkSync(outside,join(project,'.agents'),'junction');
  run(project,['skill','add','aidev-project-verification'],1);
  assert.equal(existsSync(join(outside,'skills')),false);
  assert.equal(existsSync(join(project,'.claude')),false);
});
test('generated AGENTS.md tells hosts how to call the CLI', t => {
  const root = sandbox(t);
  run(root, ['init', 'demo']);
  const agents = readFileSync(join(root, 'demo', 'AGENTS.md'), 'utf8');
  assert.match(agents, /AIDEV_CLI/);
  assert.match(agents, /node \$env:AIDEV_CLI/);
});
test('every bundled skill uses the aidev- prefix and verify explains legacy names', t => {
  const root = sandbox(t);
  run(root, ['init', 'demo']);
  const project = join(root, 'demo');
  assert.ok(run(project, ['skill', 'list']).skills.every(skill => skill.name.startsWith('aidev-')));
  mkdirSync(join(project, '.aidev/installed'), {recursive: true});
  writeFileSync(join(project, '.aidev/installed/debugging'), '0.1.0\n');
  const result = spawnSync(process.execPath, [cli, 'verify'], {cwd: project, encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /aidev-debugging に改名/);
});
