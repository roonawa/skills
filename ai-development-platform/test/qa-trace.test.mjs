import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { traceDirectory, traceQaRepository } from '../dist/qa-trace.js';

const fixture = fileURLToPath(new URL('./fixtures/qa-repo', import.meta.url));
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function sandbox(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'aidev-trace-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), {recursive: true});
    writeFileSync(join(root, path), text);
  }
  return root;
}

const acceptance = (...ids) => '# 受け入れ条件\n\n' + ids.map(id => '- ' + id + ': ' + id + ' の結果が出る\n').join('');
const tcase = (id, acs, execution = '自動') => '### ' + id + ' ' + id + ' の名前\n- AC: ' + acs + '\n- 優先度: 中\n- 実行: ' + execution + '\n手順\n1. 開く\n\n';
const result = (rows, {head = '', reasons = ''} = {}) => '# 実行結果\n\n- 環境: new\n- 版: 1.0\n- 実行日時: 2026-11-19 10:00\n' + head +
  '\n| TC-ID | 結果 | 証跡 | Issue |\n|---|---|---|---|\n' + rows.map(([tc, res, issue = '']) => '| ' + tc + ' | ' + res + ' | | ' + issue + ' |\n').join('') +
  (reasons ? '\n## 実行不能の理由\n\n' + reasons : '');

/** A repository with AC-001 and AC-002, TC-a-001 (AC-001) and TC-a-002 (AC-002), and the given runs. */
const base = runs => ({'plan/acceptance.md': acceptance('AC-001', 'AC-002'),
  'cases/a.md': '# a\n\n' + tcase('TC-a-001', 'AC-001') + tcase('TC-a-002', 'AC-002'), ...runs});

const codes = report => report.findings.map(f => f.level + ' ' + f.code + (f.ac ? ' ' + f.ac : '') + (f.tc ? ' ' + f.tc : '') + (f.issue ? ' #' + f.issue : ''));

test('trace the fixture repository', () => {
  const report = traceQaRepository(fixture);
  assert.equal(report.acs, 4);
  assert.equal(report.cases, 4);
  assert.equal(report.runs, 2);
  assert.deepEqual(report.coverage.map(item => [item.ac, item.cases]), [
    ['AC-001', ['TC-csv-004']], ['AC-007', ['TC-detail-001']], ['AC-014', ['TC-csv-001']], ['AC-015', ['TC-csv-004', 'TC-csv-005']]]);
  assert.deepEqual(report.coverage.find(item => item.ac === 'AC-015').latest, [
    {tc: 'TC-csv-004', result: 'OK', run: 'runs/20261119-csv-fix', issues: [1]},
    {tc: 'TC-csv-005', result: 'OK', run: 'runs/20261119-csv-fix', issues: [1]}]);
  assert.deepEqual(report.coverage.find(item => item.ac === 'AC-007').latest,
    [{tc: 'TC-detail-001', result: '実行不能', run: 'runs/20261119-csv-detail', issues: []}]);
  assert.deepEqual(report.issues, [
    {number: 1, tcs: ['TC-csv-004', 'TC-csv-005'], status: '確認済み', fixRun: 'runs/20261119-csv-fix'},
    {number: 2, tcs: ['TC-csv-001', 'TC-csv-004'], status: '要確認', fixRun: 'runs/20261119-csv-fix'},
    {number: 3, tcs: [], status: '効いていない', fixRun: 'runs/20261119-csv-fix'}]);
  assert.deepEqual(codes(report), ['warning issue-unconfirmed #2', 'warning issue-unconfirmed #3']);
  // The free text of result.md (実際の結果, reasons) is not copied into the report.
  const all = JSON.stringify(report);
  for (const text of ['区切り', '手動確認の項目に再現手順', '担当のメモ']) assert.ok(!all.includes(text), text);
});

