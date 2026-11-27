import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkSpecText } from '../dist/spec.js';
import { runLoop } from '../dist/loop.js';

const codes = issues => issues.map(issue => issue.code);
const good = [
  '# 商品レビュー一覧（タスク名: review-list）',
  '## 受け入れ条件',
  '- AC-001: 投稿日時の新しい順に表示する（出典: 要件定義書 3.2）',
  '- AC-002：コメントは入力された文字のまま表示する',
  '- AC-003: 取り下げ（AC-001 に統合）',
  '## やらないこと',
  '- 並べ替えの切り替え UI',
  '## 判断待ち',
  'なし',
].join('\n');

test('a well-formed specification passes and lists its criteria', () => {
  const report = checkSpecText('spec.md', good);
  assert.deepEqual([report.errors, report.warnings], [[], []]);
  assert.deepEqual([report.acceptance, report.withdrawn, report.outOfScope, report.pending], [['AC-001', 'AC-002'], ['AC-003'], 1, []]);
  // The C-HUB request template writes sections as `見出し:` lines and may use CRLF.
  const template = '対象リポジトリ: org/app\r\n受け入れ条件:\r\n- AC-001: 一覧に件数を出す\r\nやらないこと:\r\n- 検索\r\n';
  assert.deepEqual(checkSpecText('task', template).errors, []);
});

test('template labels and the re-run line after 判断待ち are not open questions', () => {
  const rerun = good + '\n再実行: 2\n参考: docs/spec.md';
  assert.deepEqual(checkSpecText('s', rerun).errors, []);
  const after = good.replace('なし', 'なし\n再実行: 3\n- AC-009: 節の外の行');
  assert.deepEqual([checkSpecText('s', after).errors, checkSpecText('s', after).acceptance], [[], ['AC-001', 'AC-002']]);
  // A real open question before the re-run line still stops the run.
  assert.deepEqual(checkSpecText('s', good.replace('なし', '- 改行の扱い\n再実行: 2')).errors.map(e => e.code), ['open-questions']);
});

test('missing parts and open questions stop the run', () => {
  assert.deepEqual(codes(checkSpecText('s', '# 仕様\n説明だけ').errors),
    ['missing-acceptance-section', 'no-criteria', 'missing-out-of-scope']);
  const open = good.replace('なし', '| Q-001 | 同じ日に2件予約できるか | A/B | 業務責任者 | AC-001 | 現行どおり |');
  const report = checkSpecText('s', open);
  assert.deepEqual(codes(report.errors), ['open-questions']);
  assert.match(report.pending[0], /Q-001/);
  const marked = good.replace('文字のまま表示する', '文字のまま表示する（改行の扱いは ⚠要確認）');
  assert.ok(codes(checkSpecText('s', marked).errors).includes('unconfirmed'));
  const duplicated = good.replace('AC-002：', 'AC-001：');
  assert.ok(codes(checkSpecText('s', duplicated).errors).includes('duplicate-id'));
  const pending = good.replace('文字のまま表示する', '判断待ち（Q-002）');
  assert.ok(codes(checkSpecText('s', pending).errors).includes('pending-criterion'));
});

test('vague words, an empty out-of-scope section and a large task are warnings', () => {
  const vague = good.replace('新しい順に表示する', '適切な順に速やかに表示する');
  const report = checkSpecText('s', vague);
  assert.deepEqual([report.errors, codes(report.warnings)], [[], ['vague-criterion']]);
  assert.match(report.warnings[0].message, /適切・速やかに/);
  assert.equal(report.warnings[0].line, 3);
  assert.deepEqual(codes(checkSpecText('s', good.replace('- 並べ替えの切り替え UI', 'なし')).warnings), ['out-of-scope-none']);
  const many = Array.from({length: 11}, (_, n) => '- AC-' + String(n + 1).padStart(3, '0') + ': 値 ' + n).join('\n');
  assert.deepEqual(codes(checkSpecText('s', '## 受け入れ条件\n' + many + '\n## やらないこと\n- x').warnings), ['too-large']);
});

test('CLI spec check returns the report, and workflow run refuses an incomplete specification before any session', async t => {
  const root = mkdtempSync(join(tmpdir(), 'aidev-spec-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'good.md'), good);
  writeFileSync(join(root, 'docs', 'open.md'), good.replace('なし', '- 改行の扱い'));
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const run = (args, status) => {
    const result = spawnSync(process.execPath, [cli, ...args], {cwd: root, encoding: 'utf8'});
    assert.equal(result.status, status, result.stdout);
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(run(['spec', 'check', 'docs/good.md'], 0).acceptance, ['AC-001', 'AC-002']);
  assert.deepEqual(codes(run(['spec', 'check', 'docs/open.md'], 1).errors), ['open-questions']);
  await assert.rejects(runLoop(root, 'menu', 'docs/open.md', {runner: () => assert.fail('session started')}), /判断待ち/);
});
