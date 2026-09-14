#!/usr/bin/env node
/**
 * manifest.json -> 自己完結の静的HTML（顧客提出用エビデンス比較レポート）を生成する。
 *
 * Usage:
 *   node generate-report.js <manifest.json> <output.html> [--link]
 *
 * --link を付けると画像をbase64埋め込みせず、出力先と同じディレクトリの
 * assets/ 配下へコピーして相対パス参照にする（エビデンス量が多く1ファイル
 * 埋め込みだと重すぎる場合に使う。その場合は出力ディレクトリ全体をzip等で渡す）。
 *
 * manifest.jsonのスキーマはSKILL.mdの「マニフェストの形式」を参照。
 */
'use strict';
const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error('ERROR: ' + msg);
  process.exit(1);
}

const args = process.argv.slice(2);
const linkMode = args.includes('--link');
const positional = args.filter((a) => a !== '--link');
const [manifestPath, outPath] = positional;

if (!manifestPath || !outPath) {
  fail('Usage: node generate-report.js <manifest.json> <output.html> [--link]');
}
if (!fs.existsSync(manifestPath)) {
  fail(`manifest not found: ${manifestPath}`);
}

const manifestDir = path.dirname(path.resolve(manifestPath));
const outDir = path.dirname(path.resolve(outPath));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const STATUS_LABEL = { ok: 'OK', ng: 'NG', pending: '未実施' };
const STATUS_CLASS = { ok: 'ok', ng: 'ng', pending: 'pending' };

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function mimeFromExt(ext) {
  const map = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

let assetSeq = 0;
function resolveShot(screenshotRelPath) {
  if (!screenshotRelPath) return null;
  const abs = path.resolve(manifestDir, screenshotRelPath);
  if (!fs.existsSync(abs)) {
    console.warn(`WARN: screenshot not found, skipping: ${abs}`);
    return null;
  }
  const ext = path.extname(abs);
  if (linkMode) {
    const assetsDir = path.join(outDir, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    assetSeq += 1;
    const destName = `${assetSeq}${ext}`;
    fs.copyFileSync(abs, path.join(assetsDir, destName));
    return `assets/${destName}`;
  }
  const b64 = fs.readFileSync(abs).toString('base64');
  return `data:${mimeFromExt(ext)};base64,${b64}`;
}

function statusKey(s) {
  const k = String(s || '').toLowerCase();
  if (k === 'ok' || k === 'pass' || k === 'passed') return 'ok';
  if (k === 'ng' || k === 'fail' || k === 'failed') return 'ng';
  return 'pending';
}

const rounds = manifest.rounds || [];
if (rounds.length === 0) fail('manifest.rounds is empty');

// ラウンドごとのOK/NG/未実施件数を集計（サマリカード用）
const roundCounts = rounds.map(() => ({ ok: 0, ng: 0, pending: 0 }));
for (const screen of manifest.screens || []) {
  for (const tc of screen.testCases || []) {
    for (const r of tc.results || []) {
      const key = statusKey(r.status);
      if (roundCounts[r.round]) roundCounts[r.round][key] += 1;
    }
  }
}

const summaryCardsHtml = rounds.map((label, i) => {
  const c = roundCounts[i] || { ok: 0, ng: 0, pending: 0 };
  return `
    <div class="summary-card">
      <div class="round-label">${escapeHtml(label)}</div>
      <div class="counts">
        <span class="n good">${c.ok}</span><span class="l">OK</span>
        <span class="n bad">${c.ng}</span><span class="l">NG</span>
        ${c.pending ? `<span class="n muted">${c.pending}</span><span class="l">未実施</span>` : ''}
      </div>
    </div>`;
}).join('\n');

function renderRoundCard(tc, roundIndex) {
  const label = rounds[roundIndex];
  const result = (tc.results || []).find((r) => r.round === roundIndex);
  if (!result) {
    return `
      <div class="round-card">
        <div class="round-head"><span class="round-name">${escapeHtml(label)}</span><span class="pill pending">対象外</span></div>
        <div class="no-shot">このラウンドでは未実施</div>
      </div>`;
  }
  const key = statusKey(result.status);
  // screenshot（単数）とscreenshots（複数）の両方を許容し、全て添付する
  const shotPaths = result.screenshots || (result.screenshot ? [result.screenshot] : []);
  const resolved = shotPaths.map(resolveShot).filter(Boolean);
  const shotHtml = resolved.length
    ? `<div class="shot-wrap">${resolved.map((src) => `<img src="${src}" alt="${escapeHtml(tc.name)} - ${escapeHtml(label)}">`).join('')}</div>`
    : `<div class="no-shot">スクリーンショットなし</div>`;
  const noteHtml = result.note ? `<div class="round-note">${escapeHtml(result.note)}</div>` : '';
  return `
      <div class="round-card">
        <div class="round-head"><span class="round-name">${escapeHtml(label)}</span><span class="pill ${STATUS_CLASS[key]}">${STATUS_LABEL[key]}</span></div>
        ${shotHtml}
        ${noteHtml}
      </div>`;
}

function renderTestCase(tc) {
  const roundCards = rounds.map((_, i) => renderRoundCard(tc, i)).join('\n');
  return `
    <div class="testcase">
      <div class="testcase-head">
        <div class="testcase-name">${escapeHtml(tc.name)}</div>
        ${tc.note ? `<div class="testcase-note">${escapeHtml(tc.note)}</div>` : ''}
      </div>
      <div class="rounds-grid">
        ${roundCards}
      </div>
    </div>`;
}

function renderScreen(screen) {
  const cases = (screen.testCases || []).map(renderTestCase).join('\n');
  return `
  <section class="screen">
    <h2 class="screen-title">${escapeHtml(screen.screen)} <span class="count">(${(screen.testCases || []).length}件のテストケース)</span></h2>
    ${cases}
  </section>`;
}

const bodyHtml = (manifest.screens || []).map(renderScreen).join('\n');

const templatePath = path.join(__dirname, '..', 'templates', 'report.html');
let html = fs.readFileSync(templatePath, 'utf8');
html = html
  .replaceAll('{{TITLE}}', escapeHtml(manifest.title || 'エビデンス比較レポート'))
  .replaceAll('{{CUSTOMER}}', escapeHtml(manifest.customer || ''))
  .replaceAll('{{GENERATED_AT}}', escapeHtml(manifest.generatedAt || ''))
  .replaceAll('{{SCREEN_COUNT}}', String((manifest.screens || []).length))
  .replaceAll('{{ROUND_COUNT}}', String(rounds.length))
  .replace('{{SUMMARY_CARDS}}', summaryCardsHtml)
  .replace('{{BODY}}', bodyHtml);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');
console.log(`written: ${outPath}${linkMode ? ` (+ assets/ under ${outDir})` : ' (self-contained, images embedded as base64)'}`);
