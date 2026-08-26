'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main, parseArgs } = require('../generate-report');

const SAMPLE_MD = `# テスト仕様書：BD-999 サンプル機能

| 項目 | 内容 |
| --- | --- |
| バージョン | 0.1（草案） |

## 1. テスト方針・前提

サンプル方針

## 2. テスト環境・データ

サンプル環境

## 3. テストケース

| TC-ID | テスト名 | 種別 | 手順 | 期待結果 | 上流ID | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-001 | 正常系：サンプル | 画面 | 手順 | 結果 | BD-999 | - |

## 5. 合否基準・残課題

サンプル基準
`;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'generate-report-test-'));
}

test('parseArgs reads a positional input path', () => {
  assert.deepEqual(parseArgs(['spec.md']), { all: null, out: null, input: 'spec.md' });
});

test('parseArgs reads --out and --all flags', () => {
  assert.deepEqual(parseArgs(['--all', 'dir', '--out', 'outdir']), {
    all: 'dir',
    out: 'outdir',
    input: null,
  });
});

test('main generates an html file next to the input by default', () => {
  const dir = makeTempDir();
  const inputPath = path.join(dir, 'テスト仕様書_BD-999_サンプル機能_v0.1.md');
  fs.writeFileSync(inputPath, SAMPLE_MD, 'utf8');

  main([inputPath]);

  const outputPath = path.join(dir, 'テスト仕様書_BD-999_サンプル機能_v0.1.html');
  assert.equal(fs.existsSync(outputPath), true);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /TC-001/);
});

test('main writes to --out when specified, creating the directory if needed', () => {
  const dir = makeTempDir();
  const inputPath = path.join(dir, 'spec.md');
  fs.writeFileSync(inputPath, SAMPLE_MD, 'utf8');
  const outDir = path.join(dir, 'out', 'nested');

  main([inputPath, '--out', outDir]);

  assert.equal(fs.existsSync(path.join(outDir, 'spec.html')), true);
});

test('main sets a non-zero exitCode and prints usage when no input is given', () => {
  const originalExitCode = process.exitCode;
  const originalError = console.error;
  const messages = [];
  console.error = (msg) => messages.push(msg);

  main([]);

  assert.equal(process.exitCode, 1);
  assert.ok(messages.some((m) => m.includes('使い方')));

  process.exitCode = originalExitCode;
  console.error = originalError;
});

const { findSpecFiles, isSpecFile } = require('../generate-report');

test('isSpecFile returns true only for files whose first line is the spec-test title heading', () => {
  const dir = makeTempDir();
  const specPath = path.join(dir, 'a.md');
  const otherPath = path.join(dir, 'b.md');
  fs.writeFileSync(specPath, '# テスト仕様書：BD-001 サンプル\n\n本文\n', 'utf8');
  fs.writeFileSync(otherPath, '# 別のドキュメント\n\n本文\n', 'utf8');

  assert.equal(isSpecFile(specPath), true);
  assert.equal(isSpecFile(otherPath), false);
});

test('findSpecFiles recursively finds spec-formatted markdown files and skips others', () => {
  const dir = makeTempDir();
  const subDir = path.join(dir, '01_編');
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(subDir, 'spec-a.md'), SAMPLE_MD, 'utf8');
  fs.writeFileSync(path.join(subDir, 'not-a-spec.md'), '# 別のドキュメント\n本文\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'readme.txt'), '無関係なファイル', 'utf8');

  const found = findSpecFiles(dir);

  assert.deepEqual(found, [path.join(subDir, 'spec-a.md')]);
});

test('main --all generates one html per spec file and mirrors the folder structure under --out', () => {
  const dir = makeTempDir();
  const subDir = path.join(dir, '01_編');
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(subDir, 'spec-a.md'), SAMPLE_MD, 'utf8');
  fs.writeFileSync(path.join(subDir, 'not-a-spec.md'), '# 別のドキュメント\n本文\n', 'utf8');
  const outDir = path.join(dir, 'out');

  main(['--all', dir, '--out', outDir]);

  assert.equal(fs.existsSync(path.join(outDir, '01_編', 'spec-a.html')), true);
  assert.equal(fs.existsSync(path.join(outDir, '01_編', 'not-a-spec.html')), false);
});

test('main --all without --out writes each html next to its source file', () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'spec-a.md'), SAMPLE_MD, 'utf8');

  main(['--all', dir]);

  assert.equal(fs.existsSync(path.join(dir, 'spec-a.html')), true);
});

test('main --all reports an error and sets exitCode when no spec files are found', () => {
  const dir = makeTempDir();
  const originalExitCode = process.exitCode;
  const originalError = console.error;
  const messages = [];
  console.error = (msg) => messages.push(msg);

  main(['--all', dir]);

  assert.equal(process.exitCode, 1);
  assert.ok(messages.some((m) => m.includes('見つかりませんでした')));

  process.exitCode = originalExitCode;
  console.error = originalError;
});
