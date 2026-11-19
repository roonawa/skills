import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readQaRepository } from '../dist/qa-trace-parse.js';

const fixture = fileURLToPath(new URL('./fixtures/qa-repo', import.meta.url));

function sandbox(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'aidev-trace-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), {recursive: true});
    writeFileSync(join(root, path), text);
  }
  return root;
}

const header = '# 実行結果\n\n- 環境: new\n- 版: 1.0\n- 実行日時: 2026-11-19 10:00\n\n';
const table = '| TC-ID | 結果 | 証跡 | Issue |\n|---|---|---|---|\n';

test('ignore fenced blocks and READMEs', () => {
  const repo = readQaRepository(fixture);
  assert.deepEqual(repo.acceptance.map(item => item.id), ['AC-001', 'AC-007', 'AC-014', 'AC-015']);
  assert.deepEqual(repo.cases.map(item => item.id), ['TC-csv-001', 'TC-csv-004', 'TC-csv-005', 'TC-detail-001']);
  const all = JSON.stringify(repo);
  for (const id of ['AC-900', 'AC-901', 'AC-902', 'TC-readme-001', 'TC-readme-002', 'TC-readme-003', 'TC-csv-900', 'TC-csv-999']) {
    assert.ok(!all.includes(id), id + ' should not be read');
  }
  assert.deepEqual(repo.problems, []);

  const ac15 = repo.acceptance.find(item => item.id === 'AC-015');
  assert.equal(ac15.text, 'staff が CSV の URL を直接開くと 403 になる');
  assert.equal(ac15.source, '推定仕様 RS-001');
  assert.equal(ac15.line, 18);

  const csv4 = repo.cases.find(item => item.id === 'TC-csv-004');
  assert.deepEqual(csv4, {id: 'TC-csv-004', name: 'staff が CSV の URL を直接開くと 403 になる', feature: 'csv',
    file: 'cases/csv.md', acs: ['AC-015', 'AC-001'], priority: '高', execution: '自動', line: 17});
  assert.equal(repo.cases.find(item => item.id === 'TC-detail-001').execution, '手動');

  const detail = repo.runs.find(run => run.runId === 'csv-detail');
  assert.equal(detail.rows.length, 4, 'the fenced table and the 流し直し table are not result rows');
  assert.deepEqual(detail.rows.find(row => row.tc === 'TC-detail-001'),
    {tc: 'TC-detail-001', result: '実行不能', issues: [], line: 13, reason: '手動確認待ち（実行が「手動」のケース）。手動確認の項目に再現手順を書いた'});
});

test('skip files directly under runs', () => {
  const repo = readQaRepository(fixture);
  assert.deepEqual(repo.runs.map(run => run.dir), ['runs/20261119-csv-detail', 'runs/20261119-csv-fix']);
  assert.deepEqual(repo.runs.map(run => [run.date, run.runId]), [['20261119', 'csv-detail'], ['20261119', 'csv-fix']]);
});

test('tolerate unknown header lines', () => {
  const repo = readQaRepository(fixture);
  const [detail, fix] = repo.runs;
  assert.equal(detail.environment, 'new');
  assert.equal(detail.version, '02368d1（アプリのリポジトリの HEAD）');
  assert.equal(detail.executedAt, '2026-11-19 11:45〜11:46（実行の前後に取った時刻）');
  assert.deepEqual(detail.fixChecks, []);
  assert.equal(detail.origin, undefined);
  assert.equal(fix.executedAt, '2026-11-19 11:52:52〜11:53:27（実行の前後に取った時刻）');
  assert.equal(fix.origin, 'runs/20261119-csv-detail');
  assert.deepEqual(repo.problems, []);
});

test('read fix-check verdicts and paired commits', () => {
  const fix = readQaRepository(fixture).runs[1];
  assert.deepEqual(fix.fixChecks, [
    {issue: 1, verdict: '確認済み', commit: '6b6cab6'},
    {issue: 2, verdict: '要確認', note: '修正を戻した版を起動できず、修正の前で失敗することを確かめていない', commit: '5d6e7f8、9a0b1c2（追いのコミット）'},
    {issue: 3, verdict: '効いていない'},
  ]);
});

