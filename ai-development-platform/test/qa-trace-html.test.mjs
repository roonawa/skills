import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, cpSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const fixture = fileURLToPath(new URL('./fixtures/qa-repo', import.meta.url));
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function sandbox(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'aidev-trace-html-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), {recursive: true});
    writeFileSync(join(root, path), text);
  }
  return root;
}
function runCli(cwd, args) {
  const out = spawnSync(process.execPath, [cli, ...args], {cwd, encoding: 'utf8'});
  return {status: out.status, json: JSON.parse(out.stdout)};
}
function snapshot(dir) {
  const files = {};
  const walk = (path, rel) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full, rel + entry + '/');
      else files[rel + entry] = readFileSync(full, 'utf8');
    }
  };
  walk(dir, '');
  return files;
}
/** The numbers of the summary, read from `data-count="name"` in the HTML. */
function counts(html) {
  const found = {};
  for (const match of html.matchAll(/data-count="([a-z-]+)">(\d+)</g)) found[match[1]] = Number(match[2]);
  return found;
}

test('html escapes and omits free text', t => {
  const root = sandbox(t, {
    'plan/acceptance.md': '# 受け入れ条件\n\n- AC-001: <script>alert(1)</script> & "引用" の結果が出る（出どころ: <i>RS-001</i>）\n- AC-002: 二つ目\n',
    'cases/a.md': '# a\n\n### TC-a-001 <img src=x onerror=alert(2)> を開く\n- AC: AC-001\n- 優先度: 中\n- 実行: 自動\n\n' +
      '### TC-a-002 二つ目\n- AC: AC-002, <b>bad</b>\n- 優先度: 中\n- 実行: 手動\n',
    'runs/20261119-r1/result.md': '# 実行結果\n\n- 環境: new\n- 版: 1.0\n- 実行日時: 2026-11-19 10:00\n- 担当のメモ: 秘密のメモ-MEMO\n\n' +
      '| TC-ID | 結果 | 証跡 | Issue |\n|---|---|---|---|\n| TC-a-001 | NG | runs/20261119-r1/evidence/<u>a</u>-EVIDENCECELL.png 担当者の証跡メモ | #7 |\n| TC-a-002 | 実行不能 | | |\n\n' +
      '## 実行不能の理由\n\n- TC-a-002: 手動確認待ち 理由の自由文-REASON\n\n## TC-a-001\n\n再現手順の自由文-STEPS\n実際の結果の自由文-ACTUAL\n',
  });
  const out = runCli(root, ['qa', 'trace', '.', '--html', 'report/trace.html']);
  assert.ok(out.json.findings, JSON.stringify(out.json));
  const html = readFileSync(join(root, 'report', 'trace.html'), 'utf8');
  // Repository text is escaped.
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /<b>bad/);
  assert.doesNotMatch(html, /<i>RS/);
  assert.doesNotMatch(html, /<u>a/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;引用&quot;/);
  assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt; を開く/);
  assert.match(html, /&lt;i&gt;RS-001&lt;\/i&gt;/);
  // The evidence cell is free text (Ruling X): neither the column nor its text is in the page.
  assert.ok(!html.includes('EVIDENCECELL'), 'evidence cell text');
  assert.ok(!html.includes('証跡メモ'), 'evidence cell text');
  assert.doesNotMatch(html, /<th[^>]*>証跡</);
  assert.match(html, /&lt;b&gt;bad&lt;\/b&gt;/, 'the finding message is escaped');
  // The free text of result.md is not copied.
  for (const text of ['MEMO', 'REASON', 'STEPS', 'ACTUAL', '自由文']) assert.ok(!html.includes(text), text);
  // Self-contained: nothing is loaded from outside, no script runs.
  assert.doesNotMatch(html, /<(script|link|iframe|object|embed)\b/i);
  assert.doesNotMatch(html, /<[^>]*\b(src|href)=/i);
  assert.doesNotMatch(html, /url\(|@import|https?:\/\//i);
  assert.doesNotMatch(html, /\{\{/);
  assert.ok(!html.includes(root), 'no absolute paths');
  // Header cells are column headers; the result card names what it counts.
  assert.doesNotMatch(html, /<th>/);
  assert.match(html, /<th scope="col">TC-ID<\/th>/);
  assert.match(html, /最新の結果（AC につながる TC ごと）/);
  // The time carries its zone offset, the local one of the machine that wrote the page.
  const stamp = html.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) ([+-])(\d{2}):(\d{2})</);
  assert.ok(stamp, 'timestamp with offset');
  const offset = -new Date().getTimezoneOffset();
  assert.equal((stamp[2] === '-' ? -1 : 1) * (Number(stamp[3]) * 60 + Number(stamp[4])), offset);
  // Both colour schemes are declared, mirroring the theme selectors.
  assert.match(html, /:root \{\s*color-scheme: light dark;/);
  assert.match(html, /:root:not\(\[data-theme="light"\]\) \{\s*color-scheme: dark;/);
  assert.match(html, /:root\[data-theme="dark"\] \{\s*color-scheme: dark;/);
  assert.match(html, /:root\[data-theme="light"\] \{\s*color-scheme: light;/);
  // The footer says what is left out.
  assert.match(html, /<footer[^>]*>[^<]*証跡[^<]*<\/footer>/);
  // The fixture's free text stays out as well.
  const copy = sandbox(t, {});
  cpSync(fixture, join(copy, 'qa'), {recursive: true});
  runCli(copy, ['qa', 'trace', 'qa', '--html', 'trace.html']);
  const fixtureHtml = readFileSync(join(copy, 'trace.html'), 'utf8');
  for (const text of ['区切り', '手動確認の項目に再現手順', '担当のメモ']) assert.ok(!fixtureHtml.includes(text), text);
});

test('html summary equals the json report', t => {
  const root = sandbox(t, {});
  cpSync(fixture, join(root, 'qa'), {recursive: true});
  const out = runCli(root, ['qa', 'trace', 'qa', '--html', 'out/trace.html']);
  assert.equal(out.status, 0);
  const report = out.json;
  // The JSON keeps its shape.
  assert.deepEqual(Object.keys(report), ['ok', 'acs', 'cases', 'runs', 'coverage', 'issues', 'findings']);
  const html = readFileSync(join(root, 'out', 'trace.html'), 'utf8');
  const latest = new Map();
  const tcs = new Set();
  for (const item of report.coverage) {
    for (const tc of item.cases) tcs.add(tc);
    for (const row of item.latest) latest.set(row.tc, row.result);
  }
  const results = [...latest.values()];
  const issues = status => report.issues.filter(issue => issue.status === status).length;
  const expected = {
    acs: report.acs, cases: report.cases, runs: report.runs,
    'ac-covered': report.coverage.filter(item => item.cases.length).length,
    'ac-uncovered': report.coverage.filter(item => !item.cases.length).length,
    'ac-with-result': report.coverage.filter(item => item.latest.length).length,
    'result-ok': results.filter(r => r === 'OK').length,
    'result-ng': results.filter(r => r === 'NG').length,
    'result-blocked': results.filter(r => r === '実行不能').length,
    'result-not-run': tcs.size - latest.size,
    'issue-confirmed': issues('確認済み'), 'issue-unconfirmed': issues('未確認'),
    'issue-recheck': issues('要確認'), 'issue-not-fixed': issues('効いていない'),
    'finding-error': report.findings.filter(f => f.level === 'error').length,
    'finding-warning': report.findings.filter(f => f.level === 'warning').length,
  };
  assert.deepEqual(counts(html), expected);
  assert.deepEqual([expected['result-ok'], expected['result-blocked'], expected['issue-confirmed'], expected['finding-warning']], [2, 1, 1, 2]);
  // Every AC, TC and issue of the report appears in the page.
  for (const item of report.coverage) assert.ok(html.includes(item.ac), item.ac);
  for (const tc of tcs) assert.ok(html.includes(tc), tc);
  for (const issue of report.issues) assert.ok(html.includes('#' + issue.number), '#' + issue.number);
  assert.ok(html.includes('runs/20261119-csv-fix'));

  // A failing repository still writes the page; the exit code follows the findings.
  const bad = sandbox(t, {'plan/acceptance.md': '# 受け入れ条件\n\n- AC-001: 一つ目\n- AC-002: 二つ目\n',
    'cases/a.md': '# a\n\n### TC-a-001 一つ目\n- AC: AC-001\n- 優先度: 中\n- 実行: 自動\n'});
  const failed = runCli(bad, ['qa', 'trace', '.', '--html', 'x.html']);
  assert.equal(failed.status, 1);
  assert.equal(failed.json.ok, false);
  const badHtml = readFileSync(join(bad, 'x.html'), 'utf8');
  // case-not-run is folded per cases/ file.
  assert.match(badHtml, /<details><summary>cases\/a\.md の 1 件<\/summary>/);
  const page = counts(badHtml);
  assert.equal(page['ac-uncovered'], 1);
  assert.equal(page['finding-error'], failed.json.findings.filter(f => f.level === 'error').length);
});

test('html refuses output paths outside the working directory and names without .html', t => {
  const root = sandbox(t, {'qa/plan/acceptance.md': '# 受け入れ条件\n\n- AC-001: 一つ目\n', 'qa/cases/a.md': '# a\n\n### TC-a-001 一つ目\n- AC: AC-001\n- 優先度: 中\n- 実行: 自動\n',
    'dir.html/keep.txt': 'x'});
  const before = snapshot(root);
  const outside = join(root, '..', 'aidev-trace-outside-' + process.pid + '.html');
  for (const file of ['../trace.html', 'qa/../../trace.html', outside, 'C:/trace.html', '/trace.html', 'trace.txt', 'trace.md', 'trace.html.txt', 'trace',
    'dir.html', 'qa/cases/a.md']) {
    const out = runCli(root, ['qa', 'trace', 'qa', '--html', file]);
    assert.equal(out.status, 1, file);
    assert.equal(out.json.ok, false, file);
    assert.ok(out.json.error, file);
    assert.equal(out.json.findings, undefined, file);
  }
  assert.ok(!existsSync(outside));
  assert.deepEqual(snapshot(root), before, 'nothing is written');
  try {
    mkdirSync(join(root, 'real'));
    symlinkSync(join(root, 'real'), join(root, 'linked'), 'junction');
    const out = runCli(root, ['qa', 'trace', 'qa', '--html', 'linked/trace.html']);
    assert.equal(out.status, 1);
    assert.ok(!existsSync(join(root, 'real', 'trace.html')));
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
  }
  // Usage errors: a missing file or another flag.
  for (const args of [['qa', 'trace', 'qa', '--html'], ['qa', 'trace', 'qa', '--out', 'x.html'], ['qa', 'trace', 'qa', '--html', 'x.html', '--dry-run']]) {
    assert.equal(runCli(root, args).status, 1, args.join(' '));
  }
  assert.ok(!existsSync(join(root, 'x.html')));
  const ok = runCli(root, ['qa', 'trace', 'qa', '--html', 'qa/trace.html']);
  assert.equal(ok.status, 0);
  assert.ok(existsSync(join(root, 'qa', 'trace.html')));
});
