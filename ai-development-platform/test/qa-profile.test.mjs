import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
test('secrets in front matter are found in any YAML form, and the value is never echoed', () => {
  const probes = [
    ['value on the next line', valid.replace('evidence:', 'password:\n  hunter2\nevidence:')],
    ['userinfo in a URL', valid.replace('evidence:', 'environments:\n  - {name: st, url: "https://user:S3cretPass@st.example.test"}\nevidence:')],
    ['api key', valid.replace('evidence:', 'api_key: sk_live_abcdef123456\nevidence:')],
  ];
  for (const [label, text] of probes) {
    const r = checkProfileText('p.md', text);
    assert.ok(r.errors.some(e => e.code === 'secret' || e.code === 'url'), label);
    const messages = r.errors.map(e => e.message).join('\n');
    for (const value of ['hunter2', 'S3cretPass', 'sk_live_abcdef123456']) assert.ok(!messages.includes(value), label + ': ' + value);
  }
});
test('a URL with credentials in the body is a secret', () => {
  assert.ok(checkProfileText('p.md', valid + 'ST は https://user:S3cretPass@st.example.test で開く。\n').errors.some(e => e.code === 'secret'));
  assert.deepEqual(checkProfileText('p.md', valid + 'ST は https://st.example.test:8443/login で開く。\n').errors, []);
});
test('the profile template has no secret-like entries', () => {
  const template = readFileSync(new URL('../templates/qa/knowledge/profile.template.md', import.meta.url), 'utf8');
  assert.deepEqual(checkProfileText('profile.template.md', template).errors.filter(e => e.code === 'secret' || e.code === 'url'), []);
});
test('flow-style lines: a secret after an _env key is found, env names under _env are not', () => {
  assert.ok(checkProfileText('p.md', valid + '{password_env: PW, token: abc}\n').errors.some(e => e.code === 'secret'));
  assert.ok(checkProfileText('p.md', valid + 'password: ADMIN123\n').errors.some(e => e.code === 'secret'));
  assert.deepEqual(checkProfileText('p.md', valid + 'roles: [{name: a, password_env: A_PW}]\n').errors.filter(e => e.code === 'secret'), []);
});
test('detect secrets written as a list', () => {
  const r = checkProfileText('p.md', valid.replace('evidence:', 'api_key:\n  - sk_live_abcdef123456\nevidence:'));
  assert.ok(r.errors.some(e => e.code === 'secret' && e.path === 'api_key'));
  assert.ok(!JSON.stringify(r).includes('sk_live'));
});
test('allow keys that merely contain pass', () => {
  for (const line of ['pass_rate: 0.95', 'passing_score: 80', 'bypass_login: true', 'compass_view: north', 'tokenizer: kuromoji', 'password_reset_url: "https://localhost/reset"']) {
    const r = checkProfileText('p.md', valid.replace('evidence:', line + '\nevidence:'));
    assert.deepEqual(r.errors.filter(e => e.code === 'secret'), [], line);
  }
});
test('still detect whole-word secret keys', () => {
  for (const line of ['pass: hunter2', 'db_password: x1', 'auth_token: abc', 'api-key: abc', 'client_secret: abc', 'credentials: abc']) {
    const r = checkProfileText('p.md', valid.replace('evidence:', line + '\nevidence:'));
    assert.ok(r.errors.some(e => e.code === 'secret'), line);
  }
});
test('camelCase and trailing-pass keys are secrets in front matter and body', () => {
  for (const line of ['dbPassword: x1', 'authToken: abc', 'accessToken: abc', 'secretKey: abc', 'user_pass: abc', 'userPass: abc', 'passphrase: abc', 'private_key: abc', 'privateKey: abc']) {
    assert.ok(checkProfileText('p.md', valid.replace('evidence:', line + '\nevidence:')).errors.some(e => e.code === 'secret' && e.path), 'front matter: ' + line);
    assert.ok(checkProfileText('p.md', valid + line + '\n').errors.some(e => e.code === 'secret' && typeof e.line === 'number'), 'body: ' + line);
  }
});
test('nested maps under secret keys are secrets', () => {
  for (const block of ['api_key:\n  value: abc', 'password:\n  - {a: abc}']) {
    assert.ok(checkProfileText('p.md', valid.replace('evidence:', block + '\nevidence:')).errors.some(e => e.code === 'secret'), block);
  }
});
test('the _url exception only covers plain URLs', () => {
  for (const line of ['password_reset_url: "https://u:p@h"', 'secret_url: hunter2']) {
    assert.ok(checkProfileText('p.md', valid.replace('evidence:', line + '\nevidence:')).errors.some(e => e.code === 'secret'), line);
  }
});
test('a secret key after another key on the same line is found', () => {
  for (const line of ['note: password: hunter2', 'memo: token=abc', 'メモ: token=abc']) {
    assert.ok(checkProfileText('p.md', valid + line + '\n').errors.some(e => e.code === 'secret' && typeof e.line === 'number'), line);
  }
});
test('the _url exception does not cover a secret in the query or fragment', () => {
  for (const line of ['password_reset_url: "https://h/reset?token=abc"', 'password_reset_url: "https://h/reset#token=abc"']) {
    assert.ok(checkProfileText('p.md', valid.replace('evidence:', line + '\nevidence:')).errors.some(e => e.code === 'secret'), line);
  }
});
test('very long lines are scanned in linear time and still report the secret', () => {
  const lines = ['a:'.repeat(50000), 'a b: '.repeat(20000), 'x:'.repeat(50000) + 'password: z'];
  lines.forEach((line, i) => {
    const started = Date.now();
    const r = checkProfileText('p.md', valid + line + '\n');
    assert.ok(Date.now() - started < 1000, 'line ' + i + ' took ' + (Date.now() - started) + ' ms');
    assert.equal(r.errors.some(e => e.code === 'secret'), i === 2, 'line ' + i);
  });
});
test('a value padded past the length cap is still a secret', () => {
  const pad = 'a'.repeat(1100);
  for (const line of ['password_reset_url: https://h/' + pad + '?abcdef123', 'password_reset_url: "https://h/' + pad + '#abcdef123"',
    'password_reset_url: https://h/' + pad + '/x?s=1', 'password: "' + ' '.repeat(1100) + 'hunter2"', "password: '" + ' '.repeat(1100) + "hunter2'"]) {
    const started = Date.now();
    const r = checkProfileText('p.md', valid + line + '\n');
    assert.ok(Date.now() - started < 1000);
    assert.ok(r.errors.some(e => e.code === 'secret' && typeof e.line === 'number'), line.slice(0, 40));
  }
});