test('read multiple issue numbers in one cell', t => {
  const repo = readQaRepository(fixture);
  const detail = repo.runs[0];
  assert.deepEqual(detail.rows.map(row => [row.tc, row.result, row.issues]), [
    ['TC-csv-001', 'NG', [2]], ['TC-csv-004', 'NG', [1, 2]], ['TC-csv-005', 'NG', [1]], ['TC-detail-001', '実行不能', []],
  ]);
  assert.equal(detail.rows[0].evidence, 'runs/20261119-csv-detail/evidence/TC-csv-001/');
  assert.equal(detail.rows[3].evidence, undefined);

  const root = sandbox(t, {
    'plan/acceptance.md': '- AC-001: 結果（出どころ: 1.1）\n',
    'runs/20261120-group/result.md': header + table +
      '| TC-a-001 | NG | runs/x/evidence/a\\|b/ | #3 #4、#5 |\n| TC-a-002 | NG | | #3 |\n',
  });
  const run = readQaRepository(root).runs[0];
  assert.deepEqual(run.rows.map(row => row.issues), [[3, 4, 5], [3]]);
  assert.equal(run.rows[0].evidence, 'runs/x/evidence/a|b/');
});

test('report malformed lines as problems', t => {
  const root = sandbox(t, {
    'plan/acceptance.md': '- AC-001: 正しい行（出どころ: 1.1）\n- AC-1234567: 桁が多い\n- AC-002 コロンがない\n- AC-001: 重複（出どころ: 1.2）\n',
    'cases/a.md': '# a\n\n### TC-a-001 正しいケース\n- AC: AC-001, ACX\n- 実行: 半自動\n\n### TC-a 番号がない\n- AC: AC-001\n\n### TC-a-001 重複\n',
    'runs/notarun/result.md': header,
    'runs/20261120-empty/memo.md': 'result.md がない\n',
    'runs/20261120-bad/result.md': header +
      '- 改修確認: #1 たぶん直った\n- 修正コミット（#9）: abc1234\n\n' + table +
      '| TC-a-001 | 未実施 | | |\n| TC-a-002 | NG | | 12 |\n| 不正な ID | OK | | |\n| TC-a-003 | OK |\n| TC-a-004 | OK | | |\n| TC-a-004 | NG | | |\n',
    'runs/20261120-notable/result.md': header + '表がない\n',
  });
  const repo = readQaRepository(root);
  const got = repo.problems.map(problem => [problem.code, problem.file, problem.line]);
  const expect = [
    ['acceptance-line', 'plan/acceptance.md', 2],
    ['acceptance-line', 'plan/acceptance.md', 3],
    ['duplicate-acceptance', 'plan/acceptance.md', 4],
    ['case-ac', 'cases/a.md', 4],
    ['case-execution', 'cases/a.md', 5],
    ['case-heading', 'cases/a.md', 7],
    ['duplicate-case', 'cases/a.md', 10],
    ['fix-check', 'runs/20261120-bad/result.md', 7],
    ['fix-commit-unpaired', 'runs/20261120-bad/result.md', 8],
    ['run-result', 'runs/20261120-bad/result.md', 12],
    ['run-issue', 'runs/20261120-bad/result.md', 13],
    ['run-tc', 'runs/20261120-bad/result.md', 14],
    ['run-row', 'runs/20261120-bad/result.md', 15],
    ['duplicate-run-row', 'runs/20261120-bad/result.md', 17],
    ['missing-result', 'runs/20261120-empty/result.md', undefined],
    ['no-result-table', 'runs/20261120-notable/result.md', undefined],
    ['run-dir', 'runs/notarun', undefined],
  ];
  for (const item of expect) assert.ok(got.some(g => JSON.stringify(g) === JSON.stringify(item)), 'missing ' + JSON.stringify(item) + ' in ' + JSON.stringify(got));
  assert.equal(got.length, expect.length, JSON.stringify(got));
  for (const problem of repo.problems) assert.ok(problem.message.length > 0);

  assert.deepEqual(repo.acceptance.map(item => item.id), ['AC-001']);
  assert.deepEqual(repo.cases.map(item => [item.id, item.acs, item.execution]), [['TC-a-001', ['AC-001'], undefined]]);
  const bad = repo.runs.find(run => run.runId === 'bad');
  assert.deepEqual(bad.fixChecks, []);
  assert.deepEqual(bad.rows.map(row => [row.tc, row.result, row.issues]), [['TC-a-002', 'NG', []], ['TC-a-004', 'OK', []]]);
  assert.deepEqual(repo.runs.map(run => run.runId), ['bad', 'notable']);
});

