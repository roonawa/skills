'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMetaTable, renderReferenceSection } = require('../lib/render-report');

test('renderMetaTable renders one row per meta entry with escaped keys', () => {
  const html = renderMetaTable([{ key: '案件タイプ', value: '現行システム解析' }]);
  assert.match(html, /<table class="meta-table">/);
  assert.match(html, /<th>案件タイプ<\/th>/);
  assert.match(html, /<td>現行システム解析<\/td>/);
});

test('renderMetaTable escapes special characters in values', () => {
  const html = renderMetaTable([{ key: 'k', value: '<b>x</b>' }]);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('renderReferenceSection wraps the text in a collapsible details block', () => {
  const html = renderReferenceSection('ref-policy', '1. テスト方針・前提（参考）', 'サンプル方針\n続き');
  assert.match(html, /<details class="reference-section" id="ref-policy">/);
  assert.match(html, /<summary>1\. テスト方針・前提（参考）<\/summary>/);
  assert.match(html, /<p>サンプル方針<\/p>/);
  assert.match(html, /<p>続き<\/p>/);
});

test('renderReferenceSection returns an empty string when text is empty', () => {
  assert.equal(renderReferenceSection('ref-x', '見出し', ''), '');
});

const { renderTestCaseRow } = require('../lib/render-report');

const SAMPLE_TC = {
  id: 'TC-001',
  name: '正常系：サンプル',
  kind: '画面',
  steps: '手順1',
  expected: '結果1',
  upstreamId: 'BD-999',
  note: '備考1',
};

test('renderTestCaseRow shows the TC id, name, kind, and detail fields', () => {
  const html = renderTestCaseRow(SAMPLE_TC);
  assert.match(html, /data-tc-id="TC-001"/);
  assert.match(html, /<span class="tc-id">TC-001<\/span>/);
  assert.match(html, /正常系：サンプル/);
  assert.match(html, /<span class="tc-kind">画面<\/span>/);
  assert.match(html, /手順1/);
  assert.match(html, /結果1/);
});

test('renderTestCaseRow renders a 4-option status radio group named after the TC id, defaulting to pending', () => {
  const html = renderTestCaseRow(SAMPLE_TC);
  assert.match(html, /name="status-TC-001"/g);
  ['ok', 'ng', 'pending', 'na'].forEach((value) => {
    assert.match(html, new RegExp(`value="${value}"`));
  });
  assert.match(html, /value="pending" checked/);
});

test('renderTestCaseRow renders a comment textarea and an evidence upload area keyed by the TC id', () => {
  const html = renderTestCaseRow(SAMPLE_TC);
  assert.match(html, /<textarea id="comment-TC-001" name="comment-TC-001">/);
  assert.match(html, /data-gallery="gallery-TC-001"/);
  assert.match(html, /id="gallery-TC-001"/);
});

const { renderReport } = require('../lib/render-report');

const SAMPLE_SPEC = {
  title: 'テスト仕様書：BD-999 サンプル機能',
  meta: [{ key: '案件タイプ', value: '現行システム解析' }],
  policyText: 'サンプル方針',
  envText: 'サンプル環境',
  criteriaText: 'サンプル基準',
  testCases: [SAMPLE_TC],
};

test('renderReport embeds the title in both <title> and <h1>', () => {
  const html = renderReport(SAMPLE_SPEC, { basename: 'sample' });
  assert.match(html, /<title>テスト仕様書：BD-999 サンプル機能<\/title>/);
  assert.match(html, /<h1>テスト仕様書：BD-999 サンプル機能<\/h1>/);
});

test('renderReport includes the meta table and reference sections', () => {
  const html = renderReport(SAMPLE_SPEC, { basename: 'sample' });
  assert.match(html, /案件タイプ/);
  assert.match(html, /id="ref-policy"/);
  assert.match(html, /id="ref-env"/);
  assert.match(html, /id="ref-criteria"/);
});

test('renderReport includes one tc-row per test case and the summary stat placeholders', () => {
  const html = renderReport(SAMPLE_SPEC, { basename: 'sample' });
  assert.match(html, /data-tc-id="TC-001"/);
  ['stat-total', 'stat-ok', 'stat-ng', 'stat-pending', 'stat-na', 'stat-progress', 'stat-passrate'].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`));
  });
});

test('renderReport includes the save button and lightbox markup', () => {
  const html = renderReport(SAMPLE_SPEC, { basename: 'sample' });
  assert.match(html, /id="save-button"/);
  assert.match(html, /id="lightbox"/);
  assert.match(html, /id="lightbox-img"/);
});

test('renderReport embeds the basename for the save filename and contains no external resource references', () => {
  const html = renderReport(SAMPLE_SPEC, { basename: 'my-report' });
  assert.match(html, /window\.REPORT_BASENAME = "my-report";/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('renderReport limits the run-date input to 4-digit years via min/max attributes', () => {
  const html = renderReport(SAMPLE_SPEC, { basename: 'sample' });
  assert.match(
    html,
    /<input type="date" name="run-date" min="1900-01-01" max="2099-12-31">/
  );
});

test('renderReport syncs run-date and run-tester input values to their value attribute on save', () => {
  const html = renderReport(SAMPLE_SPEC, { basename: 'sample' });
  assert.match(
    html,
    /document\.querySelectorAll\('input\[type=text\], input\[type=date\]'\)\.forEach\(function \(input\) \{\s*input\.setAttribute\('value', input\.value\);\s*\}\);/
  );
});

test('renderReport doubles the default comment textarea min-height to 120px', () => {
  const html = renderReport(SAMPLE_SPEC, { basename: 'sample' });
  assert.match(html, /\.tc-comment textarea \{[^}]*min-height: 120px;/);
  assert.doesNotMatch(html, /\.tc-comment textarea \{[^}]*min-height: 60px;/);
});

test('renderReport wires up thumbnail clicks via event delegation instead of per-element listeners', () => {
  const html = renderReport(SAMPLE_SPEC, { basename: 'sample' });

  const addThumbnailMatch = html.match(
    /function addThumbnail\(gallery, dataUrl, name\) \{[\s\S]*?\n  \}/
  );
  assert.ok(addThumbnailMatch, 'expected to find the addThumbnail function body');
  assert.doesNotMatch(addThumbnailMatch[0], /addEventListener/);

  assert.match(html, /function handleGalleryClick\(event\) \{/);
  assert.match(html, /event\.target\.closest\('\.gallery img'\)/);
  assert.match(html, /event\.target\.closest\('\.thumb-remove'\)/);
  assert.match(html, /document\.addEventListener\('click', handleGalleryClick\);/);
});
