import test from 'node:test';
import assert from 'node:assert/strict';
import {groupRows,CATEGORIES} from '../lib/editor-report/causes.mjs';

const row=(id,status,reason,extra={})=>({id,status,reason,...extra});
const idx='\x1b[31mindexable differs from expectation (false)\x1b[39m';
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
    {title:'a',asset:{slug:'user-role-editor',name:'User Role Editor',version:'4.52.1'},cves:['CVE-2026-1'],range:{max_version:'4.64.4',max_operator:'lt',unfixed:'0',closed:'0'}},
    {title:'b',asset:{slug:'whats-new-generator',name:"What's New Generator",version:'2.0.2'},cves:['CVE-2026-2'],range:{max_version:'2.0.2',max_operator:'le',unfixed:'1',closed:'1'}}]}}));
  rows.push(row('mystery.thing','fail','something odd'));
  rows.push(row('check.auto-security-headers','fail','missing-hsts missing-csp',{level:'caution'}));
  rows.push(row('check.security-compatibility','fail','php old',{level:'caution'}));
  for(let i=0;i<2;i++) rows.push(row(`check.u${i}`,['not_run','blocked','review'][i],'x'));
  rows.push(row('check.v','not_run','x',{preparationRequired:true}));
  rows.push(row('check.na1','not_applicable','n/a'),row('check.na2','not_applicable','n/a'));
  rows.push(row('check.ok','pass',''));
  return {rows};
}
const config={pages:[...Array(6)].map((_,i)=>({id:`p${i}`,path:`/p${i}/`})).concat([{id:'home',path:'/'},{id:'about',path:'/about/'},{id:'x',path:'/x/'}]),
  visuals:['home-1280','home-390','about-1280','about-390'].map(id=>({id,pageId:id.split('-')[0]})).concat([{id:'home',pageId:'home'},{id:'about',pageId:'about'}])};
const flat=g=>g.flatMap(x=>x.rowIds);

test('groups the komoro-shaped run',()=>{
  const {groups}=groupRows(komoro(),{environment:'production',config});
  const idxG=groups.filter(g=>g.rule==='index-expectation'),rt=groups.filter(g=>g.rule==='render-timeout');
  assert.equal(idxG.length,1);assert.equal(idxG[0].rowIds.length,7);assert.equal(idxG[0].facts.environment,'production');
  assert.equal(rt.length,1);assert.equal(rt[0].rowIds.length,8);assert.ok(rt[0].probes.length<=3);
  for(const r of ['link-transient','sitemap-format','soft-404','security-headers','compatibility']) assert.equal(groups.filter(g=>g.rule===r).length,1,r);
  assert.equal(groups.find(g=>g.rule==='security-headers').status,'caution');
  const p=groups.find(g=>g.rule==='plugin-vulnerability');
  assert.deepEqual(p.facts.plugins,[{name:'User Role Editor',version:'4.52.1',cves:['CVE-2026-1'],fixedIn:'4.64.4',unfixed:false,closed:false},{name:"What's New Generator",version:'2.0.2',cves:['CVE-2026-2'],fixedIn:null,unfixed:true,closed:true}]);
  assert.deepEqual(idxG[0].probes,[0,1,2].map(i=>({kind:'page',path:`/p${i}/`})));
  assert.deepEqual(rt[0].probes,[{kind:'images',path:'/'},{kind:'images',path:'/about/'}]);
  assert.deepEqual(groups.find(g=>g.rule==='link-transient').probes,[{kind:'page',path:'/x/'}]);
  assert.ok(groups.every(g=>CATEGORIES.includes(g.category)));
});

test('counts match the original rows',()=>{
  const report=komoro();
  const {groups,counts}=groupRows(report,{environment:'production',config});
  assert.deepEqual(counts,{fail:20,caution:2,unverified:3,notApplicable:2});
  const ids=flat(groups);
  assert.equal(ids.length,new Set(ids).size);
  assert.equal(ids.length,report.rows.filter(r=>r.status!=='pass').length);
  const byStatus=s=>groups.filter(g=>g.status===s).reduce((n,g)=>n+g.rowIds.length,0);
  assert.equal(byStatus('fail'),counts.fail);
});

test('unknown failures are kept',()=>{
  const {groups}=groupRows(komoro(),{});
  const u=groups.find(g=>g.rule==='unclassified');
  assert.deepEqual(u.rowIds,['mystery.thing']);assert.equal(u.category,'tech');
  assert.deepEqual(u.facts,{reasonKinds:[{kind:'other',errorClass:'other'}]});
  assert.deepEqual(u.basis.reasons,['something odd']);
});

test('unclassified facts carry only the kind of reason, never its text',()=>{
  const rows=[row('page.a','fail',"expect(locator).toHaveText(expected) Received: 'お客様の氏名 山田'"),row('axe.b','fail','<div class="x">color-contrast</div>'),
    row('journey.c','fail','Timeout 5000ms exceeded'),row('links.d','fail','Expected: 200 Received: 404'),row('javascript.e','fail','pageerror: TypeError: x is undefined'),
    row('check.f','fail','locator.click: element(s) not found')];
  const u=groupRows({rows},{}).groups.find(g=>g.rule==='unclassified');
  assert.deepEqual(u.facts.reasonKinds,[{kind:'page',errorClass:'assertion'},{kind:'axe',errorClass:'accessibility'},{kind:'journey',errorClass:'timeout'},
    {kind:'links',errorClass:'status'},{kind:'javascript',errorClass:'javascript'},{kind:'check',errorClass:'missing-element'}]);
  assert.doesNotMatch(JSON.stringify(u.facts),/山田|Received|color-contrast|<div/);
  assert.equal(u.basis.reasons[0],"expect(locator).toHaveText(expected) Received: 'お客様の氏名 山田'");
});

test('link probes use failed links from evidence when present',()=>{
  const r=row('links.x','fail','Expected: 200 Received: 503',{evidence:['links.json']});
  const readEvidence=f=>f==='links.json'?[{url:'https://e.test/a',status:200},{url:'https://e.test/b',status:503}]:null;
  const {groups}=groupRows({rows:[r]},{config,readEvidence});
  assert.deepEqual(groups[0].probes,[{kind:'link',url:'https://e.test/b'}]);
});