test('missing plan is a problem', t => {
  const root = sandbox(t, {'cases/a.md': '### TC-a-001 x\n- AC: AC-001\n'});
  const repo = readQaRepository(root);
  assert.deepEqual(repo.problems.map(problem => problem.code), ['missing-acceptance']);
  assert.equal(repo.cases.length, 1);
  assert.deepEqual(repo.runs, []);
});

test('links to files outside the repository are not followed', t => {
  const outside = sandbox(t, {
    'cases/x.md': '### TC-outside-001 外のケース\n- AC: AC-001\n',
    'runs/20261120-outside/result.md': header + table + '| TC-outside-001 | OK | | |\n',
  });
  const root = sandbox(t, {'plan/acceptance.md': '- AC-001: a（出どころ: 1）\n', 'cases/a.md': '### TC-a-001 x\n- AC: AC-001\n'});
  mkdirSync(join(root, 'runs'));
  try {
    symlinkSync(join(outside, 'cases', 'x.md'), join(root, 'cases', 'x.md'), 'file');
    symlinkSync(join(outside, 'runs', '20261120-outside'), join(root, 'runs', '20261120-outside'), 'junction');
  } catch (error) {
    t.skip('links cannot be created here: ' + error.code);
    return;
  }
  const repo = readQaRepository(root);
  assert.deepEqual(repo.cases.map(item => item.id), ['TC-a-001']);
  assert.deepEqual(repo.runs, []);
  assert.ok(!JSON.stringify(repo).includes('outside-001'));
});

test('large repository stays fast', t => {
  const cases = [];
  for (let i = 1; i <= 5000; i++) {
    cases.push('### TC-big-' + String(i).padStart(4, '0') + ' ケース ' + i + '\n- AC: AC-001, AC-002\n- 優先度: 中\n- 実行: 自動\n手順\n1. 開く\n期待結果\n- 出る\n');
  }
  const rows = [];
  let size = 0;
  for (let i = 1; size < 1000 * 1000; i++) {
    const row = '| TC-big-' + String(i).padStart(6, '0') + ' | NG | runs/20261120-big/evidence/TC-big-' + i + '/ | #' + (i % 50 + 1) + ', #7 |\n';
    rows.push(row);
    size += Buffer.byteLength(row);
  }
  const root = sandbox(t, {
    'plan/acceptance.md': '- AC-001: a（出どころ: 1）\n- AC-002: b（出どころ: 2）\n',
    'cases/big-1.md': cases.slice(0, 2500).join('\n'),
    'cases/big-2.md': cases.slice(2500).join('\n'),
    'runs/20261120-big/result.md': header + table + rows.join(''),
  });
  const started = performance.now();
  const repo = readQaRepository(root);
  const elapsed = performance.now() - started;
  assert.equal(repo.cases.length, 5000);
  assert.equal(repo.runs[0].rows.length, rows.length);
  assert.deepEqual(repo.problems, []);
  assert.ok(elapsed < 3000, 'took ' + elapsed + ' ms');
});

