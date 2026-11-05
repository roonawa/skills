import test from 'node:test';
import assert from 'node:assert/strict';
import {lintItems,TERMS} from '../lib/editor-report/lint.mjs';

const groups=[{id:'g1',facts:{url:'https://komoro.example/about/',php:'8.2.1',list:['CVE-2024-0001']},verification:{result:'site',notes:['ホストは komoro.example です']}},{id:'g2',facts:{}}];
const item=(groupId,extra={})=>({groupId,title:'ページが開きません',summary:'お知らせのページが表示されません。',impact:'読者が情報を読めません。',steps:['ページを開きます。'],location:'お知らせ',urgency:'normal',note:'',...extra});
const ok=()=>[item('g1'),item('g2',{title:'画像が重いです',summary:'画像の表示が遅くなっています。',impact:'読み込みを待たされます。',steps:['画像を小さくします。'],location:'トップ'})];
const probs=(items,kind)=>lintItems(items,{groups}).filter(p=>!kind||p.problem===kind);

test('clean report has no problems',()=>assert.deepEqual(lintItems(ok(),{groups}),[]));
test('TERMS lists the initial terms',()=>assert.deepEqual(TERMS,['HSTS','CSP','CVE','REST','XML-RPC','CDATA','CSRF','XSS','egress','noindex','canonical','JavaScript','HTTP']));

test('rejects code and internal ids',()=>{
  const a=ok();a[0].summary='expect(received) の失敗です。page.home が原因です。';
  const p=probs(a,'code');
  assert.ok(p.length>=2&&p.every(x=>x.groupId==='g1'));
  for(const s of ['Error: x','AssertionError','Timeout 30000ms','{a}','\x1b[0m','  at foo (x.js:1)','check.links.x','axe.color']){
    const b=ok();b[1].impact=s;assert.ok(probs(b,'code').some(x=>x.groupId==='g2'),s);
  }
});

test('rejects duplicated sentences across items',()=>{
  const a=ok();a[1].summary='お知らせの ページが、表示されません。';
  const p=probs(a,'duplicate');
  assert.equal(p.length,1);assert.equal(p[0].groupId,'g2');
});

test('requires term explanations at first occurrence only',()=>{
  const a=ok();a[0].summary='HSTS が未設定です。';
  assert.equal(probs(a,'term')[0].groupId,'g1');
  a[0].summary='HSTS（常に暗号化で接続させる設定）が未設定です。';a[1].note='HSTS は後で触れます。';
  assert.deepEqual(probs(a,'term'),[]);
  const b=ok();b[0].note='HTTPS は暗号化です。REST（外部から読む仕組み）です。';
  assert.deepEqual(probs(b,'term'),[]);
});

test('rejects facts not given',()=>{
  const a=ok();a[0].impact='CVE-2020-1234 の脆弱性があります。';
  assert.equal(probs(a,'unknown-fact')[0].groupId,'g1');
  for(const s of ['https://other.example/x','PHP 7.4 を使っています','evil.example に接続します']){
    const b=ok();b[0].impact=s;assert.equal(probs(b,'unknown-fact').length,1,s);
  }
});

test('accepts facts that were given and ordinary numbers',()=>{
  const a=ok();a[0].impact='https://komoro.example/about/ は PHP 8.2.1 で、CVE-2024-0001 と komoro.example が関係します。3倍遅く、1,200件、wp-login.php と robots.txt は別です。';
  assert.deepEqual(probs(a),[]);
});

test('every group needs exactly one item',()=>{
  assert.deepEqual(probs([item('g1')]).map(p=>[p.groupId,p.problem]),[['g2','missing']]);
  const a=[...ok(),item('g1',{title:'別',summary:'別の説明をここに書きます。',impact:'別の影響がでます。',steps:['別の手順をします。'],location:'別'}),item('gX')];
  assert.deepEqual(probs(a,'extra').map(x=>x.groupId).sort(),['g1','gX']);
});