test('ac-uncovered and tc-unknown-ac', t => {
  const good = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md': result([['TC-a-001', 'OK'], ['TC-a-002', 'OK']])})));
  assert.deepEqual(codes(good), []);
  const bad = traceQaRepository(sandbox(t, {...base({'runs/20261119-r1/result.md': result([['TC-a-001', 'OK'], ['TC-a-002', 'OK']])}),
    'cases/a.md': '# a\n\n' + tcase('TC-a-001', 'AC-001') + tcase('TC-a-002', 'AC-009')}));
  assert.deepEqual(codes(bad), ['error ac-uncovered AC-002', 'error tc-unknown-ac AC-009 TC-a-002']);
  const uncovered = bad.findings[0];
  assert.equal(uncovered.file, 'plan/acceptance.md');
  assert.equal(uncovered.line, 4);
  const unknown = bad.findings[1];
  assert.equal(unknown.file, 'cases/a.md');
  assert.deepEqual(bad.coverage.find(item => item.ac === 'AC-002'), {ac: 'AC-002', cases: [], latest: []});
});

test('ng-without-issue', t => {
  const good = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md': result([['TC-a-001', 'NG', '#4'], ['TC-a-002', 'OK']])})));
  assert.deepEqual(codes(good), ['warning issue-unconfirmed #4']);
  assert.deepEqual(good.issues, [{number: 4, tcs: ['TC-a-001'], status: '未確認'}]);
  const bad = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md': result([['TC-a-001', 'NG'], ['TC-a-002', 'OK']])})));
  assert.deepEqual(codes(bad), ['error ng-without-issue TC-a-001']);
  assert.equal(bad.findings[0].file, 'runs/20261119-r1/result.md');
  // An older NG without an issue does not count once a later run passes.
  const fixed = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md': result([['TC-a-001', 'NG'], ['TC-a-002', 'OK']]),
    'runs/20261120-r1/result.md': result([['TC-a-001', 'OK']])})));
  assert.deepEqual(codes(fixed), []);
});

test('blocked-without-reason accepts 手動確認待ち', t => {
  const reason = '### TC-a-002\n- 理由: 手動確認待ち（実行が「手動」のケース）\n';
  const good = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md': result([['TC-a-001', 'OK'], ['TC-a-002', '実行不能']], {reasons: reason})})));
  assert.deepEqual(codes(good), []);
  const bad = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md': result([['TC-a-001', 'OK'], ['TC-a-002', '実行不能']])})));
  assert.deepEqual(codes(bad), ['error blocked-without-reason TC-a-002']);
  const empty = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md':
    result([['TC-a-001', 'OK'], ['TC-a-002', '実行不能']], {reasons: '### TC-a-002\n- 理由:\n'})})));
  assert.deepEqual(codes(empty), ['error blocked-without-reason TC-a-002']);
});

test('case-not-run and run-unknown-tc', t => {
  const report = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md': result([['TC-a-001', 'OK'], ['TC-b-001', 'OK']])})));
  assert.deepEqual(codes(report), ['warning case-not-run TC-a-002', 'warning run-unknown-tc TC-b-001']);
  assert.equal(report.findings[0].file, 'cases/a.md');
  assert.equal(report.findings[0].line, 10);
  assert.equal(report.findings[1].file, 'runs/20261119-r1/result.md');
  assert.ok(report.ok === undefined, 'ok is added by the CLI');
});

test('duplicate-id', t => {
  const good = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md': result([['TC-a-001', 'OK'], ['TC-a-002', 'OK']])})));
  assert.ok(!codes(good).some(code => code.includes('duplicate-id')));
  const bad = traceQaRepository(sandbox(t, {...base({'runs/20261119-r1/result.md': result([['TC-a-001', 'OK'], ['TC-a-002', 'OK']])}),
    'plan/acceptance.md': acceptance('AC-001', 'AC-002', 'AC-001'),
    'cases/b.md': '# b\n\n' + tcase('TC-a-002', 'AC-002')}));
  const dup = bad.findings.filter(f => f.code === 'duplicate-id');
  assert.deepEqual(dup.map(f => [f.level, f.ac ?? f.tc, f.file, f.line]),
    [['error', 'AC-001', 'plan/acceptance.md', 5], ['error', 'TC-a-002', 'cases/b.md', 3]]);
});

