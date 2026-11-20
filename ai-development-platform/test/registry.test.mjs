import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSkill } from '../dist/registry.js';
const doc = '---\nname: sample\ndescription: |\n  Use for verification.\nmetadata:\n  version: "1.0.0"\n---\nRun the tests.';
test('parse standard YAML and CRLF', () => {
  assert.equal(parseSkill('sample',doc.replaceAll('\n','\r\n')).version,'1.0.0');
});
test('reject mismatched names, missing body and invalid version', () => {
  for (const invalid of [doc.replace('name: sample','name: other'),doc.replace('Run the tests.',''),doc.replace('1.0.0','latest')]) {
    assert.throws(() => parseSkill('sample',invalid));
  }
});
import { listSkills, loadSkill, skillSetHash, skillHash, readSkillDirectory } from '../dist/registry.js';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('list core and qa skills with their category', () => {
  const skills = listSkills();
  assert.ok(skills.some(s => s.category === 'core' && s.name === 'aidev-testing'));
  assert.ok(skills.every(s => s.category === 'core' || s.category === 'qa'));
  assert.equal(new Set(skills.map(s => s.name)).size, skills.length);
});
test('hash of a SKILL.md-only skill is unchanged', () => {
  const {source, files} = loadSkill('aidev-testing');
  assert.deepEqual(Object.keys(files), ['SKILL.md']);
  assert.equal(skillSetHash(files), skillHash(source));
});
test('set hash ignores line endings and depends on paths', () => {
  const a = {'SKILL.md': 'x\n', 'references/a.md': 'y\n'};
  assert.equal(skillSetHash(a), skillSetHash({'SKILL.md': 'x\r\n', 'references/a.md': 'y\r\n'}));
  assert.notEqual(skillSetHash(a), skillSetHash({'SKILL.md': 'x\n', 'references/b.md': 'y\n'}));
});
test('reject unsupported files in a qa skill', t => {
  const make = () => {
    const dir = mkdtempSync(join(tmpdir(), 'aidev-skill-'));
    writeFileSync(join(dir, 'SKILL.md'), 'x');
    mkdirSync(join(dir, 'references'));
    return dir;
  };
  const dirs = [];
  try {
    const ok = make(); dirs.push(ok);
    writeFileSync(join(ok, 'references', 'a.md'), 'y');
    assert.deepEqual(Object.keys(readSkillDirectory(ok)), ['SKILL.md', 'references/a.md']);
    for (const [name, setup] of [
      ['nested', d => { mkdirSync(join(d, 'references', 'sub')); writeFileSync(join(d, 'references', 'sub', 'a.md'), 'y'); }],
      ['txt', d => writeFileSync(join(d, 'references', 'a.txt'), 'y')],
      ['root file', d => writeFileSync(join(d, 'notes.md'), 'y')],
    ]) {
      const d = make(); dirs.push(d); setup(d);
      assert.throws(() => readSkillDirectory(d), /Skill に配布できないファイルがあります/, name);
    }
    const d = make(); dirs.push(d);
    writeFileSync(join(d, 'target.md'), 'y');
    try { symlinkSync(join(d, 'target.md'), join(d, 'references', 'l.md')); }
    catch { t.skip('symlink を作れません'); return; }
    assert.throws(() => readSkillDirectory(d));
  } finally {
    for (const d of dirs) rmSync(d, {recursive: true, force: true});
  }
});
test('a missing history file named by AIDEV_HISTORY_FILE is named in the error', async t => {
  const { releasedHashes } = await import('../dist/registry.js');
  const dir = mkdtempSync(join(tmpdir(), 'aidev-history-missing-'));
  const file = join(dir, 'absent-history.json');
  const before = process.env.AIDEV_HISTORY_FILE;
  process.env.AIDEV_HISTORY_FILE = file;
  t.after(() => {
    if (before === undefined) delete process.env.AIDEV_HISTORY_FILE; else process.env.AIDEV_HISTORY_FILE = before;
    rmSync(dir, {recursive: true, force: true});
  });
  assert.throws(() => releasedHashes('aidev-testing'), e => e.message.includes(file) && !e.message.includes('skills/history.json'));
});