/** Reads the repository in a child process, so that a regular expression that never ends cannot hang the tests. */
function timedRead(root, name) {
  const module = new URL('../dist/qa-trace-parse.js', import.meta.url).href;
  const code = 'const {readQaRepository} = await import(' + JSON.stringify(module) + ');' +
    'const t = performance.now(); const repo = readQaRepository(' + JSON.stringify(root) + ');' +
    'console.log(JSON.stringify({ms: performance.now() - t, problems: repo.problems.map(p => p.code)}));';
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], {encoding: 'utf8', timeout: 10000});
  assert.equal(out.status, 0, name + ': the read did not finish: ' + (out.error?.code ?? out.stderr));
  return JSON.parse(out.stdout);
}

test('long padded lines are read in linear time', t => {
  // Just under the 1 MiB limit of a file, with no colon to stop at.
  const pad = ' '.repeat(1024 * 1024 - 4096);
  const files = {
    'acceptance bullet': {'plan/acceptance.md': '- ' + pad + 'z\n'},
    'acceptance source': {'plan/acceptance.md': '- AC-001: a' + pad + 'b（出どころ: c' + ' '.repeat(2000) + 'd\n'},
    // With the closing ）, sourceNote itself runs: padding before the note and inside it.
    'acceptance source closed': {'plan/acceptance.md': '- AC-001: a' + pad + 'b（出どころ:' + ' '.repeat(2000) + 'c' + ' '.repeat(2000) + '）\n'},
    // Many （出どころ without a colon: each one is looked at, none may copy the rest of the line.
    'many source notes': {'plan/acceptance.md': '- AC-001: a' + '（出どころ'.repeat(60000) + '）\n'},
    'case field': {'plan/acceptance.md': '- AC-001: a\n', 'cases/a.md': '### TC-a-001 x\n- AC: AC-001\n- ' + pad + 'z\n'},
    'result header': {'plan/acceptance.md': '- AC-001: a\n', 'runs/20261120-r/result.md': '# 実行結果\n\n- ' + pad + 'z\n\n' + table + '| TC-a-001 | OK | | |\n'},
    'result reason': {'plan/acceptance.md': '- AC-001: a\n', 'runs/20261120-r/result.md': header + table + '| TC-a-001 | 実行不能 | | |\n\n## 実行不能の理由\n\n### TC-a-001\n- ' + pad + 'z\n'},
    // U+2028 is not matched by `.` without the s flag, and is \s: a pattern like \s+(.+)$ would backtrack.
    'case heading with U+2028': {'plan/acceptance.md': '- AC-001: a\n', 'cases/a.md': '### TC-a-001' + pad + 'a\u2028b\n- AC: AC-001\n'},
    'fix check with U+2028': {'plan/acceptance.md': '- AC-001: a\n', 'runs/20261120-r/result.md': '# 実行結果\n\n- 改修確認: #1' + pad + 'a\u2028b\n\n' + table + '| TC-a-001 | OK | | |\n'},
  };
  for (const [name, content] of Object.entries(files)) {
    const {ms} = timedRead(sandbox(t, content), name);
    assert.ok(ms < 2000, name + ' took ' + Math.round(ms) + ' ms');
  }
});

test('an indented fence is still a fence', t => {
  const fence = '    ```\n';
  const root = sandbox(t, {
    'plan/acceptance.md': '- AC-001: a\n' + fence + '- AC-002: 囲みの中\n' + fence,
    'cases/a.md': '### TC-a-001 x\n- AC: AC-001\n\n' + fence + '### TC-a-002 囲みの中\n- AC: AC-001\n' + fence,
    'runs/20261120-r/result.md': header + table + '| TC-a-001 | OK | | |\n\n' + fence + table + '| TC-a-002 | OK | | |\n' + fence,
  });
  const repo = readQaRepository(root);
  assert.deepEqual(repo.acceptance.map(item => item.id), ['AC-001']);
  assert.deepEqual(repo.cases.map(item => item.id), ['TC-a-001']);
  assert.deepEqual(repo.runs[0].rows.map(row => row.tc), ['TC-a-001']);
});