test('other parser problems are reported with their file and line', t => {
  const report = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md':
    result([['TC-a-001', 'OK'], ['TC-a-002', 'たぶん OK']], {head: '- 改修確認: #5 なおった\n'})})));
  assert.deepEqual(report.findings.map(f => [f.level, f.code, f.file, f.line]), [
    ['warning', 'fix-check', 'runs/20261119-r1/result.md', 6],
    ['error', 'run-result', 'runs/20261119-r1/result.md', 11],
    ['warning', 'case-not-run', 'cases/a.md', 10]]);
  const missing = traceQaRepository(sandbox(t, {'cases/a.md': '# a\n\n' + tcase('TC-a-001', 'AC-001')}));
  assert.ok(missing.findings.some(f => f.level === 'error' && f.code === 'missing-acceptance'));
});

test('only 確認済み confirms an issue', t => {
  const ng = result([['TC-a-001', 'NG', '#1'], ['TC-a-002', 'NG', '#2']]);
  for (const [verdict, status] of [['確認済み', '確認済み'], ['要確認（戻した版を起動できなかった）', '要確認'], ['要確認', '要確認'], ['効いていない', '効いていない']]) {
    const report = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md': ng,
      'runs/20261120-fix/result.md': result([['TC-a-001', 'OK', '#1'], ['TC-a-002', 'OK', '#2']],
        {head: '- 改修確認: #1 ' + verdict + '\n- 修正コミット（#1）: abc1234\n- 元の run: runs/20261119-r1\n'})})));
    assert.deepEqual(report.issues.find(issue => issue.number === 1), {number: 1, tcs: ['TC-a-001'], status, fixRun: 'runs/20261120-fix'}, verdict);
    assert.deepEqual(report.issues.find(issue => issue.number === 2), {number: 2, tcs: ['TC-a-002'], status: '未確認'});
    const unconfirmed = report.findings.filter(f => f.code === 'issue-unconfirmed').map(f => f.issue);
    assert.deepEqual(unconfirmed, status === '確認済み' ? [2] : [1, 2], verdict);
  }
  // The latest fix check decides.
  const later = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md': ng,
    'runs/20261120-fix/result.md': result([['TC-a-001', 'OK', '#1']], {head: '- 改修確認: #1 確認済み\n'}),
    'runs/20261121-fix/result.md': result([['TC-a-001', 'OK', '#1']], {head: '- 改修確認: #1 効いていない\n'})})));
  assert.deepEqual(later.issues[0], {number: 1, tcs: ['TC-a-001'], status: '効いていない', fixRun: 'runs/20261121-fix'});
  // A malformed fix check line does not confirm.
  const malformed = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md': ng,
    'runs/20261120-fix/result.md': result([['TC-a-001', 'OK', '#1']], {head: '- 改修確認: #1 確認済み（たぶん）\n'})})));
  assert.equal(malformed.issues[0].status, '未確認');
});

test('latest run wins', t => {
  const report = traceQaRepository(sandbox(t, base({
    'runs/20261120-a/result.md': result([['TC-a-001', 'OK'], ['TC-a-002', 'OK']]),
    'runs/20261119-z/result.md': result([['TC-a-001', 'NG', '#1'], ['TC-a-002', 'NG', '#1']]),
    'runs/20261120-b/result.md': result([['TC-a-002', 'NG', '#3']])})));
  const latest = report.coverage.flatMap(item => item.latest);
  assert.deepEqual(latest, [
    {tc: 'TC-a-001', result: 'OK', run: 'runs/20261120-a', issues: []},
    {tc: 'TC-a-002', result: 'NG', run: 'runs/20261120-b', issues: [3]}]);
  // A fix-check run with 元の run counts as an ordinary run too.
  const fix = traceQaRepository(sandbox(t, base({
    'runs/20261119-r1/result.md': result([['TC-a-001', 'NG', '#1'], ['TC-a-002', 'OK']]),
    'runs/20261119-r1-fix/result.md': result([['TC-a-001', 'OK', '#1']], {head: '- 改修確認: #1 確認済み\n- 元の run: runs/20261119-r1\n'})})));
  assert.deepEqual(fix.coverage[0].latest, [{tc: 'TC-a-001', result: 'OK', run: 'runs/20261119-r1-fix', issues: [1]}]);
  assert.deepEqual(codes(fix), []);
});

