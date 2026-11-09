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

test('internal ids are never allowed even if facts carry them, except pool domain names',()=>{
  const gs=[{id:'g1',facts:{row:'check.links-x',host:'admin.example.co.jp',id:'page.home'}}];
  const lint=impact=>lintItems([item('g1',{impact})],{groups:gs}).filter(p=>p.problem==='code');
  assert.equal(lint('check.links-x が原因です。').length,1);
  assert.deepEqual(lint('admin.example.co.jp に接続します。'),[]);
  assert.equal(lint('page.home を見てください。').length,1);
  assert.equal(lint('admin.other.co.jp に接続します。').length,1);
});

test('repeated sentences are dropped mechanically, keeping the first and every title',async()=>{
  const {dropRepeatedSentences,lintItems}=await import('../lib/editor-report/lint.mjs');
  const title='ソフトウェアのバージョン情報公開に関する検査が完了しませんでした';
  const items=[
    {groupId:'g1',title,summary:title+'。公開ページの情報を確認できませんでした。',impact:'放置すると困ることがあります。',steps:['管理画面を開きます。','管理画面を開きます。'],location:'',urgency:'normal',note:'この項目は再検査で確認できます。'},
    {groupId:'g2',title:'別の項目の題名です',summary:'別の項目の概要を書きました。',impact:'放置すると困ることがあります。',steps:['管理画面を開きます。'],location:'',urgency:'normal',note:'この項目は再検査で確認できます。'}];
  const {items:out,removed}=dropRepeatedSentences(items);
  assert.equal(out[0].title,title);assert.equal(out[0].summary,'公開ページの情報を確認できませんでした。');
  assert.deepEqual(out[0].steps,['管理画面を開きます。']);assert.equal(out[1].impact,'');assert.deepEqual(out[1].steps,[]);assert.equal(out[1].note,'');
  assert.equal(removed,5);
  assert.deepEqual(lintItems(out,{groups:[{id:'g1',facts:{}},{id:'g2',facts:{}}]}).filter(p=>p.problem==='duplicate'),[]);
  assert.equal(items[0].summary.startsWith(title),true);
});

test('sentences with facts not given are dropped, titles and given facts are kept',async()=>{
  const {dropUnknownFactSentences,lintItems}=await import('../lib/editor-report/lint.mjs');
  const groups=[{id:'g1',facts:{},verification:{notes:['https://example.test/news/ を確認しました']}}];
  const items=[{groupId:'g1',title:'セキュリティ用の設定を見直す',summary:'応答に必要な設定がありません。nginx.conf か Apache 2.4 の設定で追加します。',impact:'https://example.test/news/ で確認できます。',steps:['サーバー会社に設定を依頼します。','evil.example に問い合わせます。'],location:'',urgency:'normal',note:''}];
  const {items:out,removed}=dropUnknownFactSentences(items,groups);
  assert.equal(out[0].title,items[0].title);assert.equal(out[0].summary,'応答に必要な設定がありません。');
  assert.equal(out[0].impact,items[0].impact);assert.deepEqual(out[0].steps,['サーバー会社に設定を依頼します。']);
  assert.deepEqual(removed.map(r=>r.groupId),['g1','g1']);assert.ok(removed.some(r=>r.facts.includes('nginx.conf')));assert.ok(removed.some(r=>r.facts.includes('evil.example')));
  assert.deepEqual(lintItems(out,{groups}).filter(p=>p.problem==='unknown-fact'),[]);
});