test('links under cases and runs are reported, not skipped', t => {
  const outside = sandbox(t, {
    'cases/x.md/keep': 'x',
    'runs/20261120-outside/result.md': header + table + '| TC-outside-001 | OK | | |\n',
  });
  const root = sandbox(t, {'plan/acceptance.md': '- AC-001: a（出どころ: 1）\n', 'cases/a.md': '### TC-a-001 x\n- AC: AC-001\n'});
  mkdirSync(join(root, 'runs'));
  try {
    symlinkSync(join(outside, 'cases', 'x.md'), join(root, 'cases', 'linked.md'), 'junction');
    symlinkSync(join(outside, 'runs', '20261120-outside'), join(root, 'runs', '20261120-outside'), 'junction');
  } catch (error) {
    t.skip('links cannot be created here: ' + error.code);
    return;
  }
  const repo = readQaRepository(root);
  assert.deepEqual(repo.problems.map(problem => [problem.code, problem.file]),
    [['unreadable', 'cases/linked.md'], ['unreadable', 'runs/20261120-outside']]);
  assert.deepEqual(repo.cases.map(item => item.id), ['TC-a-001']);
  assert.deepEqual(repo.runs, []);
  assert.ok(!JSON.stringify(repo).includes('outside-001'));
});

test('links directly under runs/ are errors only when named like a run; file links under cases/ are errors', t => {
  const outside = sandbox(t, {'x.md': '### TC-outside-001 外\n- AC: AC-001\n', 'run/result.md': header + table + '| TC-outside-001 | OK | | |\n'});
  const root = sandbox(t, {'plan/acceptance.md': '- AC-001: a\n', 'cases/a.md': '### TC-a-001 x\n- AC: AC-001\n'});
  mkdirSync(join(root, 'runs'));
  try {
    symlinkSync(join(outside, 'run'), join(root, 'runs', '20261120-linked'), 'junction');
    symlinkSync(join(outside, 'run'), join(root, 'runs', 'notarun'), 'junction');
  } catch (error) {
    t.skip('junctions cannot be created here: ' + error.code);
    return;
  }
  let files = true;
  try {
    symlinkSync(join(outside, 'x.md'), join(root, 'runs', 'README.md'), 'file');
    symlinkSync(join(outside, 'x.md'), join(root, 'runs', '20261120-linked.compare.json'), 'file');
    symlinkSync(join(outside, 'x.md'), join(root, 'cases', 'linked.md'), 'file');
  } catch {
    files = false; // File symlinks need a privilege on Windows; the junction part still runs.
  }
  const repo = readQaRepository(root);
  const expected = [...(files ? [['unreadable', 'cases/linked.md']] : []), ['unreadable', 'runs/20261120-linked']];
  assert.deepEqual(repo.problems.map(problem => [problem.code, problem.file]), expected);
  assert.deepEqual(repo.runs, []);
  assert.deepEqual(repo.cases.map(item => item.id), ['TC-a-001']);
  assert.ok(!JSON.stringify(repo).includes('outside-001'));
});

test('an evidence cell of "-" means no evidence', t => {
  const root = sandbox(t, {'runs/20261120-r/result.md': header + table + '| TC-a-001 | OK | - | |\n| TC-a-002 | OK | runs/x/ | |\n'});
  const [first, second] = readQaRepository(root).runs[0].rows;
  assert.equal(first.evidence, undefined);
  assert.equal(second.evidence, 'runs/x/');
});

test('duplicate IDs and run rows carry the ID and the line', t => {
  const root = sandbox(t, {
    'plan/acceptance.md': '- AC-001: a\n- AC-001: b\n',
    'cases/a.md': '### TC-a-001 x\n- AC: AC-001\n\n### TC-a-001 y\n',
    'runs/20261120-r/result.md': header + table + '| TC-a-001 | OK | | |\n| TC-a-002 | NG | | #1 |\n',
  });
  const repo = readQaRepository(root);
  assert.deepEqual(repo.problems.map(problem => [problem.code, problem.id, problem.line]),
    [['duplicate-acceptance', 'AC-001', 2], ['duplicate-case', 'TC-a-001', 4]]);
  assert.deepEqual(repo.runs[0].rows.map(row => [row.tc, row.line]), [['TC-a-001', 9], ['TC-a-002', 10]]);
});
