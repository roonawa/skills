'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, inlineFormat } = require('../lib/html-utils');

test('escapeHtml escapes special characters', () => {
  assert.equal(escapeHtml('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
});

test('inlineFormat converts bold and inline code after escaping', () => {
  assert.equal(inlineFormat('**太字**と`コード`'), '<strong>太字</strong>と<code>コード</code>');
});

test('inlineFormat escapes plain text with no markdown', () => {
  assert.equal(inlineFormat('a<b>c'), 'a&lt;b&gt;c');
});

test('inlineFormat handles text with no special characters', () => {
  assert.equal(inlineFormat('通常のテキスト'), '通常のテキスト');
});
