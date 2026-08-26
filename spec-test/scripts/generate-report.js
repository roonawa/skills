#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseSpec } = require('./lib/parse-spec');
const { renderReport } = require('./lib/render-report');

function generateOne(inputPath, outDir) {
  const markdown = fs.readFileSync(inputPath, 'utf8');
  const spec = parseSpec(markdown);
  const basename = path.basename(inputPath, '.md');
  const html = renderReport(spec, { basename });

  const targetDir = outDir || path.dirname(inputPath);
  fs.mkdirSync(targetDir, { recursive: true });
  const outputPath = path.join(targetDir, `${basename}.html`);
  fs.writeFileSync(outputPath, html, 'utf8');
  return outputPath;
}

function isSpecFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const firstLine = content.split(/\r?\n/, 1)[0] || '';
  return firstLine.trim().startsWith('# テスト仕様書：');
}

function findSpecFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSpecFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md') && isSpecFile(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function parseArgs(argv) {
  const args = { all: null, out: null, input: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') {
      args.all = argv[++i];
    } else if (arg === '--out') {
      args.out = argv[++i];
    } else if (!args.input) {
      args.input = arg;
    }
  }
  return args;
}

function printUsage() {
  console.error('使い方: node generate-report.js <入力md> [--out <出力フォルダ>]');
  console.error('        node generate-report.js --all <入力フォルダ> [--out <出力フォルダ>]');
}

function runAll(inputDir, outArg) {
  const resolvedInputDir = path.resolve(inputDir);
  const files = findSpecFiles(resolvedInputDir);
  if (files.length === 0) {
    console.error(`テスト仕様書フォーマットのファイルが見つかりませんでした: ${resolvedInputDir}`);
    process.exitCode = 1;
    return;
  }
  files.forEach((file) => {
    let outDir = null;
    if (outArg) {
      const relDir = path.relative(resolvedInputDir, path.dirname(file));
      outDir = path.resolve(outArg, relDir);
    }
    const outputPath = generateOne(file, outDir);
    console.log(`生成しました: ${outputPath}`);
  });
}

function main(argv) {
  const args = parseArgs(argv);

  if (args.all) {
    runAll(args.all, args.out);
    return;
  }

  if (!args.input) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const outDir = args.out ? path.resolve(args.out) : null;
  const outputPath = generateOne(path.resolve(args.input), outDir);
  console.log(`生成しました: ${outputPath}`);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, generateOne, findSpecFiles, isSpecFile, parseArgs };
