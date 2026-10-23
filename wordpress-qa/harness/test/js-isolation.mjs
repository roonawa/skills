import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const dir=path.join(root,'.selftest',`js-isolation-${Date.now()}`);fs.mkdirSync(dir,{recursive:true});
let jsFault=false,layoutFault=false;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="en"><head><title>Fixture</title><style>body{color:#000;background:#fff}main{${layoutFault?'width:1800px':''}}</style></head><body><main><h1>Fixture</h1><p>Stable content</p></main>${jsFault?'<script>throw new Error("fixture-js-failure")</script>':''}</body></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const config={name:'JS isolation',environment:'local',baseURL:url,outputDir:'runs',baselineDir:'baselines',pages:[{id:'home',path:'/',canonical:url+'/',indexable:true,links:false}],visuals:[{id:'home-pc',pageId:'home',width:1280,height:900,ready:'main'}]};
const file=path.join(dir,'site.json');fs.writeFileSync(file,JSON.stringify(config));
async function cli(args){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['bin/qa.mjs',...args],{cwd:root});let log='';p.stdout.on('data',x=>log+=x);p.stderr.on('data',x=>log+=x);p.on('error',reject);p.on('exit',code=>resolve({code,log}));});}
async function run(){const outcome=await cli(['run','--config',file,'--suite','visual']);const latest=fs.readdirSync(path.join(dir,'runs'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort().at(-1);const runDir=path.join(dir,'runs',latest);const report=JSON.parse(fs.readFileSync(path.join(runDir,'results.json')));return {...outcome,runDir,report,status:id=>report.rows.find(r=>r.id===id)?.status};}
try{
 let r=await run();assert.equal(r.status('javascript.home-pc'),'pass',r.log);assert.equal(r.status('snapshot.home-pc'),'review',r.log);
 const approved=await cli(['approve-baseline','--config',file,'--run',r.runDir,'--id','snapshot.home-pc']);assert.equal(approved.code,0,approved.log);
 jsFault=true;r=await run();assert.equal(r.status('javascript.home-pc'),'fail',r.log);
 for(const type of ['layout','axe','snapshot'])assert.equal(r.status(`${type}.home-pc`),'pass',r.log);
 const jsRow=r.report.rows.find(r=>r.id==='javascript.home-pc');assert.ok(jsRow.evidence.some(e=>e.includes('javascript')));
 assert.equal(r.report.gatePassed,false);assert.equal(r.code,1);
 layoutFault=true;r=await run();assert.equal(r.status('javascript.home-pc'),'fail');assert.equal(r.status('layout.home-pc'),'fail');assert.equal(r.status('snapshot.home-pc'),'fail');
 console.log('PASS: JS errors fail independently; layout/axe/snapshot continue; real layout regression still fails. '+dir);
}finally{await new Promise(r=>server.close(r));}
