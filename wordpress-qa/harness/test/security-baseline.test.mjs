import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {request} from '@playwright/test';
import {validate, validateRuntime, run} from '../lib/checks/security-baseline.mjs';
import {RULES} from '../lib/security-baseline-rules.mjs';
import {preparationReason, validateChecks} from '../lib/checks/index.mjs';

const check=(area='exposure',extra={},required=true)=>({id:'security-'+area,kind:'security-baseline',suite:'authz',required,options:{area,...extra}});
const exposed={'/.git/HEAD':['text/plain','ref: refs/heads/main\n'],'/.git/config':['text/plain','[core]\n\trepositoryformatversion = 0\n'],'/.env':['text/plain','DB_PASSWORD=SECRET_VALUE\nAPP_KEY=abc\n'],'/wp-content/debug.log':['text/plain','[01-Jan-2026 00:00:00 UTC] PHP Warning:  Undefined variable $x\n'],'/wp-config.php.bak':['text/plain',"<?php define('DB_NAME','wp');define('DB_PASSWORD','SECRET_VALUE');"],'/wp-content/uploads/':['text/html','<html><head><title>Index of /wp-content/uploads</title></head><body><a href="2026/">2026/</a></body></html>']};
const theme='<!doctype html><html><head><title>Not found</title></head><body class="error404"><p>DB_NAME guide: PHP Warning: KEY=VALUE</p></body></html>';

