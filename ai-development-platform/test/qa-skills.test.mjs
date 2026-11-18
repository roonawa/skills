import test from 'node:test';
import assert from 'node:assert/strict';
import { listSkills, loadSkill } from '../dist/registry.js';

// Writing rules shared by every QA Skill (design 5.2). Short ASCII tokens use word boundaries so that
// generic words do not match by accident.
const forbidden = /信州|信大|\bcampus\b|\bcapi\b|Allcampus|OneLogin|ailesys|wkozu|ailegit/i;
for (const s of listSkills().filter(s => s.category === 'qa')) {
  test(s.name + ' follows the writing rules', () => {
    const {files} = loadSkill(s.name);
    const all = Object.values(files).join('\n');
    assert.ok(s.name.startsWith('aidev-qa-'));
    assert.doesNotMatch(all, forbidden);
    assert.ok((files['SKILL.md'].match(/必ず/g) ?? []).length <= 3);
    assert.ok((files['SKILL.md'].match(/\*\*/g) ?? []).length / 2 <= 8);
    assert.doesNotMatch(all, /トークン(消費|節約)|revert.{0,20}(省略|行わない)/);
    for (const ref of files['SKILL.md'].matchAll(/references\/[\w.-]+\.md/g)) assert.ok(files[ref[0]], ref[0]);
    for (const path of Object.keys(files).filter(p => p !== 'SKILL.md')) assert.ok(files['SKILL.md'].includes(path), path + ' is never referenced');
    assert.match(files['SKILL.md'], /profile/);  // 最初にプロファイルを読む手順がある
  });
}
