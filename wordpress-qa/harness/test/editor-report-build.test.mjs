import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEditorReport} from '../lib/editor-report/index.mjs';

const BASE='https://komoro.example';
const row=(id,status,reason,extra={})=>({id,status,reason,...extra});
const idx='indexable differs from expectation (false)';
const timeout='Timeout 15000ms exceeded while waiting on the predicate';
function komoro(){
  const rows=[];
  for(let i=0;i<6;i++) rows.push(row(`page.p${i}`,'fail',idx));
  rows.push(row('admin.indexing','fail',idx));
  for(const p of ['layout.home-1280','layout.home-390','layout.about-1280','layout.about-390','javascript.home','snapshot.home','axe.home','axe.about']) rows.push(row(p,'fail',timeout));
  rows.push(row('links.x','fail','Expected: 200 Received: 503'));
  rows.push(row('sitemap.main','fail','malformed sitemap XML'));
  rows.push(row('check.auto-security-404','fail','unknown URL must return 404'));
  rows.push(row('check.security-plugin','fail','vulnerable',{softwareSecurity:{component:'plugin',unknown:[],findings:[
    {title:'a',asset:{slug:'user-role-editor',name:'User Role Editor',version:'4.52.1'},cves:['CVE-2026-1'],range:{max_version:'4.64.4',max_operator:'lt',unfixed:'0',closed:'0'}}]}}));
  rows.push(row('mystery.thing','fail','something odd'));
  rows.push(row('check.auto-security-headers','fail','missing-hsts missing-csp',{level:'caution'}));
  rows.push(row('check.security-compatibility','fail','php old',{level:'caution'}));
  for(let i=0;i<2;i++) rows.push(row(`check.u${i}`,['not_run','blocked'][i],'x'));
  rows.push(row('check.v','not_run','x',{preparationRequired:true}));
  rows.push(row('check.na1','not_applicable','n/a'),row('check.na2','not_applicable','n/a'));
  rows.push(row('check.ok','pass',''));
  return {runId:'run-1',startedAt:'2026-11-05T00:00:00Z',name:'小諸',rows};
}
const config={pages:[...Array(6)].map((_,i)=>({id:`p${i}`,path:`/p${i}/`})).concat([{id:'home',path:'/'},{id:'about',path:'/about/'},{id:'x',path:'/x/'}]),
  visuals:['home-1280','home-390','about-1280','about-390'].map(id=>({id,pageId:id.split('-')[0]})).concat([{id:'home',pageId:'home'},{id:'about',pageId:'about'}])};
const site={name:'小諸',baseURL:BASE,environment:'production'};
const html=body=>({status:200,location:null,headers:{},text:`<!doctype html><html><head></head><body>${body}</body></html>`});
const images='<img src="https://s.w.org/images/core/emoji/15/72x72/1f600.png"><img src="https://hero-test.example/a.jpg">';
const sitemap='<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://komoro.example/</loc></url></urlset>';
const komoroClient={
  get:async url=>{
    if(url.startsWith(`${BASE}/wpqa-missing-`)) return {status:302,location:`${BASE}/`,headers:{location:`${BASE}/`},text:''};
    if(url===`${BASE}/sitemap.xml`) return {status:200,location:null,headers:{},text:sitemap};
    return html(url===`${BASE}/`||url===`${BASE}/about/`?images:'<p>x</p>');
  },
  head:async()=>({status:200})
};
const base={report:komoro(),readEvidence:()=>null,config,site,environment:'production',allowedOrigins:[BASE],now:()=>'2026-11-05T01:00:00.000Z'};

const item=(groupId,n,extra={})=>({groupId,title:`${n+1}番目の対応`,summary:`${n+1}番目の項目の状況をまとめました。`,impact:`${n+1}番目の項目を放置すると困ることがあります。`,steps:[`${n+1}番目の手順を行います`],location:'',urgency:'normal',note:'',...extra});
// Fake AI: one distinct, lint-clean item per group (or a script); records calls.
function fakeAi(script){
  const ai={calls:[],async writeEditorItems(groups,opts={}){
    ai.calls.push({ids:groups.map(g=>g.id),problems:opts.problems??[]});
    return script?script(groups,opts,ai.calls.length):groups.map((g,i)=>item(g.id,i));
  }};
  return ai;
}
// Category, rows and group count taken from the basis page cards.
const cards=basis=>[...basis.matchAll(/<h3>([^<]*)<\/h3>\s*<p>規則：<code>[^<]*<\/code>／状態：[^／]*／分類：([^／]*)／(\d+)件/g)].map(m=>({id:m[1],category:m[2],rows:Number(m[3])}));
const tally=(basis,c)=>({groups:cards(basis).filter(x=>x.category===c).length,rows:cards(basis).filter(x=>x.category===c).reduce((n,x)=>n+x.rows,0)});

