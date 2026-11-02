import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createServer} from 'node:http';
import {startUI} from '../ui/server.mjs';import {ProjectStore} from '../ui/project-store.mjs';
test('run button prepares missing public conditions, prevents concurrent writes, then executes the generated check',async()=>{
 const site=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><body><form id="search" action="/" method="get"><input name="s"><button>Search</button></form></body></html>');});await new Promise(r=>site.listen(0,'127.0.0.1',r));
 const baseURL='http://127.0.0.1:'+site.address().port,dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-auto-run-')),codec=(v)=>v,store=new ProjectStore(dir,{codec});
 const id=store.save({config:{name:'fixture',baseURL,environment:'local',pages:[{id:'home',path:'/',indexable:false,canonical:baseURL+'/'}],checks:[{id:'coverage-navigation',kind:'unconfigured',suite:'delivery',options:{instructions:'missing'}}]}});
 let resume,started;const latch=new Promise(r=>resume=r),entered=new Promise(r=>started=r);
 const app=await startUI({port:0,storeDir:dir,credentialCodec:codec,publicDiscovery:async()=>{started();await latch;return {public:{search:{path:'/',actionPath:'/',formSelector:'#search',inputSelector:'input[name=s]',submitSelector:'button'}},admin:{}};}});
 try{
  const boot=await(await fetch(app.url+'/api/bootstrap')).json();const post=(p,v)=>fetch(app.url+p,{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify(v)});
  const running=post(`/api/projects/${id}/runs`,{suite:'delivery'});await entered;
  const busy=await(await fetch(app.url+`/api/projects/${id}`)).json();assert.equal(busy.active.kind,'prepare');assert.equal(busy.busy,true);
  assert.equal((await post(`/api/projects/${id}/runs`,{suite:'delivery'})).status,409);resume();
  const response=await running;assert.equal(response.status,202);const job=await response.json();assert.equal(job.preparation.adopted,1);
  await app.close();const out=store.context(id).outputDir;const result=fs.readdirSync(out).filter(n=>fs.existsSync(path.join(out,n,'results.json'))).map(n=>JSON.parse(fs.readFileSync(path.join(out,n,'results.json')))).at(-1);
  assert.equal(result.rows.find(r=>r.id==='check.coverage-navigation').status,'pass');assert.notEqual(store.record(id).config.allowTestWrites,true);
 }finally{resume();await app.close();await new Promise(r=>site.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
