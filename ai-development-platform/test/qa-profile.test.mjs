import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProfileText } from '../dist/qa-profile.js';

const valid = '---\nproduct: sample-web\nroles:\n  - {name: staff, user_env: SAMPLE_STAFF_USER, password_env: SAMPLE_STAFF_PASSWORD}\nevidence: {method: local, retention: 90d}\n---\n# 観点\n一覧は0件のとき空表示になる。\n';
test('accept a valid profile', () => {
  const r = checkProfileText('p.md', valid);
  assert.deepEqual(r.errors, []); assert.equal(r.product, 'sample-web');
});
test('reject values in env name fields', () => {
  const r = checkProfileText('p.md', valid.replace('SAMPLE_STAFF_PASSWORD', 'P@ssw0rd'));
  assert.ok(r.errors.some(e => e.code === 'env-name' && e.path === 'roles[0].password_env'));
});
test('detect secrets in the markdown body', () => {
  for (const secret of ['password: hunter2', 'Authorization: Bearer abcdefghijklmnop1234',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', 'Cookie: sessionid=abc123def456', '-----BEGIN PRIVATE KEY-----']) {
    const r = checkProfileText('p.md', valid + secret + '\n');
    assert.ok(r.errors.some(e => e.code === 'secret' && typeof e.line === 'number'), secret);
  }
});
test('allow a certificate thumbprint', () => {
  const r = checkProfileText('p.md', valid.replace('evidence:', 'login: {method: certificate, certificate_thumbprint: ' + 'a'.repeat(40) + '}\nevidence:'));
  assert.deepEqual(r.errors, []);
});
test('require fields per skill', () => {
  const r = checkProfileText('p.md', valid, 'aidev-qa-regression-compare');
  assert.ok(r.errors.some(e => e.code === 'required' && e.path === 'environments'));
});
test('reject unknown evidence and login methods', () => {
  assert.ok(checkProfileText('p.md', valid.replace('method: local', 'method: s3')).errors.some(e => e.path === 'evidence.method'));
});
test('reject an unknown skill name', () => {
  assert.throws(() => checkProfileText('p.md', valid, 'aidev-qa-unknown'));
});
test('env-name lines and prose are not secrets; missing front matter is an error', () => {
  assert.deepEqual(checkProfileText('p.md', valid + 'password_env: SAMPLE_PW\nパスワード(password)は環境変数から読む。\n').errors, []);
  assert.ok(checkProfileText('p.md', '# なし\n').errors.some(e => e.code === 'front-matter'));
});
