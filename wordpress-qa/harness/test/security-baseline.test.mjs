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

async function fixture(t,mode){
  const seen=[];
  const server=http.createServer((req,res)=>{
    seen.push({method:req.method,url:req.url,host:req.headers.host,t:Date.now()});const p=new URL(req.url,'http://x').pathname;
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
