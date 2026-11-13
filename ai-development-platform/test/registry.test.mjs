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
