import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProfile } from '../dist/qa-profile.js';

const samplesRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'qa', 'samples');
const samples = {
  web: {profile: 'web/knowledge/sample-web/profile.md', dir: 'web', min: 10, max: 15,
    skills: ['aidev-qa-characterization', 'aidev-qa-regression-compare', 'aidev-qa-authz-test', 'aidev-qa-login-session']},
  desktop: {profile: 'desktop/knowledge/sample-desktop/profile.md', dir: 'desktop', min: 6, max: 10, skills: ['aidev-qa-desktop-gui']},
};

test('sample documents exist', () => {
  for (const s of Object.values(samples))
    for (const f of ['requirements.md', 'plan/acceptance.md', 'EXPECTED.md', s.profile.replace(s.dir + '/', '')])
      assert.ok(existsSync(join(samplesRoot, s.dir, f)), s.dir + '/' + f);
});
test('sample profiles pass profile check', () => {
  for (const s of Object.values(samples)) {
    assert.deepEqual(checkProfile(samplesRoot, s.profile).errors, [], s.profile);
    for (const skill of s.skills) assert.deepEqual(checkProfile(samplesRoot, s.profile, skill).errors, [], s.profile + ' ' + skill);
  }
});
test('sample acceptance criteria are sequential and in range', () => {
  for (const s of Object.values(samples)) {
    const lines = readFileSync(join(samplesRoot, s.dir, 'plan/acceptance.md'), 'utf8').split(/\r?\n/).filter(l => /^- AC-/.test(l));
    assert.ok(lines.length >= s.min && lines.length <= s.max, s.dir + ' count ' + lines.length);
    lines.forEach((l, i) => {
      const m = /^- AC-(\d{3}): .+（出どころ: requirements\.md [0-9.]+）$/.exec(l);
      assert.ok(m, l);
      assert.equal(Number(m[1]), i + 1);
    });
  }
});
test('EXPECTED covers every AC and the deliberate omission', () => {
  for (const s of Object.values(samples)) {
    const acc = readFileSync(join(samplesRoot, s.dir, 'plan/acceptance.md'), 'utf8').match(/AC-\d{3}(?=:)/g);
    const exp = readFileSync(join(samplesRoot, s.dir, 'EXPECTED.md'), 'utf8');
    for (const id of acc) assert.ok(exp.includes(id), s.dir + ' ' + id);
  }
});
