import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {Agent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {run} from '../lib/checks/security-baseline.mjs';
import {RULES} from '../lib/security-baseline-rules.mjs';
import {catalog,validateConfig} from '../lib/config.mjs';
import {addSecurityChecks} from '../ui/public/case-generator.js';
import {ProjectStore} from '../ui/project-store.mjs';
import {buildIssueReport} from '../lib/issue-report.mjs';
import {buildDesignerReport} from '../lib/designer-report.mjs';
import {latestResults} from '../lib/latest-results.mjs';
import {buildExam} from '../lib/site-exam.mjs';
import {preparationWidens} from '../ui/automatic-preparation.mjs';

const check=(area,required=true,extra={})=>({id:'auto-security-'+area,kind:'security-baseline',suite:'authz',required,options:{area,...extra}});
const page=(head='',body='')=>`<!doctype html><html><head><title>Home</title>${head}</head><body>${body}</body></html>`;
async function serve(t,handler,{tls}={}){
  const seen=[],server=(tls?https.createServer(tls,(q,r)=>{seen.push({url:q.url,headers:q.headers});handler(q,r);}):http.createServer((q,r)=>{seen.push({url:q.url,headers:q.headers});handler(q,r);}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  return {seen,origin:`${tls?'https':'http'}://127.0.0.1:${server.address().port}`};
}
const notFound=res=>{res.writeHead(404,{'Content-Type':'text/html'});res.end(page('','<p>not found</p>'));};
async function go(c,config,extra={}){let error,evidence;try{await run({check:c,config,attach:async(n,d)=>{evidence=d;},...extra});}catch(e){error=e;}return {error,evidence};}

// R8: a finding fails the check regardless of required; required only changes display and the gate.
test('required headers check fails on caution findings',async t=>{
  const s=await serve(t,(q,res)=>{if(q.url!=='/')return notFound(res);res.writeHead(200,{'Content-Type':'text/html'});res.end(page());});
  const {error,evidence}=await go(check('headers',true),{baseURL:s.origin+'/',timeoutMs:1500});
  assert.equal(error?.name,'AssertionError');assert.match(error.message,/missing-csp/);assert(evidence.findings.every(f=>f.level==='caution'));
});
test('required disclosure check fails on caution findings',async t=>{
  const s=await serve(t,(q,res)=>{if(q.url!=='/')return notFound(res);res.writeHead(200,{'Content-Type':'text/html'});res.end(page('<meta name="generator" content="WordPress 6.4.2">'));});
  const {error}=await go(check('disclosure',true),{baseURL:s.origin+'/',timeoutMs:1500});
  assert.equal(error?.name,'AssertionError');assert.match(error.message,/wp-version-exposed/);
});
const key=`-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg/byRr8TORKTVaCRl
NxGSaYZM6xbq1tqEzjRs/4SlxYuhRANCAARngO3iphNjfnhJFs/D5H2i1Eanm2JU
TImFr9HyElHMzbij7cbsu8Qv3oB10vwBM42YqSTNHzpGTggto+1KbOtB
-----END PRIVATE KEY-----`;
const cert=`-----BEGIN CERTIFICATE-----
MIIBmzCCAUGgAwIBAgIUWHzQ5StO9TEBGIIjATova0oXDkQwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTEwMjAxMzkzN1oYDzIxMjYxMDA5
MDEzOTM3WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAARngO3iphNjfnhJFs/D5H2i1Eanm2JUTImFr9HyElHMzbij7cbsu8Qv
3oB10vwBM42YqSTNHzpGTggto+1KbOtBo28wbTAdBgNVHQ4EFgQUlofNEBUbGdy0
azuEotQIBTR29AgwHwYDVR0jBBgwFoAUlofNEBUbGdy0azuEotQIBTR29AgwDwYD
VR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwCgYIKoZI
zj0EAwIDSAAwRQIgSNGAZInYi2WQQJ67GeCNFZVnoIiNw7Stj2E+Rrai5VACIQDe
jNdMp7z/lpRQUcOI3sygYj8ASBmLEYJE5lsdvBWsbQ==
-----END CERTIFICATE-----`;
test('required mixed check fails on an https page with active mixed content',async t=>{
  const old=getGlobalDispatcher();setGlobalDispatcher(new Agent({connect:{ca:cert}}));t.after(()=>setGlobalDispatcher(old));
  const s=await serve(t,(q,res)=>{if(q.url!=='/')return notFound(res);res.writeHead(200,{'Content-Type':'text/html'});res.end(page('<script src="http://cdn.test/a.js"></script>','<img src="http://cdn.test/a.png">'));},{tls:{key,cert}});
  for(const required of [true,false]){const {error,evidence}=await go(check('mixed',required),{baseURL:s.origin+'/',timeoutMs:1500});
    assert.equal(error?.name,'AssertionError',String(required));assert.equal(error.message,'active-mixed-content');assert.deepEqual(evidence.findings.map(f=>f.path),['/']);}
});

// A BLOCKED raised after a finding must not hide the finding.
test('401 on a later exposure path keeps the earlier finding and records the rest as unchecked',async t=>{
  const s=await serve(t,(q,res)=>{
    if(q.url==='/.git/HEAD'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('ref: refs/heads/main\n');}
    if(q.url==='/wp-content/debug.log'){res.writeHead(401,{'www-authenticate':'Basic'});return res.end();}
    notFound(res);});
  const {error,evidence}=await go(check('exposure'),{baseURL:s.origin+'/',timeoutMs:1500,allowSensitivePaths:true});
  assert.equal(error?.name,'AssertionError');assert.equal(error.message,'git-head');
  assert.deepEqual(evidence.findings.map(f=>f.rule),['git-head']);assert(evidence.unchecked.includes('/wp-content/debug.log'));assert(evidence.unchecked.includes('/wp-content/uploads/'));
  assert(!s.seen.some(x=>x.url==='/wp-content/uploads/'),'stops requesting after the gate');
});
test('login redirect or gate page on a later page keeps earlier disclosure findings',async t=>{
  const s=await serve(t,(q,res)=>{
    if(q.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(page('<meta name="generator" content="WordPress 6.4.2">'));}
    if(q.url==='/readme.html'){res.writeHead(302,{Location:'/wp-login.php?redirect_to=x'});return res.end();}
    notFound(res);});
  const {error,evidence}=await go(check('disclosure',false),{baseURL:s.origin+'/',timeoutMs:1500});
  assert.equal(error?.name,'AssertionError');assert.match(error.message,/wp-version-exposed/);assert(evidence.unchecked.includes('/readme.html'));
  const g=await serve(t,(q,res)=>{
    if(q.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(page());}
    res.writeHead(404,{'Content-Type':'text/html'});res.end(page('','<form id="loginform"></form>'));});
  const x=await go(check('headers',true,{paths:['/','/members/']}),{baseURL:g.origin+'/',timeoutMs:1500});
  assert.equal(x.error?.name,'AssertionError');assert(x.evidence.unchecked.includes('/members/'));
});
test('without findings the gate reason is still reported as BLOCKED',async t=>{
  const s=await serve(t,(q,res)=>{res.writeHead(401,{'www-authenticate':'Basic'});res.end();});
  const {error,evidence}=await go(check('headers',false),{baseURL:s.origin+'/',timeoutMs:1500});
  assert.match(error?.message??'',/^BLOCKED: 閲覧に認証が必要です/);assert.deepEqual(evidence.unchecked,['/']);
});

// HTTPS-only frontends return 4xx on http:// without serving content.
const sound=async()=>({validTo:new Date(Date.now()+90*864e5),authorized:true});
async function transport(t,handler){
  const s=await serve(t,handler);
  return {s,...await go(check('transport'),{baseURL:'https://127.0.0.1/',timeoutMs:1500,environment:'production'},{httpOrigin:s.origin,tlsInspector:sound})};
}
test('transport: 4xx on http is not served, 200 and http redirects are findings',async t=>{
  for(const status of [403,404,400]){const x=await transport(t,(q,res)=>{res.writeHead(status,{'Content-Type':'text/html'});res.end('denied');});
    assert.equal(x.error,undefined,String(status));assert.deepEqual(x.evidence.findings,[]);assert.match(x.evidence.observations.join('\n'),new RegExp(`HTTP ${status}`));}
  let x=await transport(t,(q,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(page());});assert.match(x.error?.message??'',/^https-not-enforced$/);
  x=await transport(t,(q,res)=>{res.writeHead(301,{Location:'http://127.0.0.1/x'});res.end();});assert.match(x.error?.message??'',/^https-not-enforced$/);
  x=await transport(t,(q,res)=>{res.writeHead(401,{'www-authenticate':'Basic'});res.end();});assert.match(x.error?.message??'',/^BLOCKED: 閲覧に認証が必要です/);
});

// 「共通自動検査（送信なし）」 includes the five auto-security rows.
test('standard scope selects the auto-security rows',()=>{
  const base={name:'s',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:true,lang:'ja',links:true}],checks:[{id:'pub',title:'p',suite:'seo',kind:'standard-public',options:{area:'metadata',paths:['/']}}]};
  const rows=catalog(validateConfig(addSecurityChecks({...base,allowSensitivePaths:true})),'standard'),sec=rows.filter(r=>r.kind==='security-baseline');
  assert.equal(sec.length,5);assert(sec.every(r=>r.selected),JSON.stringify(sec.map(r=>[r.id,r.selected])));assert(rows.find(r=>r.id==='check.pub').selected);
  assert(rows.filter(r=>!r.kind).every(r=>!r.selected));
  const off=catalog(validateConfig(addSecurityChecks({...base,allowSensitivePaths:false})),'standard').find(r=>r.id==='check.auto-security-exposure');assert.equal(off.selected,false);assert.equal(off.preparationRequired,true);
});

// Production requires an explicit permission even without an operation profile.
test('profile-less saves moving to production drop allowSensitivePaths unless explicitly set',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-sp2-'));
  try{
    const store=new ProjectStore(dir,{codec:v=>v}),flag=id=>store.view(id).config.allowSensitivePaths;
    const base={name:'s',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:true,lang:'ja',links:true}],policies:[],journeys:[],visuals:[],manual:[],admin:[],checks:[],allowSensitivePaths:true};
    const id=store.save({config:base});assert.equal(flag(id),true);
    const rec=store.record(id);assert.equal(flag(store.save({id,version:rec.version,config:{...rec.config,environment:'production'}})),false,'edit to production');
    assert.equal(flag(store.save({config:{...base,name:'copy',environment:'production'}})),false,'copy saved as production');
    const id2=store.save({config:base}),r2=store.record(id2);
    assert.equal(flag(store.save({id:id2,version:r2.version,config:{...r2.config,environment:'production'},sensitivePaths:true})),true,'explicit opt-in');
    assert.equal(flag(store.save({id:id2,version:store.record(id2).version,config:store.record(id2).config})),true,'production to production keeps the stored value');
    assert.equal(flag(store.save({id:id2,version:store.record(id2).version,config:store.record(id2).config,sensitivePaths:false})),false,'explicit opt-out');
    assert.equal(flag(store.save({config:{...base,name:'new',environment:'production'},sensitivePaths:true})),true,'new production with explicit opt-in');
    assert.equal(flag(store.save({config:{...base,name:'stg',allowSensitivePaths:false},sensitivePaths:true})),true,'staging explicit opt-in');
    assert.throws(()=>store.save({config:base,sensitivePaths:'yes'}),/真偽値/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

// Reports explain baseline findings with RULES and count 注意 separately.
const sbRow={id:'check.auto-security-headers',title:'セキュリティヘッダー',required:false,level:'caution',status:'fail',reason:'AssertionError: missing-csp\nmissing-hsts',evidence:['check-x/security-baseline.json']};
const sbEvidence={schema:'security-baseline-v1',area:'headers',findings:[{rule:'missing-csp',level:'caution',path:'/',observation:'Content-Security-Policy ヘッダーがありません'},{rule:'missing-hsts',level:'caution',path:'/',observation:'HSTSなし'}],unchecked:[],requests:[]};
const report=rows=>({runId:'r',startedAt:'2026-01-01',finishedAt:'2026-01-01',runStatus:'finished',configHash:'h',baseURL:'https://example.test',environment:'production',name:'QA',rows});
test('issue report maps baseline findings through RULES and counts caution separately',()=>{
  const r=buildIssueReport({current:report([sbRow]),readEvidence:()=>sbEvidence});
  for(const rule of ['missing-csp','missing-hsts'])for(const k of ['title','impact','admin','code','verify'])assert(r.html.includes(RULES[rule][k]),rule+' '+k);
  assert(!r.html.includes('この検査の期待条件を満たしていません'));assert.equal(r.issueCount,2);
  assert.match(r.html,/不合格 0ケース・注意 1ケース → 修正候補 2項目/);assert.match(r.html,/注意：/);
  const plain=buildIssueReport({current:report([{...sbRow,required:true,level:undefined}]),readEvidence:()=>sbEvidence});assert.match(plain.html,/不合格 1ケース → 修正候補 2項目/);
});
test('designer report does not claim no issues when caution rows exist',()=>{
  const r=buildDesignerReport({current:report([sbRow]),readEvidence:()=>sbEvidence});
  assert(!r.html.includes('報告対象に不合格はありません'));assert.match(r.html,/注意 1ケース/);
});

test('latest results keep level and count caution separately',()=>{
  const r=latestResults([{id:'a',title:'A'},{id:'b',title:'B'}],'h',[{runId:'1',startedAt:'1',finishedAt:'1',runStatus:'finished',configHash:'h',rows:[{id:'a',status:'fail',level:'caution'},{id:'b',status:'fail'}]}]);
  assert.equal(r.rows[0].level,'caution');assert.equal(r.counts.caution,1);assert.equal(r.counts.fail,1);
});

test('customer exam warns about unresolved required auto-security rows',()=>{
  const e=buildExam({runId:'r',rows:[{id:'check.auto-security-exposure',title:'x',required:true,status:'blocked'},{id:'check.auto-security-transport',title:'t',required:true,status:'pass'},{...sbRow,failures:[{key:'baseline:missing-csp:/',title:'CSP',impact:'i',admin:'a'}]}]});
  assert.equal(e.unresolvedSecurity,1);assert.match(e.warning,/評価未完了/);assert.match(e.warning,/セキュリティ未解決・未確認 1項目/);
});

test('automatic preparation may not widen sensitivePaths',()=>{
  const record={config:{allowSensitivePaths:false},profile:{writes:false}};
  assert.equal(preparationWidens(record,{config:{allowSensitivePaths:false},profile:{writes:false}}),false);
  assert.equal(preparationWidens(record,{config:{allowSensitivePaths:false},profile:{writes:false,sensitivePaths:true}}),true);
  assert.equal(preparationWidens(record,{config:{allowSensitivePaths:true},profile:{writes:false}}),true);
  for(const k of ['writes','submit','bankOrder'])assert.equal(preparationWidens(record,{config:{},profile:{[k]:true}}),true,k);
  assert.equal(preparationWidens({config:{allowSensitivePaths:true},profile:{sensitivePaths:true}},{config:{allowSensitivePaths:true},profile:{sensitivePaths:true}}),false);
});

// An admin application password in headersEnv must not be sent to the REST user list unless the site demands Basic auth.
const users=JSON.stringify([{id:1,slug:'alice'},{id:2,slug:'bob'}]);
test('REST user probe omits Authorization unless the site challenges for Basic auth',async t=>{
  const name='SB_REVIEW_HEADERS',auth='Basic '+Buffer.from('admin:abcd efgh ijkl mnop qrst uvwx').toString('base64');process.env[name]=JSON.stringify({Authorization:auth});t.after(()=>delete process.env[name]);
  const s=await serve(t,(q,res)=>{
    if(q.url==='/wp-json/wp/v2/users'){if(q.headers.authorization){res.writeHead(200,{'Content-Type':'application/json'});return res.end(users);}res.writeHead(401,{'Content-Type':'application/json'});return res.end('{"code":"rest_user_cannot_view"}');}
    if(q.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(page());}notFound(res);});
  const {error,evidence}=await go(check('disclosure',false),{baseURL:s.origin+'/',timeoutMs:1500,headersEnv:name});
  assert.equal(error,undefined,error?.message);assert.deepEqual(evidence.findings,[]);
  const rest=s.seen.filter(x=>x.url==='/wp-json/wp/v2/users');assert.equal(rest.length,1);assert.equal(rest[0].headers.authorization,undefined);assert.equal(s.seen[0].headers.authorization,auth);
  const g=await serve(t,(q,res)=>{
    if(q.headers.authorization!==auth){res.writeHead(401,{'www-authenticate':'Basic realm="site"'});return res.end();}
    if(q.url==='/wp-json/wp/v2/users'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(users);}
    if(q.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(page());}notFound(res);});
  const x=await go(check('disclosure',false),{baseURL:g.origin+'/',timeoutMs:1500,headersEnv:name});
  assert.deepEqual(x.evidence.findings.map(f=>f.rule),['rest-user-enumeration']);
  assert.deepEqual(g.seen.filter(q=>q.url==='/wp-json/wp/v2/users').map(q=>q.headers.authorization),[undefined,auth]);
});

// R9: one resolution in ProjectStore.save; config.allowSensitivePaths and a stored profile.sensitivePaths never diverge.
test('sensitivePaths is resolved once and mirrored into the stored profile',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-sp3-'));
  try{
    const store=new ProjectStore(dir,{codec:v=>v}),prof={sitePath:'/',timezone:'Asia/Tokyo',language:'ja',indexable:true};
    const cfg=environment=>({name:'s',baseURL:'https://example.test',environment,pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:true,lang:'ja',links:true}],policies:[],journeys:[],visuals:[],manual:[],admin:[],checks:[]});
    const state=id=>{const r=store.record(id);return [r.config.allowSensitivePaths,r.profile?.sensitivePaths];};
    const again=(id,extra={},env)=>{const r=store.record(id);return store.save({id,version:r.version,config:{...r.config,...(env?{environment:env}:{})},...extra});};
    // (1) staging registration with the box checked
    const id=store.save({config:cfg('staging'),profile:{...prof,sensitivePaths:true}});assert.deepEqual(state(id),[true,true]);
    // (2) API move to production without a profile: config and stored profile both false
    again(id,{},'production');assert.deepEqual(state(id),[false,false],'no fields');
    const idB=store.save({config:cfg('staging'),profile:{...prof,sensitivePaths:true}});again(idB,{sensitivePaths:false},'production');assert.deepEqual(state(idB),[false,false],'top-level false');
    // (3) production to production with neither field stays false
    again(id);assert.deepEqual(state(id),[false,false]);
    // (5) automatic preparation / re-login style saves pass the stored profile: unchanged
    again(id,{profile:store.record(id).profile});assert.deepEqual(state(id),[false,false]);
    // explicit enable, then the stored profile keeps it on
    again(id,{sensitivePaths:true});assert.deepEqual(state(id),[true,true]);
    again(id,{profile:store.record(id).profile});assert.deepEqual(state(id),[true,true]);again(id);assert.deepEqual(state(id),[true,true]);
    // (4) top-level false without a profile wins over the stored profile
    again(id,{sensitivePaths:false});assert.deepEqual(state(id),[false,false]);
    // top-level value wins over a passed profile
    again(id,{profile:{...store.record(id).profile,sensitivePaths:true},sensitivePaths:false});assert.deepEqual(state(id),[false,false]);
    // (c) the config body value is never explicit
    const idC=store.save({config:{...cfg('production'),allowSensitivePaths:true}});assert.deepEqual(state(idC),[false,undefined]);
    const r=store.record(idC);store.save({id:idC,version:r.version,config:{...r.config,allowSensitivePaths:true}});assert.deepEqual(state(idC),[false,undefined]);
    const idS=store.save({config:{...cfg('staging'),allowSensitivePaths:false}});assert.deepEqual(state(idS),[true,undefined],'staging default, body ignored');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

// R9-5: 「新規サイトとして複製」 never pre-checks sensitive paths for a production source.
test('copying a production site starts with sensitive paths unchecked',async t=>{
  const {chromium}=await import('@playwright/test'),{readFile}=await import('node:fs/promises'),browser=await chromium.launch();t.after(()=>browser.close());
  const base={name:'Src',baseURL:'https://example.test',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:false}],policies:[],journeys:[],visuals:[],manual:[],admin:[],checks:[]};
  async function copy(c){
    const page=await browser.newPage();
    await page.route('http://copy.test/**',async route=>{const p=new URL(route.request().url()).pathname;return route.fulfill(p.endsWith('.js')?{contentType:'text/javascript',body:await readFile(new URL('../ui/public/'+p.slice(1),import.meta.url),'utf8')}:{contentType:'text/html',body:'<button id="new-site">New</button><button id="edit-site">Edit</button>'});});
    await page.goto('http://copy.test/');
    await page.evaluate(async c=>{const {initSettings}=await import('/settings.js');initSettings({currentProject:()=>'managed',onSaved:async()=>{},api:async url=>url==='/api/logins/current'?{login:null}:{config:c,managed:false,version:'v1',credentials:{}}});},c);
    await page.click('#edit-site');const box=page.locator('[data-key=sensitivePaths]');const before=await box.isChecked();await page.click('#editor-copy');return [before,await box.isChecked()];
  }
  assert.deepEqual(await copy({...base,environment:'production',allowSensitivePaths:true}),[true,false]);
  assert.deepEqual(await copy({...base,environment:'staging',allowSensitivePaths:false}),[false,true]);
});
