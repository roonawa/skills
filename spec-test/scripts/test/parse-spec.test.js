'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTable, splitRow, isSeparatorRow } = require('../lib/parse-spec');

test('splitRow splits a markdown table row into trimmed cells', () => {
  assert.deepEqual(splitRow('| a | b | c |'), ['a', 'b', 'c']);
});

test('splitRow trims surrounding whitespace in each cell', () => {
  assert.deepEqual(splitRow('|  a  |b|'), ['a', 'b']);
});

test('isSeparatorRow detects a markdown table separator row', () => {
  assert.equal(isSeparatorRow(['---', '---']), true);
  assert.equal(isSeparatorRow([':--', '--:']), true);
});

test('isSeparatorRow returns false for a normal data row', () => {
  assert.equal(isSeparatorRow(['a', '---']), false);
});

test('parseTable parses header and data rows, skipping the separator row', () => {
  const lines = ['| a | b |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'];
  const table = parseTable(lines);
  assert.deepEqual(table.headers, ['a', 'b']);
  assert.deepEqual(table.rows, [['1', '2'], ['3', '4']]);
});

test('parseTable ignores non-table lines mixed into the input', () => {
  const lines = ['見出し文', '| a | b |', '| --- | --- |', '| 1 | 2 |', ''];
  const table = parseTable(lines);
  assert.deepEqual(table.headers, ['a', 'b']);
  assert.deepEqual(table.rows, [['1', '2']]);
});

test('parseTable returns empty headers and rows when given no table lines', () => {
  const table = parseTable(['見出し文', '']);
  assert.deepEqual(table, { headers: [], rows: [] });
});

const { parseSpec } = require('../lib/parse-spec');

const SAMPLE_MD = `# テスト仕様書：BD-999 サンプル機能

| 項目 | 内容 |
| --- | --- |
| 案件タイプ | 現行システム解析（レガシー解析・第1段階） |
| バージョン | 0.1（草案） |

## 1. テスト方針・前提

本テスト仕様書はサンプルである。

### 1.1 上流設計書との対応

| 上流ID | 機能名 | 展開先TC-ID |
| --- | --- | --- |
| BD-999 | サンプル機能 | TC-001～TC-002 |

## 2. テスト環境・データ

### 2.1 環境構成

- サンプル環境

## 3. テストケース

| TC-ID | テスト名 | 種別 | 手順 | 期待結果 | 上流ID | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-001 | 正常系：サンプル | 画面 | サンプル手順 | サンプル結果 | BD-999 | §1 |
| TC-002 | 異常系：サンプル | 画面 | サンプル手順2 | サンプル結果2 | BD-999 | §1 |

## 4. 結合・シナリオテスト

サンプルシナリオ

## 5. 合否基準・残課題

### 5.1 リリース判定基準

- 全TC実施完了
`;

test('parseSpec extracts the title without the leading "# "', () => {
  const spec = parseSpec(SAMPLE_MD);
  assert.equal(spec.title, 'テスト仕様書：BD-999 サンプル機能');
});

test('parseSpec extracts the meta table as key/value pairs', () => {
  const spec = parseSpec(SAMPLE_MD);
  assert.deepEqual(spec.meta, [
    { key: '案件タイプ', value: '現行システム解析（レガシー解析・第1段階）' },
    { key: 'バージョン', value: '0.1（草案）' },
  ]);
});

test('parseSpec extracts section 1/2/5 raw text but stops at the next "## " heading', () => {
  const spec = parseSpec(SAMPLE_MD);
  assert.match(spec.policyText, /本テスト仕様書はサンプルである/);
  assert.match(spec.policyText, /上流設計書との対応/);
  assert.doesNotMatch(spec.policyText, /テスト環境・データ/);
  assert.match(spec.envText, /サンプル環境/);
  assert.match(spec.criteriaText, /全TC実施完了/);
});

test('parseSpec parses every row of the section 3 test case table', () => {
  const spec = parseSpec(SAMPLE_MD);
  assert.equal(spec.testCases.length, 2);
  assert.deepEqual(spec.testCases[0], {
    id: 'TC-001',
    name: '正常系：サンプル',
    kind: '画面',
    steps: 'サンプル手順',
    expected: 'サンプル結果',
    upstreamId: 'BD-999',
    note: '§1',
  });
  assert.equal(spec.testCases[1].id, 'TC-002');
});

test('parseSpec throws a clear error when the title line is missing', () => {
  assert.throws(() => parseSpec('本文のみ、見出しなし'), /タイトル行/);
});

test('parseSpec throws a clear error when section 3 is missing', () => {
  const noSection3 = '# テスト仕様書：BD-000 テスト\n\n| 項目 | 内容 |\n| --- | --- |\n| a | b |\n';
  assert.throws(() => parseSpec(noSection3), /テストケース/);
});
