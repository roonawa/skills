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
const shot = (screenshot, extra = {}) => ({screens:[{screen:'s', testCases:[{name:'t', results:[{round:0, status:'ok', screenshot, ...extra}]}]}]});
function fails(root, pattern, args = ['ev/m.json', 'r.html']) {
  const r = run(root, ['qa', 'compare-report', ...args], 1);
  assert.equal(r.ok, false); assert.match(r.error, pattern); return r;
}
test('refuse image paths outside the manifest directory', t => {
  const root = sandbox(t);
  for (const path of ['../outside.png', join(root, 'outside.png'), 'C:' + String.fromCharCode(92) + 'x.png', 'shots/../../outside.png']) {
    manifest(root, shot(path));
    fails(root, /画像のパスが使用できません/);
  }
  manifest(root, shot('shots/missing.png')); fails(root, /画像が見つかりません/);
  manifest(root, shot('shots/a.svg')); fails(root, /画像の拡張子/);
  assert.equal(existsSync(join(root, 'r.html')), false);
});
test('refuse an image over 20 MiB', t => {
  const root = sandbox(t);
  writeFileSync(join(root, 'ev', 'shots', 'big.png'), Buffer.alloc(20 * 1024 * 1024 + 1));
  manifest(root, shot('shots/big.png')); fails(root, /20 MiB/);
  writeFileSync(join(root, 'ev', 'shots', 'big.png'), Buffer.alloc(20 * 1024 * 1024));
  assert.equal(run(root, ['qa', 'compare-report', 'ev/m.json', 'r.html']).ok, true);
});
test('reject a round index out of range, negative or fractional, and a bad manifest', t => {
  const root = sandbox(t);
  for (const round of [5, -1, 0.5]) {
    manifest(root, {screens:[{screen:'s', testCases:[{name:'t', results:[{round, status:'ok'}]}]}]});
    fails(root, /round は 0 以上 2 未満の整数/);
  }
  manifest(root, {rounds:[]}); fails(root, /rounds は 1 件以上/);
  manifest(root); fails(root, /不正なパスです/, ['../m.json', 'r.html']);
});
test('reject two results with the same round in one test case', t => {
  const root = sandbox(t);
  manifest(root, {screens:[{screen:'s', testCases:[{name:'t', results:[{round:1, status:'ok'}, {round:1, status:'NG'}]}]}]});
  fails(root, /round 1 の結果が 2 件あります/);
});
test('escape quotes and angle brackets in text and the alt attribute', t => {
  const root = sandbox(t);
  manifest(root, {screens:[{screen:'s"\'<', testCases:[{name:'n"\'<x', results:[{round:0, status:'ok', screenshot:'shots/a.png'}]}]}]});
  run(root, ['qa', 'compare-report', 'ev/m.json', 'r.html']);
  const html = readFileSync(join(root, 'r.html'), 'utf8');
  assert.match(html, /alt="n&quot;&#39;&lt;x - 旧"/);
  assert.match(html, /s&quot;&#39;&lt;/);
  assert.doesNotMatch(html, /n"'<x/);
});
test('placeholder-like manifest text is rendered literally once', t => {
  const root = sandbox(t);
  manifest(root, {title:'{{BODY}}', customer:'{{TITLE}}'});
  run(root, ['qa', 'compare-report', 'ev/m.json', 'r.html']);
  const html = readFileSync(join(root, 'r.html'), 'utf8');
  assert.equal(html.split('{{BODY}}').length - 1, 2); // <title> and <h1>, both literal
  assert.match(html, /testcase-name">検索/);
  assert.match(html, /\{\{TITLE\}\}/);
});
test('refuse an output that is the manifest or not html', t => {
  const root = sandbox(t); manifest(root);
  const before = readFileSync(join(root, 'ev', 'm.json'), 'utf8');
  fails(root, /マニフェストと同じ/, ['ev/m.json', 'ev/m.json']);
  fails(root, /.html か .htm で終わる/, ['ev/m.json', 'ev/out.json']);
  assert.equal(readFileSync(join(root, 'ev', 'm.json'), 'utf8'), before);
});
test('link mode url-encodes the src and keeps the raw copy path', t => {
  const root = sandbox(t);
  writeFileSync(join(root, 'ev', 'shots', 'b c#1.png'), PNG);
  manifest(root, shot('shots/b c#1.png'));
  run(root, ['qa', 'compare-report', 'ev/m.json', 'out/r.html', '--link']);
  assert.ok(existsSync(join(root, 'out', 'assets', 'shots', 'b c#1.png')));
  assert.match(readFileSync(join(root, 'out', 'r.html'), 'utf8'), /src="assets\/shots\/b%20c%231\.png"/);
});
