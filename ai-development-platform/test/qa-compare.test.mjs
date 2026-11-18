import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function run(cwd, args, status = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, status, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}
function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'aidev-cmp-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  mkdirSync(join(root, 'ev', 'shots'), {recursive:true});
  writeFileSync(join(root, 'ev', 'shots', 'a.png'), PNG);
  writeFileSync(join(root, 'outside.png'), PNG);
  return root;
}
function manifest(root, overrides = {}) {
  const m = {title:'比較', customer:'顧客X', generatedAt:'2026-11-18', rounds:['旧', '新'], screens:[{screen:'一覧', testCases:[
    {name:'検索', results:[{round:0, status:'pass', screenshot:'shots/a.png'}, {round:1, status:'NG', note:'差異'}]},
    {name:'登録', results:[{round:0, status:'ok'}]}]}], ...overrides};
  writeFileSync(join(root, 'ev', 'm.json'), JSON.stringify(m));
}

test('render rounds, statuses and embedded images', t => {
  const root = sandbox(t); manifest(root);
  const r = run(root, ['qa', 'compare-report', 'ev/m.json', 'out/r.html']);
  assert.deepEqual([r.ok, r.screens, r.testCases, r.images], [true, 1, 2, 1]);
  const html = readFileSync(join(root, 'out', 'r.html'), 'utf8');
  assert.match(html, /data:image\/png;base64,iVBOR/);
  assert.match(html, /pill ok">OK/); assert.match(html, /pill ng">NG/);
  assert.match(html, /対象外/); assert.match(html, /顧客X/);
  assert.doesNotMatch(html, /\{\{/);
});
test('link mode copies images into assets', t => {
  const root = sandbox(t); manifest(root);
  run(root, ['qa', 'compare-report', 'ev/m.json', 'out/r.html', '--link']);
  assert.ok(existsSync(join(root, 'out', 'assets', 'shots', 'a.png')));
  const html = readFileSync(join(root, 'out', 'r.html'), 'utf8');
  assert.match(html, /src="assets\/shots\/a\.png"/);
  assert.doesNotMatch(html, /base64/);
  run(root, ['qa', 'compare-report', 'ev/m.json', 'out/r.html', '--link']);
  writeFileSync(join(root, 'out', 'assets', 'shots', 'a.png'), 'other');
  assert.equal(run(root, ['qa', 'compare-report', 'ev/m.json', 'out/r.html', '--link'], 1).ok, false);
});
test('escape manifest text in html', t => {
  const root = sandbox(t);
  manifest(root, {title:'<script>alert(1)</script>', screens:[{screen:'<b>s</b>', testCases:[
    {name:'<script>x</script>', note:'<i>', results:[{round:0, status:'ok', note:'"><img src=x>'}]}]}]});
  run(root, ['qa', 'compare-report', 'ev/m.json', 'r.html']);
  const html = readFileSync(join(root, 'r.html'), 'utf8');
  assert.doesNotMatch(html, /<script>/); assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
test('refuse image paths outside the manifest directory', t => {
  const root = sandbox(t);
  for (const path of ['../outside.png', join(root, 'outside.png'), 'C:\\x.png', 'shots/../../outside.png', 'shots/missing.png', 'shots/a.txt']) {
    manifest(root, {screens:[{screen:'s', testCases:[{name:'t', results:[{round:0, status:'ok', screenshot:path}]}]}]});
    const r = run(root, ['qa', 'compare-report', 'ev/m.json', 'r.html'], 1);
    assert.equal(r.ok, false, path);
  }
  assert.equal(existsSync(join(root, 'r.html')), false);
});
test('reject a round index out of range and a bad manifest', t => {
  const root = sandbox(t);
  manifest(root, {screens:[{screen:'s', testCases:[{name:'t', results:[{round:5, status:'ok'}]}]}]});
  assert.equal(run(root, ['qa', 'compare-report', 'ev/m.json', 'r.html'], 1).ok, false);
  manifest(root, {rounds:[]});
  assert.equal(run(root, ['qa', 'compare-report', 'ev/m.json', 'r.html'], 1).ok, false);
  assert.equal(run(root, ['qa', 'compare-report', '../m.json', 'r.html'], 1).ok, false);
});
