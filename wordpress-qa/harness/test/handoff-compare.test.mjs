import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareHandoff,buildCompareText,nextRecord} from '../lib/handoff-text.mjs';
import {redactor} from '../lib/evidence.mjs';
const mk=(rowId,raw,extra={})=>({key:rowId+'|'+raw,rawKey:raw,rowId,rowTitle:'行'+rowId,level:'fail',owner:'unknown',urls:['https://example.test/'+rowId],title:'課題'+rowId+raw,actual:'状況。',admin:'管理画面で直す。',code:'コードで直す。',verify:'確認する。',...extra});
const rec=(issues,excludedKeys=[])=>({handoffId:'h1',createdAt:'2026-11-01T00:00:00Z',actor:'',sourceRunId:'run-0',sourceFinishedAt:'2026-11-01T00:00:00Z',siteName:'S',issues,excludedKeys});
const rep=(rows)=>({runId:'run-1',baseURL:'https://example.test',finishedAt:'2026-11-01T16:30:00Z',rows});
const cmp=(prev,rows,issues,excl)=>compareHandoff({record:rec(prev,excl),report:rep(rows),issues});
test('resolved only when row confirmed',()=>{
  assert.deepEqual(cmp([mk('a','k')],[{id:'a',status:'pass'}],[]).resolved.map(i=>i.key),['a|k']);
  for(const row of [{id:'a',status:'blocked'},{id:'a',status:'fail',preparationRequired:true},{id:'a',status:'not_run'},{id:'a',status:'review'},{id:'a',status:'not_applicable'},null]){
    const c=cmp([mk('a','k')],row?[row]:[],[]);assert.deepEqual(c.unverified.map(i=>i.key),['a|k'],JSON.stringify(row));assert.equal(c.resolved.length,0);
  }
});
test('fail row without the key is resolved, with the key is unresolved',()=>{
  const c=cmp([mk('a','k'),mk('a','j')],[{id:'a',status:'fail'}],[mk('a','j')]);
  assert.deepEqual(c.resolved.map(i=>i.key),['a|k']);assert.deepEqual(c.unresolved.map(i=>i.key),['a|j']);assert.equal(c.added.length,0);
});
test('volatile key text still matches',()=>{
  const prev={...mk('a','x'),key:'a|error port <n>',rawKey:'error port 8080'},cur={...mk('a','x'),key:'a|error port <n>',rawKey:'error port 9090'};
  const c=cmp([prev],[{id:'a',status:'fail'}],[cur]);assert.equal(c.unresolved.length,1);assert.equal(c.added.length,0);
});
test('unclassified key resolves only on pass',()=>{
  const c=cmp([mk('a','unclassified:old')],[{id:'a',status:'fail'}],[mk('a','unclassified:new')]);
  assert.deepEqual(c.unresolved.map(i=>i.rawKey),['unclassified:new']);assert.equal(c.added.length,0);assert.equal(c.resolved.length,0);
  const t=cmp([mk('a','timeout:x')],[{id:'a',status:'fail'}],[]);assert.equal(t.unresolved.length,1);
  assert.equal(cmp([mk('a','unclassified:old')],[{id:'a',status:'pass'}],[]).resolved.length,1);
});
test('partial url fix stays unresolved with remaining urls',()=>{
  const u=n=>Array.from({length:n},(_,i)=>'https://example.test/p'+i);
  const c=cmp([mk('a','k',{urls:u(3)})],[{id:'a',status:'fail'}],[mk('a','k',{urls:u(1)})]);
  assert.equal(c.unresolved.length,1);assert.deepEqual(c.unresolved[0].urls,u(1));assert.equal(c.unresolved[0].fixedUrlCount,2);
  const {body}=buildCompareText({comparison:c,report:rep([])});assert.match(body,/前回から2件のURLが解消/);
});
test('previously excluded keys go to carriedExcluded, not added',()=>{
  const c=cmp([mk('a','k')],[{id:'a',status:'fail'},{id:'b',status:'fail'}],[mk('a','k'),mk('b','e'),mk('b','n')],['b|e']);
  assert.deepEqual(c.carriedExcluded.map(i=>i.key),['b|e']);assert.deepEqual(c.added.map(i=>i.key),['b|n']);
});
test('scope warning counts not_run and missing rows',()=>{
  const c=cmp([mk('a','k'),mk('b','k'),mk('c','k')],[{id:'a',status:'not_run'},{id:'c',status:'blocked'}],[]);
  assert.equal(c.scopeGap,2);assert.equal(c.unverified.length,3);
  const {body}=buildCompareText({comparison:c,report:rep([])}),lines=body.split('\n');
  assert.equal(lines[0],'【SITE EXAM 再診断結果（2026-11-02）】');assert.equal(lines[1],'前回と同じ検査範囲で再診断していないため、2件は確認できていません');
  assert.doesNotMatch(buildCompareText({comparison:cmp([mk('c','k')],[{id:'c',status:'blocked'}],[]),report:rep([])}).body,/検査範囲/);
});
test('compare text lists titles and urls, details only for added, closing at end',()=>{
  const c=cmp([mk('a','k'),mk('b','k'),mk('c','k')],[{id:'a',status:'pass'},{id:'b',status:'fail'},{id:'c',status:'blocked'},{id:'d',status:'fail'}],[mk('b','k'),mk('d','n',{actual:'新しい状況。'})]);
  const {body,truncated}=buildCompareText({comparison:c,report:rep([])});
  for(const s of ['【解消（1件）】','【未解消（1件）】','【再確認できず（1件）】','【新たに発生（1件）】','課題ak','https://example.test/a','課題bk','課題ck','・状況：新しい状況。'])assert.ok(body.includes(s),s);
  assert.equal((body.match(/・状況：/g)??[]).length,1);assert.equal(truncated,false);assert.doesNotMatch(body,/^#|\*\*|^\s*[-*] /m);
  assert.ok(body.trimEnd().endsWith('タスクを完了にするかは担当者が判断してください。再確認できずの項目は、条件を整えて再診断が必要です。'));
});
test('long compare text stays within limit and keeps closing with real redactor',()=>{
  const big='長い説明。'.repeat(80),opt={actual:big,admin:big,code:big,verify:big};
  const added=Array.from({length:200},(_,i)=>mk('n'+i,'k',opt));
  const c=cmp([],added.map(i=>({id:i.rowId,status:'fail'})),added);
  const r=buildCompareText({comparison:c,report:rep([]),clean:redactor({},{})});
  assert.ok(r.body.length<=20000);assert.equal(r.truncated,true);assert.ok(r.body.trimEnd().endsWith('条件を整えて再診断が必要です。'));
});
test('unchecked added issues are left out of text and moved to excluded in next record',()=>{
  const c=cmp([],[{id:'a',status:'fail'}],[mk('a','x'),mk('a','y')]);
  const {body}=buildCompareText({comparison:c,report:rep([]),uncheckedAddedKeys:['a|y']});
  assert.ok(body.includes('課題ax'));assert.ok(!body.includes('課題ay'));assert.match(body,/新たに発生：1件/);
  const n=nextRecord({record:rec([]),comparison:c,uncheckedAddedKeys:['a|y'],report:rep([]),siteName:'S2',handoffId:'h2',actor:'u',now:'2026-11-02T00:00:00Z'});
  assert.deepEqual(n.issues.map(i=>i.key),['a|x']);assert.deepEqual(n.excludedKeys,['a|y']);
  assert.deepEqual({...n,issues:undefined,excludedKeys:undefined},{handoffId:'h2',createdAt:'2026-11-02T00:00:00.000Z',actor:'u',sourceRunId:'run-1',sourceFinishedAt:'2026-11-01T16:30:00Z',siteName:'S2',issues:undefined,excludedKeys:undefined});
});
test('nextRecord drops resolved',()=>{
  const c=cmp([mk('a','k'),mk('b','k'),mk('c','k')],[{id:'a',status:'pass'},{id:'b',status:'fail'},{id:'e',status:'fail'}],[mk('b','k',{urls:[]}),mk('e','x')],['e|x']);
  const n=nextRecord({record:rec([],['e|x','z|gone']),comparison:c,uncheckedAddedKeys:[],report:rep([]),siteName:'S',handoffId:'h2',now:'2026-11-02T00:00:00Z'});
  assert.deepEqual(n.issues.map(i=>i.key),['b|k','c|k']);assert.deepEqual(n.excludedKeys,['e|x']);assert.equal(n.actor,'');
  assert.ok(n.issues.every(i=>!('fixedUrlCount' in i)));
});