test('a later NG reopens a confirmed issue', t => {
  const runs = {
    'runs/20261119-r1/result.md': result([['TC-a-001', 'NG', '#1'], ['TC-a-002', 'NG', '#1']]),
    'runs/20261120-fix/result.md': result([['TC-a-001', 'OK', '#1'], ['TC-a-002', 'OK', '#1']], {head: '- 改修確認: #1 確認済み\n'})};
  assert.equal(traceQaRepository(sandbox(t, base(runs))).issues[0].status, '確認済み');
  // A later OK keeps it confirmed; a later NG of one of its TCs reopens it, even when the row names another issue.
  assert.equal(traceQaRepository(sandbox(t, base({...runs, 'runs/20261121-r2/result.md': result([['TC-a-002', 'OK']])}))).issues[0].status, '確認済み');
  const reopened = traceQaRepository(sandbox(t, base({...runs, 'runs/20261121-r2/result.md': result([['TC-a-002', 'NG', '#5']])})));
  assert.deepEqual(reopened.issues[0], {number: 1, tcs: ['TC-a-001', 'TC-a-002'], status: '要確認', fixRun: 'runs/20261120-fix'});
  assert.ok(reopened.findings.some(f => f.code === 'issue-unconfirmed' && f.issue === 1));
  // An NG in an earlier run than the fix check does not reopen it.
  const earlier = traceQaRepository(sandbox(t, base({...runs, 'runs/20261118-r0/result.md': result([['TC-a-002', 'NG', '#1']])})));
  assert.equal(earlier.issues[0].status, '確認済み');
});

test('grouped NGs share one issue', t => {
  const report = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md': result([['TC-a-001', 'NG', '#2'], ['TC-a-002', 'NG', '#1, #2']])})));
  assert.deepEqual(report.issues, [
    {number: 1, tcs: ['TC-a-002'], status: '未確認'},
    {number: 2, tcs: ['TC-a-001', 'TC-a-002'], status: '未確認'}]);
  assert.deepEqual(codes(report), ['warning issue-unconfirmed #1', 'warning issue-unconfirmed #2']);
});

function runCli(cwd, args) {
  const out = spawnSync(process.execPath, [cli, ...args], {cwd, encoding: 'utf8'});
  return {status: out.status, json: JSON.parse(out.stdout)};
}
const snapshot = root => readdirSync(root, {recursive: true}).sort().map(path => {
  const full = join(root, path);
  return statSync(full).isFile() ? path + ':' + readFileSync(full, 'base64') : path;
});

