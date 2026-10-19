import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectHTML, checkPolicy, internalLinks } from '../lib/audit.mjs';
const spec = {indexable:true, canonical:'https://example.test/about', title:'会社概要'};
const html = (extra='') => `<html lang="ja"><head><title>会社概要</title><link rel="canonical" href="https://example.test/about">${extra}</head><body><main>会社</main></body></html>`;
test('robots tag is optional and correct canonical content is required', () => {
  assert.deepEqual(inspectHTML(html(), {}, spec, 'https://example.test/about'), []);
  assert.ok(inspectHTML(html().replace('https://example.test/about','https://old.test/about'), {}, spec, 'https://example.test/about').some(x=>x.includes('canonical')));
});
test('meta and HTTP noindex are both detected', () => {
  for (const [body, headers] of [[html('<meta name="robots" content="noindex">'),{}],[html(),{'x-robots-tag':'noindex'}]])
    assert.ok(inspectHTML(body, headers, spec, 'https://example.test/about').some(x=>x.includes('indexable')));
});
test('blocked endpoint does not pass merely because it redirects to login', () => {
  assert.ok(checkPolicy({status:302,headers:{location:'/wp-login.php'},body:''}, {statuses:[403,404]}).length);
});
test('empty PHP response can pass explicit policy but leaked source cannot', () => {
  const policy={statuses:[200,403,404],forbiddenText:['DB_PASSWORD','<?php']};
  assert.deepEqual(checkPolicy({status:200,headers:{},body:''},policy),[]);
  assert.ok(checkPolicy({status:200,headers:{},body:"<?php define('DB_PASSWORD','secret');"},policy).length);
});
test('relative redirect location resolves against response URL, not site root', () => {
  const response={url:'https://example.test/dir/start',status:302,headers:{location:'next'},body:''};
  assert.ok(checkPolicy(response,{statuses:[302],location:'/next'},'https://example.test').length);
  assert.deepEqual(checkPolicy(response,{statuses:[302],location:'/dir/next'},'https://example.test'),[]);
});
test('links and canonical respect HTML base href', () => {
  assert.deepEqual(internalLinks('<base href="/other/"><a href="missing">x</a>','https://example.test/dir/start'),['https://example.test/other/missing']);
  assert.deepEqual(internalLinks('<base href="https://external.test/"><a href="missing">x</a>','https://example.test/dir/start'),[]);
  assert.deepEqual(inspectHTML('<title>会社概要</title><base href="/other/"><link rel="canonical" href="about">',{}, {...spec,canonical:'https://example.test/other/about'},'https://example.test/start'),[]);
});