async function fixture(t,mode,route=()=>false){
  const seen=[];
  const server=http.createServer((req,res)=>{
    seen.push({method:req.method,url:req.url,host:req.headers.host,headers:req.headers,t:Date.now()});const p=new URL(req.url,'http://x').pathname;
    if(route(p,req,res))return;
    if(mode==='hang'&&p==='/.git/HEAD')return;
    if(mode==='gate'){res.setHeader('Content-Type','text/html');return res.end('<html><body><form id="loginform"></form></body></html>');}
    if(mode==='soft404'){res.setHeader('Content-Type','text/html; charset=UTF-8');return res.end(theme);}
    if(mode==='big'&&p==='/wp-content/debug.log'){res.setHeader('Content-Type','text/plain');return res.end(Buffer.alloc(10*1024*1024,'PHP Warning: x\n'));}
    const hit=mode==='exposed'&&exposed[p];if(!hit){res.writeHead(404,{'Content-Type':'text/html'});return res.end(theme);}
    res.setHeader('Content-Type',hit[0]);res.end(hit[1]);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  return {seen,config:{baseURL:`http://127.0.0.1:${server.address().port}/`,timeoutMs:1500,allowSensitivePaths:true}};
}
async function runIt(f,c=check()){const files={};let error;try{await run({check:c,config:f.config,requestFactory:request,attach:async(name,data)=>{files[name]=data;}});}catch(e){error=e;}return {error,evidence:files['security-baseline']};}

test('validate accepts the five areas and rejects bad suite, keys, paths and wpPath',()=>{
  const config={baseURL:'https://example.test/'};
  for(const area of ['exposure','transport','mixed','headers','disclosure'])validate(check(area),config);
  validate(check('headers',{paths:['/','/about/'],wpPath:'/wp/'}),config);
  for(const c of [check('other'),{...check(),suite:'seo'},check('exposure',{typo:1}),check('headers',{paths:[]}),check('headers',{paths:['/','/a','/b','/c','/d','/e']}),check('headers',{paths:['https://outside.test/']}),check('exposure',{wpPath:'wp/'}),check('exposure',{wpPath:'/wp'}),check('exposure',{wpPath:'/a/../'})])assert.throws(()=>validate(c,config));
  for(const id of ['git-head','git-config','env-file','debug-log','wp-config-backup','uploads-index'])assert.deepEqual(Object.keys(RULES[id]).sort(),['admin','area','code','impact','level','owner','title','verify']);
});

test('exposure detects git, env, debug log, wp-config backup, uploads index by content signature',async t=>{
  const f=await fixture(t,'exposed'),{error,evidence}=await runIt(f);
  assert.equal(error?.name,'AssertionError');const rules=evidence.findings.map(x=>x.rule);
  for(const id of ['git-head','git-config','env-file','debug-log','wp-config-backup','uploads-index'])assert(rules.includes(id),id),assert.match(error.message,new RegExp(id));
  assert.equal(evidence.schema,'security-baseline-v1');assert.equal(evidence.area,'exposure');assert.deepEqual(evidence.unchecked,[]);assert(evidence.findings.every(x=>x.level==='problem'&&x.path&&x.observation));
});

test('soft 404 html is not exposure',async t=>{
  const f=await fixture(t,'soft404'),{error,evidence}=await runIt(f);
  assert.equal(error,undefined);assert.deepEqual(evidence.findings,[]);assert.deepEqual(evidence.unchecked,[]);
});

test('exposure evidence never contains body text',async t=>{
  const f=await fixture(t,'exposed'),{evidence}=await runIt(f),text=JSON.stringify(evidence);
  for(const secret of ['DB_PASSWORD','SECRET_VALUE','ref: refs','repositoryformatversion','Index of'])assert(!text.includes(secret),secret);
  for(const r of evidence.requests)assert.deepEqual(Object.keys(r).sort(),['bytes','contentType','method','path','status']);
});

test('exposure is blocked without permission and sends no request',async t=>{
  const f=await fixture(t,'exposed'),config={...f.config,allowSensitivePaths:false};
  assert.throws(()=>validateRuntime(check(),config),/^Error: BLOCKED: 本番環境の機密パス確認は許可が必要です/);
  await assert.rejects(run({check:check(),config,requestFactory:request,attach:async()=>{}}),/BLOCKED:/);
  assert.equal(f.seen.length,0);validateRuntime(check('headers'),config);
  assert.match(preparationReason(check(),config),/^本番環境の機密パス確認は許可が必要です/);assert.equal(preparationReason(check(),f.config),null);validateChecks({baseURL:config.baseURL,checks:[check()]});
});

test('requests are GET/HEAD only, same origin, within 16, spaced >=200ms',async t=>{
  const f=await fixture(t,'exposed'),{evidence}=await runIt(f),host=new URL(f.config.baseURL).host;
  assert(f.seen.length>=12&&f.seen.length<=16,String(f.seen.length));assert.equal(evidence.requests.length,f.seen.length);
  assert(f.seen.every(s=>['GET','HEAD'].includes(s.method)&&s.host===host));
  assert.match(f.seen[0].url,/^\/wpqa-baseline-[a-z0-9]+\.txt$/);
  for(let i=1;i<f.seen.length;i++)assert(f.seen[i].t-f.seen[i-1].t>=195,`gap ${i}: ${f.seen[i].t-f.seen[i-1].t}`);
});

test('oversized body is truncated at 64KiB',async t=>{
  const f=await fixture(t,'big'),{error,evidence}=await runIt(f);
  assert.match(error.message,/debug-log/);assert.deepEqual(evidence.findings.map(x=>x.rule),['debug-log']);
  assert(evidence.requests.find(r=>r.path==='/wp-content/debug.log').bytes>=64*1024);
});

test('timeout or connection error becomes BLOCKED',async t=>{
  const f=await fixture(t,'hang'),{error,evidence}=await runIt(f);
  assert.match(error.message,/^BLOCKED: /);assert(evidence.unchecked.includes('/.git/HEAD'));
});

test('password gate html becomes BLOCKED',async t=>{
  const f=await fixture(t,'gate'),{error}=await runIt(f);
  assert.match(error.message,/^BLOCKED: /);assert.equal(f.seen.length,1);
});

test('baseline matching a rule makes that rule unchecked, not passed',async t=>{
  const seen=[];const server=http.createServer((req,res)=>{seen.push(req.url);res.setHeader('Content-Type','text/plain');res.end('ref: refs/heads/main\n');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const config={baseURL:`http://127.0.0.1:${server.address().port}/`,timeoutMs:1500,allowSensitivePaths:true};let evidence;
  await assert.rejects(run({check:check(),config,requestFactory:request,attach:async(n,d)=>{evidence=d;}}),/^Error: BLOCKED: 上限または通信失敗により未確認：/);
  assert.deepEqual(evidence.findings,[]);assert(evidence.unchecked.includes('/.git/HEAD'));assert(!seen.includes('/.git/HEAD'));
});

test('5xx, 429, proxy denial and redirects elsewhere are unchecked, never passed',async t=>{
  const cases=[
    ['503 everywhere',(p,q,res)=>{res.writeHead(503);res.end('maintenance');return true;},'/.git/HEAD'],
    ['429 on one path',(p,q,res)=>{if(p!=='/.env')return false;res.writeHead(429);res.end();return true;},'/.env'],
    ['proxy denied',(p,q,res)=>{res.writeHead(403,{'x-wpqa-egress':'denied'});res.end('接続先が許可されていません');return true;},'/.git/HEAD'],
    ['301 elsewhere',(p,q,res)=>{if(p!=='/.git/HEAD')return false;res.writeHead(301,{location:'https://outside.test/'});res.end();return true;},'/.git/HEAD'],
  ];
  for(const [name,route,path] of cases){const f=await fixture(t,'soft404',route),{error,evidence}=await runIt(f);assert.match(error?.message??'',/^BLOCKED: /,name);assert(evidence.unchecked.includes(path),name);assert(f.seen.every(s=>!s.url.startsWith('http')),name);}
  const f=await fixture(t,'soft404',(p,q,res)=>{if(p!=='/.git/config')return false;res.writeHead(301,{location:'/.git/config/'});res.end();return true;}),{error,evidence}=await runIt(f);
  assert.equal(error,undefined);assert.deepEqual(evidence.unchecked,[]);
});

test('registered site Basic auth and gate cookie are sent, admin session headers are not',async t=>{
  const name='SECURITY_BASELINE_HEADERS',auth='Basic '+Buffer.from('view:pass').toString('base64');
  process.env[name]=JSON.stringify({Authorization:auth,Cookie:'wordpress_logged_in_secret=bad; password_protected_fixture=good','X-WP-Nonce':'nonce','Proxy-Authorization':'x'});t.after(()=>delete process.env[name]);
  const f=await fixture(t,'soft404',(p,req,res)=>{if(req.headers.authorization===auth)return false;res.writeHead(401,{'www-authenticate':'Basic'});res.end();return true;});
  const {error}=await runIt({config:{...f.config,headersEnv:name}});assert.equal(error,undefined);
  for(const s of f.seen){assert.equal(s.headers.authorization,auth);assert.equal(s.headers.cookie,'password_protected_fixture=good');assert.equal(s.headers['x-wp-nonce'],undefined);assert.equal(s.headers['proxy-authorization'],undefined);}
  delete process.env[name];const g=await fixture(t,'soft404',(p,req,res)=>{res.writeHead(401);res.end();return true;});assert.match((await runIt(g)).error.message,/^BLOCKED: 閲覧に認証が必要です/);
});

test('reading stops at 64KiB and the connection is closed early',async t=>{
  let written=0,finished=false;const start=Date.now();
  const f=await fixture(t,'soft404',(p,q,res)=>{if(p!=='/wp-content/debug.log')return false;res.writeHead(200,{'Content-Type':'text/plain'});const chunk=Buffer.alloc(64*1024,'PHP Warning: x\n');const pump=()=>{while(written<10*1024*1024){written+=chunk.length;if(!res.write(chunk))return res.once('drain',pump);}finished=true;res.end();};res.on('error',()=>{});pump();return true;});
  const {error,evidence}=await runIt(f);assert.match(error.message,/debug-log/);
  assert(evidence.requests.find(r=>r.path==='/wp-content/debug.log').bytes<=65536);assert(!finished,'server finished sending 10MB');assert(written<10*1024*1024);assert(Date.now()-start<15000);
});

test('abort during a hanging request stops the check as cancelled',async t=>{
  const f=await fixture(t,'hang'),ac=new AbortController(),start=Date.now();setTimeout(()=>ac.abort(),500);
  await assert.rejects(run({check:check(),config:{...f.config,timeoutMs:10000},attach:async()=>{},signal:ac.signal}),/^Error: BLOCKED: 検査が中断されました/);assert(Date.now()-start<3000);
});