test('cli trace prints the report and sets the exit code', t => {
  const before = snapshot(fixture);
  const ok = runCli(fixture, ['qa', 'trace', '.']);
  assert.equal(ok.status, 0);
  assert.equal(ok.json.ok, true);
  assert.equal(ok.json.acs, 4);
  assert.deepEqual(ok.json.issues.map(issue => issue.status), ['確認済み', '要確認', '効いていない']);
  assert.deepEqual(snapshot(fixture), before, 'trace writes nothing');
  assert.ok(!JSON.stringify(ok.json).includes(fixture), 'no absolute paths in the output');

  const root = sandbox(t, {'qa/plan/acceptance.md': acceptance('AC-001'), 'qa/cases/a.md': '# a\n\n' + tcase('TC-a-001', 'AC-001'),
    'qa/runs/20261119-r1/result.md': result([['TC-a-001', 'NG']])});
  for (const dir of ['qa', './qa', 'qa/']) {
    const bad = runCli(root, ['qa', 'trace', dir]);
    assert.equal(bad.status, 1, dir);
    assert.equal(bad.json.ok, false);
    assert.deepEqual(bad.json.findings.map(f => f.code), ['ng-without-issue']);
  }
  const warnOnly = sandbox(t, {'plan/acceptance.md': acceptance('AC-001'), 'cases/a.md': '# a\n\n' + tcase('TC-a-001', 'AC-001') + tcase('TC-a-002', 'AC-001'),
    'runs/20261119-r1/result.md': result([['TC-a-001', 'OK']])});
  const warned = runCli(warnOnly, ['qa', 'trace', '.']);
  assert.equal(warned.status, 0, 'warnings alone do not fail');
  assert.equal(warned.json.ok, true);
  assert.deepEqual(warned.json.findings.map(f => f.level + ' ' + f.code), ['warning case-not-run']);
});

test('cli trace refuses paths outside the repository and absolute paths', t => {
  const root = sandbox(t, {'qa/plan/acceptance.md': acceptance('AC-001'), 'other/x.md': 'x'});
  for (const dir of ['..', '../qa', 'qa/../qa', join(root, 'qa'), 'C:/Windows', '/etc', 'missing', 'other/x.md']) {
    const out = runCli(root, ['qa', 'trace', dir]);
    assert.equal(out.status, 1, dir);
    assert.equal(out.json.ok, false, dir);
    assert.ok(out.json.error, dir);
    assert.equal(out.json.findings, undefined, dir);
  }
  const usage = runCli(root, ['qa', 'trace']);
  assert.equal(usage.status, 1);
  assert.match(usage.json.error, /qa trace DIR/);
  const dry = runCli(root, ['qa', 'trace', 'qa', '--dry-run']);
  assert.equal(dry.status, 1);
});

test('an NG in the fix run itself reopens the issue', t => {
  const fixOwnNG = traceQaRepository(sandbox(t, base({
    'runs/20261119-r1/result.md': result([['TC-a-001', 'NG', '#1'], ['TC-a-002', 'NG', '#1']]),
    'runs/20261120-fix/result.md': result([['TC-a-001', 'OK', '#1'], ['TC-a-002', 'NG', '#1']], {head: '- 改修確認: #1 確認済み\n'})})));
  assert.deepEqual(fixOwnNG.issues[0], {number: 1, tcs: ['TC-a-001', 'TC-a-002'], status: '要確認', fixRun: 'runs/20261120-fix'});
  const finding = fixOwnNG.findings.find(f => f.code === 'issue-unconfirmed');
  assert.deepEqual([finding.file, finding.line, finding.tc], ['runs/20261120-fix/result.md', 11, 'TC-a-002']);
  assert.equal(finding.message, '#1 は runs/20261120-fix で確認済みとされていますが、同じ run で TC-a-002 が NG です。');
});

test('the reopen message names the confirming run and the later NG', t => {
  const report = traceQaRepository(sandbox(t, base({
    'runs/20261119-r1/result.md': result([['TC-a-001', 'NG', '#1'], ['TC-a-002', 'NG', '#1']]),
    'runs/20261120-fix/result.md': result([['TC-a-001', 'OK', '#1'], ['TC-a-002', 'OK', '#1']], {head: '- 改修確認: #1 確認済み\n'}),
    'runs/20261121-r2/result.md': result([['TC-a-001', 'OK'], ['TC-a-002', 'NG', '#5']])})));
  const finding = report.findings.find(f => f.code === 'issue-unconfirmed' && f.issue === 1);
  assert.equal(finding.message, '#1 は runs/20261120-fix で確認済みですが、その後の runs/20261121-r2 で TC-a-002 が NG です。');
  assert.deepEqual([finding.file, finding.line, finding.tc], ['runs/20261121-r2/result.md', 10, 'TC-a-002']);
  // The other messages name the fix-check run too.
  const unsure = traceQaRepository(sandbox(t, base({'runs/20261120-fix/result.md': result([['TC-a-001', 'OK', '#1'], ['TC-a-002', 'OK', '#2']],
    {head: '- 改修確認: #1 要確認\n- 改修確認: #2 効いていない\n'})})));
  assert.deepEqual(unsure.findings.filter(f => f.code === 'issue-unconfirmed').map(f => [f.message, f.file]), [
    ['#1 は runs/20261120-fix の改修確認の結果が要確認です。', 'runs/20261120-fix/result.md'],
    ['#2 は runs/20261120-fix の改修確認で、修正が効いていないとされました。', 'runs/20261120-fix/result.md']]);
});

