import {test} from 'node:test';import assert from 'node:assert/strict';
import {inspectDocument} from '../lib/checks/standard.mjs';
import {generateCases} from '../ui/public/case-generator.js';
import {validateConfig,catalog} from '../lib/config.mjs';
test('standard suite selects only read-only common tests, leaving journeys unselected',()=>{
 const c=validateConfig(generateCases({name:'Fixture',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:false}]}));
 const rows=catalog(c,'standard'),selected=rows.filter(r=>r.selected);assert.equal(selected.length,12);assert(selected.every(r=>['standard-public','security-baseline'].includes(r.kind)));
 // 共通自動検査は基礎診断を含む。許可のない機密パス確認だけは「設定が必要」で選ばない。
 assert.equal(selected.filter(r=>r.kind==='standard-public').length,8);assert.deepEqual(rows.filter(r=>r.kind==='security-baseline'&&!r.selected).map(r=>r.id),['check.auto-security-exposure']);
});
test('standard metadata detects malformed structured data rather than approving observed output',()=>{
 const r=inspectDocument('metadata','<html lang="ja"><title>Example</title><script type="application/ld+json">bad json</script></html>','https://example.test/');assert(r.errors.some(e=>e.includes('JSON-LD')));
});
test('fragment targets and hreflang syntax are validated',()=>{
 assert(inspectDocument('navigation','<a href="#missing">Jump</a>','https://example.test/').errors.length);
 assert(inspectDocument('multilingual','<link rel="alternate" hreflang="???" href="/en">','https://example.test/').errors.length);
});
test('all future site registrations receive repeatable read-only automation without overwriting custom cases',()=>{
 const input={name:'Example',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:false}],checks:[]};const result=generateCases(input);
 assert(result.checks.filter(c=>c.kind==='standard-public').length>=7);assert.deepEqual(generateCases(result),result);
 const custom={id:'auto-metadata',kind:'human-review',suite:'seo',options:{instructions:'Custom'}};assert.deepEqual(generateCases({...input,checks:[custom]}).checks.find(c=>c.id===custom.id),custom);
});
test('standard integrations no longer reports insecure script URL',()=>{
 const r=inspectDocument('integrations','<html><script src="http://cdn.test/a.js"></script></html>','https://example.test/');assert.deepEqual(r.errors,[]);assert.match(r.actual.scope,/auto-security-active-mixed/);
});
