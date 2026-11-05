import test from 'node:test';
import assert from 'node:assert/strict';
import {renderEditorReport,renderBasis} from '../lib/editor-report/render.mjs';

const site={name:'テスト病院',baseURL:'https://example.test',environment:'production'};
const groups=[
  {id:'g-admin',rule:'plugin-vulnerability',rowIds:['check.security-plugin'],status:'fail',category:'admin',facts:{},probes:[],verification:{result:'site-side',notes:['確認しました']}},
  {id:'g-tech',rule:'security-headers',rowIds:['check.auto-security-headers'],status:'caution',category:'tech',facts:{},probes:[]},
  {id:'g-ns',rule:'link-transient',rowIds:['links.a','links.b','links.c'],status:'fail',category:'not-site',facts:{},basis:{reasons:['expect(received).toBe Received: 503']},probes:[],verification:{result:'tool-side',notes:[]}},
  {id:'g-un',rule:'unverified',rowIds:['page.x','page.y'],status:'unverified',category:'unverified',facts:{},probes:[]},
  {id:'g-na',rule:'not-applicable',rowIds:['admin.z'],status:'not-applicable',category:'not-applicable',facts:{},probes:[]}
];
const item=(groupId,extra={})=>({groupId,title:'プラグインを更新します',summary:'古い版を使っています。',impact:'攻撃されるおそれがあります。',steps:['管理画面を開く','更新する'],location:'プラグイン',urgency:'high',note:'',...extra});
const base={site,runId:'run-1',startedAt:'2026-11-04T07:00:00Z',checkedAt:'2026-11-04T08:00:00Z',counts:{fail:4,caution:1,unverified:2,notApplicable:1},groups,items:[item('g-admin'),item('g-tech',{title:'設定を入れます',urgency:'low'}),item('g-ns',{title:'ツール側の原因',urgency:'normal'})]};
const HEADINGS=['ひとことで言うと','分類ごとの件数','編集者の方にお願いしたいこと','管理者の権限が必要なこと','技術担当・サーバー担当に頼むこと','サイトの問題ではないもの（対応不要）','まだ確かめられていないこと','このサイトには関係しないもの','このあとの進め方','作成の根拠'];

test('renders sections in order',()=>{
  const html=renderEditorReport(base);
  assert.match(html,/<h1>テスト病院/);
  let at=-1;
  for(const h of HEADINGS){const i=html.indexOf(h,at+1);assert.ok(i>at,`missing or out of order: ${h}`);at=i;}
  assert.match(html,/早めに対応/);assert.match(html,/急がない/);
  assert.doesNotMatch(html,/<script/i);
});

test('counts table matches counts',()=>{
  const html=renderEditorReport(base);
  const row=name=>html.match(new RegExp(`<span class="tag [^"]*">${name}</span></td><td class="num">([\\s\\S]*?)</td>`))[1];
  assert.equal(row('管理者'),'1件（1項目）');
  assert.equal(row('技術担当'),'1件（1項目）');
  assert.equal(row('サイトの問題ではない'),'3件');
  assert.equal(row('未確認'),'2件');
  assert.match(row('対象外'),/管理画面の設定確認：1件/);
  assert.match(html,/3件/);
  const c=base.counts;
  assert.equal(1+1+3,c.fail+c.caution);assert.equal(2,c.unverified);assert.equal(1,c.notApplicable);
});

test('escapes site strings',()=>{
  const evil='<img src=x onerror=alert(1)>';
  const html=renderEditorReport({...base,site:{...site,name:evil},items:[item('g-admin',{title:evil,steps:[evil]})]});
  assert.doesNotMatch(html,/<script/i);assert.doesNotMatch(html,/<[a-z]+[^>]*onerror=/i);assert.doesNotMatch(html,/<img/);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('basis lists original reasons and recheck log',()=>{
  const recheckLog=[{at:'2026-11-04T08:00:01Z',method:'GET',url:'https://example.test/a/',status:200,rule:'link-transient'}];
  const extra={recheckLog,lintResults:[{groupId:'g-ns',problem:'term',detail:'HSTS'}],aiCalls:2};
  const basis=renderBasis({...base,...extra}),editor=renderEditorReport({...base,...extra});
  assert.match(basis,/expect\(received\)\.toBe Received: 503/);
  assert.match(basis,/https:\/\/example\.test\/a\//);assert.match(basis,/200/);
  assert.match(basis,/呼び出し回数：2/);assert.match(basis,/確認しました/);
  assert.doesNotMatch(basis,/<script/i);
  assert.doesNotMatch(editor,/expect\(|https:\/\/example\.test\/a\/|check\.|links\.|page\./);
  assert.doesNotMatch(editor.replace(/<style>[\s\S]*?<\/style>/,''),/[{}]/);
});

test('empty run says nothing to do',()=>{
  const html=renderEditorReport({...base,counts:{fail:0,caution:0,unverified:0,notApplicable:0},groups:[],items:[]});
  assert.match(html,/対応が必要なことはありません/);
  assert.doesNotMatch(renderBasis({...base,groups:[],recheckLog:[],lintResults:[],aiCalls:0}),/<script/i);
});

test('a run with nothing for the site to fix says so instead of counting zero',()=>{
  const only=groups.filter(g=>['not-site','unverified','not-applicable'].includes(g.category));
  const html=renderEditorReport({...base,groups:only,items:[item('g-ns')]});
  assert.match(html,/<p>サイトで直すことはありません。<\/p>/);
  assert.doesNotMatch(html,/0つ/);
  assert.match(html,/診断ツール側が原因で不合格になったものが<strong>3件<\/strong>/);
  assert.match(html,/まだ確かめられていないものが<strong>2件<\/strong>/);
  const waitOnly=renderEditorReport({...base,groups:groups.filter(g=>g.category==='unverified'),items:[]});
  assert.match(waitOnly,/サイトで直すことはありません。/);assert.doesNotMatch(waitOnly,/0つ|0件<\/strong>あります/);
});

test('the environment is shown in Japanese',()=>{
  for(const [environment,name] of [['production','本番環境'],['staging','検証環境'],['local','ローカル環境']]){
    const html=renderEditorReport({...base,site:{...site,environment}});
    assert.match(html,new RegExp(`環境：${name}<br>`));assert.doesNotMatch(html,new RegExp(`環境：${environment}`));
  }
});
