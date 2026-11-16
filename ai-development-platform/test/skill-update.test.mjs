import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { listSkills, loadSkill, releasedHashes, skillHash } from '../dist/registry.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
// A released copy of an earlier version, as a project registered before the update would have it.
// A checkout on Windows may give the fixture CRLF line endings; the tests start from LF and add CRLF themselves.
const previous = readFileSync(new URL('./fixtures/aidev-repair-workflow-0.6.0.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const name = 'aidev-repair-workflow';
const copies = ['.claude/skills/' + name + '/SKILL.md', '.agents/skills/' + name + '/SKILL.md'];
const receipt = '.aidev/installed/' + name;

function run(cwd, args, status = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {cwd, encoding: 'utf8'});
  assert.equal(result.status, status, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}
/** A project whose Skill was registered at 0.6.0. */
function registeredAtPrevious(t) {
  const root = mkdtempSync(join(tmpdir(), 'aidev-update-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  run(root, ['init', 'demo']);
  const project = join(root, 'demo');
  run(project, ['skill', 'add', name]);
  for (const copy of copies) writeFileSync(join(project, copy), previous);
  writeFileSync(join(project, receipt), '0.6.0\n');
  return project;
}
const read = (project, path) => readFileSync(join(project, path), 'utf8');

test('every bundled version is recorded, so the next release can update it', () => {
  for (const skill of listSkills()) {
    assert.ok(releasedHashes(skill.name)[skill.version]?.includes(skillHash(loadSkill(skill.name).source)),
      skill.name + ' ' + skill.version + ': run node scripts/skill-history.mjs');
  }
  assert.ok(releasedHashes(name)['0.6.0'].includes(skillHash(previous)));
});

test('verify points to skill update, and update replaces released copies and the receipt', t => {
  const project = registeredAtPrevious(t);
  // A checkout on Windows may convert line endings; the copy is still the released one.
  writeFileSync(join(project, copies[1]), previous.replace(/\n/g, '\r\n'));
  assert.match(run(project, ['verify'], 1).error, /skill update aidev-repair-workflow/);
  const planned = run(project, ['skill', 'update', name, '--dry-run']);
  assert.deepEqual([planned.from, planned.to, planned.pending, planned.dryRun], ['0.6.0', loadSkill(name).info.version, [...copies, receipt], true]);
  assert.equal(read(project, copies[0]), previous);
  const updated = run(project, ['skill', 'update', name]);
  assert.deepEqual(updated.pending, [...copies, receipt]);
  for (const copy of copies) assert.equal(read(project, copy), loadSkill(name).source);
  assert.equal(read(project, receipt), loadSkill(name).info.version + '\n');
  assert.deepEqual(run(project, ['verify']).skills, [name]);
  assert.deepEqual(run(project, ['skill', 'update', name]).pending, []);
  // No temporary files are left next to the copies.
  assert.deepEqual(readdirSync(join(project, '.claude/skills', name)), ['SKILL.md']);
});

test('an edited copy is never overwritten, and nothing else is changed', t => {
  const project = registeredAtPrevious(t);
  writeFileSync(join(project, copies[0]), previous + '\n## 社内の追記\n');
  const failed = run(project, ['skill', 'update', name], 1);
  assert.match(failed.error, /内容が変わっている/);
  assert.match(failed.error, /\.claude\/skills\/aidev-repair-workflow\/SKILL\.md/);
  assert.match(read(project, copies[0]), /社内の追記/);
  assert.equal(read(project, copies[1]), previous);
  assert.equal(read(project, receipt), '0.6.0\n');
});

test('an unknown recorded version is not updated; an interrupted update can be retried', t => {
  const project = registeredAtPrevious(t);
  writeFileSync(join(project, receipt), '0.4.0\n');
  assert.match(run(project, ['skill', 'update', name], 1).error, /記録にない/);
  // Interrupted after the first copy: one copy is already new, the other and the receipt are old.
  writeFileSync(join(project, receipt), '0.6.0\n');
  writeFileSync(join(project, copies[0]), loadSkill(name).source);
  assert.deepEqual(run(project, ['skill', 'update', name]).pending, [copies[1], receipt]);
  assert.deepEqual(run(project, ['verify']).skills, [name]);
});

test('a Skill that is not registered must be added first', t => {
  const root = mkdtempSync(join(tmpdir(), 'aidev-update-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  run(root, ['init', 'demo']);
  assert.match(run(join(root, 'demo'), ['skill', 'update', name], 1).error, /skill add/);
});