test('komoro-shaped run is classified like the sample',async()=>{
  const ai=fakeAi(),stages=[];
  const r=await buildEditorReport({...base,client:komoroClient,ai,onStage:s=>stages.push(s)});
  assert.deepEqual(stages,['facts','recheck','writing','checking','rendering']);
  assert.deepEqual(r.counts,{fail:20,caution:2,unverified:3,notApplicable:2});
  assert.equal(r.aiCalls,1);assert.equal(ai.calls[0].ids.length,10);
  assert.deepEqual(tally(r.basisHtml,'editor'),{groups:1,rows:0});
  assert.deepEqual(tally(r.basisHtml,'admin'),{groups:2,rows:2});
  assert.deepEqual(tally(r.basisHtml,'tech'),{groups:3,rows:3});
  assert.deepEqual(tally(r.basisHtml,'not-site'),{groups:4,rows:17});
  assert.deepEqual(tally(r.basisHtml,'unverified'),{groups:3,rows:3});
  assert.deepEqual(tally(r.basisHtml,'not-applicable'),{groups:2,rows:2});
  const fixRows=['editor','admin','tech','not-site'].reduce((n,c)=>n+tally(r.basisHtml,c).rows,0);
  assert.equal(fixRows,r.counts.fail+r.counts.caution);
  assert.match(r.basisHtml,/foreign-image/);
  assert.doesNotMatch(r.html+r.basisHtml,/<script/i);
});

test('rewrites once then succeeds',async()=>{
  const ai=fakeAi((groups,opts,n)=>groups.map((g,i)=>n===1&&i===0?item(g.id,i,{summary:'expect(received) が失敗しました。'}):item(g.id,i+(n===1?0:50))));
  const r=await buildEditorReport({...base,client:komoroClient,ai});
  assert.equal(ai.calls.length,2);assert.equal(r.aiCalls,2);
  assert.equal(ai.calls[1].ids.length,1);assert.equal(ai.calls[1].problems[0].problem,'code');
  assert.doesNotMatch(r.html,/expect\(/);
});

test('fails after one rewrite',async()=>{
  const ai=fakeAi(groups=>groups.map((g,i)=>item(g.id,i,{summary:'expect(received) が失敗しました。'})));
  await assert.rejects(buildEditorReport({...base,client:komoroClient,ai}),e=>/^文章の確認に通りませんでした：/.test(e.message)&&/読みにくい書き方（\d+番目の対応）/.test(e.message));
  assert.equal(ai.calls.length,2);
});

test('no findings means no Claude call',async()=>{
  const ai=fakeAi();
  const r=await buildEditorReport({...base,report:{runId:'r',startedAt:'t',name:'x',rows:[row('check.ok','pass','')]},client:komoroClient,ai});
  assert.equal(ai.calls.length,0);assert.equal(r.aiCalls,0);
  assert.match(r.html,/対応が必要なことはありません/);
});

test('unreachable site still produces a report',async()=>{
  const down=()=>{throw new Error('ECONNREFUSED');};
  const r=await buildEditorReport({...base,client:{get:down,head:down},ai:fakeAi()});
  assert.match(r.html,/<h1>/);
  assert.ok(r.warnings.length>=1);
  assert.deepEqual(r.counts,{fail:20,caution:2,unverified:3,notApplicable:2});
  assert.equal(cards(r.basisHtml).filter(x=>x.category==='unverified').length>3,true);
  assert.equal(tally(r.basisHtml,'not-site').groups,0);
});

test('a site outside the allowed origins gives a short warning',async()=>{
  const r=await buildEditorReport({...base,allowedOrigins:[],client:komoroClient,ai:fakeAi()});
  assert.ok(r.warnings.includes('接続先の許可がないため再確認できませんでした'));
});

test('failed images in visual evidence reach the re-check',async()=>{
  const report=komoro();
  report.rows.find(r=>r.id==='layout.home-1280').evidence=['ready.json'];
  const readEvidence=f=>{if(f!=='ready.json') throw new Error('x');return {jsErrors:[],fontErrors:[],failedImages:[{url:'https://s.w.org/images/core/emoji/15/72x72/1f600.png',host:'s.w.org',reason:'timeout'}]};};
  // the page itself is unreadable, so the verdict can only come from the evidence
  const client={...komoroClient,get:async url=>url===`${BASE}/`?{status:500,location:null,headers:{},text:''}:komoroClient.get(url)};
  const r=await buildEditorReport({...base,report,readEvidence,client,ai:fakeAi()});
  assert.match(r.basisHtml,/接続先の許可にない読み込み元の画像：s\.w\.org/);
  const bad=await buildEditorReport({...base,report,readEvidence:()=>{throw new Error('x');},client,ai:fakeAi()});
  assert.ok(bad.warnings.length>=1);
});

test('a stray AI item is dropped without a rewrite',async()=>{
  const ai=fakeAi(groups=>[...groups.map((g,i)=>item(g.id,i)),item('not-a-group',99)]);
  const r=await buildEditorReport({...base,client:komoroClient,ai});
  assert.equal(r.aiCalls,1);assert.equal(ai.calls.length,1);
});

test('a missing item is named in Japanese in the error',async()=>{
  const ai=fakeAi(groups=>groups.slice(1).map((g,i)=>item(g.id,i)));
  await assert.rejects(buildEditorReport({...base,client:komoroClient,ai}),e=>/項目の不足（[^）]*[ぁ-ん][^）]*）/.test(e.message)&&!/[A-Za-z]+:fail/.test(e.message));
});