test('run findings carry the line of the row', t => {
  const report = traceQaRepository(sandbox(t, base({'runs/20261119-r1/result.md':
    result([['TC-a-001', 'NG'], ['TC-a-002', '実行不能'], ['TC-b-001', 'OK']])})));
  assert.deepEqual(report.findings.map(f => [f.code, f.file, f.line]), [
    ['ng-without-issue', 'runs/20261119-r1/result.md', 9],
    ['blocked-without-reason', 'runs/20261119-r1/result.md', 10],
    ['run-unknown-tc', 'runs/20261119-r1/result.md', 11]]);
});

test('malformed and duplicate run rows fail the trace', t => {
  const head = '# 実行結果\n\n- 環境: new\n\n| TC-ID | 結果 | 証跡 | Issue |\n|---|---|---|---|\n';
  for (const [name, rows, code] of [
    ['short NG row', '| TC-a-001 | ng |\n| TC-a-002 | OK | | |\n', 'run-row'],
    ['unknown result', '| TC-a-001 | ng | | |\n| TC-a-002 | OK | | |\n', 'run-result'],
    ['bad TC-ID', '| TC-a-001 | OK | | |\n| TC-a-002 | OK | | |\n| TC-a | NG | | |\n', 'run-tc'],
    ['OK then NG', '| TC-a-001 | OK | | |\n| TC-a-002 | OK | | |\n| TC-a-001 | NG | | |\n', 'duplicate-run-row'],
    ['no table', '表がない\n', 'no-result-table'],
  ]) {
    const text = code === 'no-result-table' ? '# 実行結果\n\n- 環境: new\n\n' + rows : head + rows;
    const root = sandbox(t, base({'runs/20261119-r1/result.md': text}));
    const out = runCli(root, ['qa', 'trace', '.']);
    assert.equal(out.status, 1, name);
    assert.equal(out.json.ok, false, name);
    assert.ok(out.json.findings.some(f => f.level === 'error' && f.code === code), name + ' ' + JSON.stringify(out.json.findings));
  }
  const missing = sandbox(t, base({'runs/20261119-r1/memo.md': 'x\n', 'runs/20261119-r2/result.md': result([['TC-a-001', 'OK'], ['TC-a-002', 'OK']])}));
  const out = runCli(missing, ['qa', 'trace', '.']);
  assert.equal(out.status, 1);
  assert.deepEqual(out.json.findings.map(f => f.level + ' ' + f.code), ['error missing-result']);
});

test('cli trace refuses an empty DIR', t => {
  const root = sandbox(t, base({}));
  const out = runCli(root, ['qa', 'trace', '']);
  assert.equal(out.status, 1);
  assert.equal(out.json.ok, false);
  assert.ok(out.json.error);
  assert.equal(out.json.findings, undefined);
});

test('a DIR with many separators is checked quickly', () => {
  const started = performance.now();
  assert.throws(() => traceDirectory(fixture, '.' + '/'.repeat(100000) + 'x'));
  assert.throws(() => traceDirectory(fixture, 'x' + '/'.repeat(100000) + 'y'));
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 500, 'took ' + Math.round(elapsed) + ' ms');
});
