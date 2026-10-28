import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'.selftest','extended-'+Date.now());fs.mkdirSync(dir,{recursive:true});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="ja"><head><title>Fixture</title><link rel="canonical" href="'+base+'/"><meta property="og:title" content="Fixture"></head><body><h1>Fixture</h1><button id="first">OK</button></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const config={name:'Extended integration',baseURL:base,environment:'local',pages:[{id:'home',path:'/',canonical:base+'/',indexable:true,links:false}],outputDir:path.join(dir,'runs'),checks:[
 {id:'seo',suite:'seo',kind:'seo-page',options:{path:'/',meta:{'og:title':'Fixture'}}},
 {id:'screen',suite:'compatibility',kind:'compatibility-screen',options:{path:'/',engine:'chromium',viewport:{width:900,height:700},text:[{selector:'h1',value:'Fixture'}]}},
 {id:'keyboard',suite:'accessibility',kind:'keyboard-sequence',options:{path:'/',steps:[{key:'Tab',focus:'#first'}]}},
 {id:'pending',suite:'operations',kind:'unconfigured',options:{instructions:'復元環境を登録'}} ,
 {id:'human',suite:'accessibility',kind:'human-review',options:{instructions:'実機と読み上げの確認'}}
]};
const file=path.join(dir,'site.json');fs.writeFileSync(file,JSON.stringify(config));
try{
 const result=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[path.join(root,'bin/qa.mjs'),'run','--config',file],{cwd:root});let log='';p.stdout.on('data',x=>log+=x);p.stderr.on('data',x=>log+=x);p.on('error',reject);p.on('exit',code=>resolve({code,log}));});
 fs.writeFileSync(path.join(dir,'execution.log'),result.log);
 const run=path.join(config.outputDir,fs.readdirSync(config.outputDir).at(-1));const report=JSON.parse(fs.readFileSync(path.join(run,'results.json')));
 assert.equal(result.code,2,result.log);assert.equal(report.gatePassed,false);
 for(const id of ['seo','screen','keyboard'])assert.equal(report.rows.find(r=>r.id==='check.'+id)?.status,'pass',result.log);
 assert.equal(report.rows.find(r=>r.id==='check.pending').status,'not_run');assert.equal(report.rows.find(r=>r.id==='check.pending').preparationRequired,true);assert.equal(report.rows.find(r=>r.id==='check.pending').selected,false);assert.equal(report.rows.find(r=>r.id==='check.human').status,'review');
 const screen=report.rows.find(r=>r.id==='check.screen');assert.equal(screen.details.actual.verified,true);assert.ok(screen.evidence.some(e=>e.endsWith('.png')));
 for(const e of screen.evidence)assert.ok(fs.existsSync(path.join(run,e)));
 console.log('Extended CLI/report integration passed: '+dir);
}finally{await new Promise(r=>server.close(r));}
