import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http,{createServer} from 'node:http';import {randomBytes} from 'node:crypto';
import {startUI} from '../ui/server.mjs';import {ProjectStore} from '../ui/project-store.mjs';import {registrationConfig} from '../ui/registration.mjs';import {triage} from '../ui/todo-triage.mjs';import {addSecurityChecks} from '../ui/public/case-generator.js';import {catalog} from '../lib/config.mjs';import {createSecretCodec} from '../ui/secret-codec.mjs';import {hashPassword} from '../ui/shared-access.mjs';
const request=(url,options={})=>new Promise((resolve,reject)=>{const req=http.request(url,{method:options.method??'GET',headers:options.headers},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(data)}));});req.on('error',reject);req.end(options.body);});
const profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false,automation:{pluginInventory:{observed:true,slugs:['contact-form-7']}}};
const stub=async()=>({public:{},admin:{}});
async function fixture(t,{codec=v=>v,environment='staging',baseURL='https://example.test'}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-todo-api-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new ProjectStore(path.join(dir,'projects'),{codec}),config=registrationConfig({name:'Todo',baseURL,environment,profile,discovery:{pages:[{path:'/'},{path:'/about/'},{path:'/contact/'}],warnings:[]}});
 const id=store.save({config,profile});return {dir,store,id,codec};
}
test('todo api returns triage for managed site and managed:false for external',async t=>{
 const {dir,store,id,codec}=await fixture(t),external=path.join(dir,'site.json');
 fs.writeFileSync(external,JSON.stringify({name:'External',baseURL:'https://external.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://external.test/',indexable:false}],journeys:[],visuals:[]}));
 const app=await startUI({port:0,storeDir:path.join(dir,'projects'),credentialCodec:codec,configPaths:[external],publicDiscovery:stub});t.after(()=>app.close());
 const boot=await(await fetch(app.url+'/api/bootstrap')).json(),ext=boot.projects.find(p=>p.id!==id);
 const r=await fetch(`${app.url}/api/projects/${id}/todo`);assert.equal(r.status,200);const data=await r.json(),record=store.record(id);
 assert.equal(data.managed,true);assert.equal(data.environment,'staging');assert.equal(data.version,store.view(id).version);
 assert.deepEqual(data,{managed:true,environment:'staging',version:record.version,...triage(addSecurityChecks(structuredClone(record.config),'/wp-admin/'),record.profile)});
 assert(data.todo.some(x=>x.key==='writes'));assert(data.notRelevant.some(x=>x.id==='coverage-order'));for(const k of ['toolGap','technical'])assert(Array.isArray(data[k]));
 assert.deepEqual(await(await fetch(`${app.url}/api/projects/${ext.id}/todo`)).json(),{managed:false});
 assert.equal((await fetch(`${app.url}/api/projects/missing/todo`)).status,404);
});
test('todo api requires the same auth as other project GETs',async t=>{
 const local=await fixture(t);let app=await startUI({port:0,storeDir:path.join(local.dir,'projects'),credentialCodec:local.codec,publicDiscovery:stub});
 try{for(const route of ['settings','todo'])assert.equal((await request(`${app.url}/api/projects/${local.id}/${route}`,{headers:{Host:'evil.test'}})).status,403,route);}finally{await app.close();}
 const codec=createSecretCodec(randomBytes(32)),shared={origin:'https://qa.test',users:[{name:'alice',...hashPassword('a-long-random-pilot-password')}]},{dir,id}=await fixture(t,{codec});
 app=await startUI({port:0,storeDir:path.join(dir,'projects'),credentialCodec:codec,shared,publicDiscovery:stub});
 try{
  const headers={Host:'qa.test',Authorization:'Basic '+Buffer.from('alice:a-long-random-pilot-password').toString('base64')};
  for(const route of ['settings','todo']){
   assert.equal((await request(`${app.url}/api/projects/${id}/${route}`,{headers:{Host:'qa.test'}})).status,401,route);
   assert.equal((await request(`${app.url}/api/projects/${id}/${route}`,{headers:{...headers,Authorization:'Basic '+Buffer.from('alice:wrong-password-xx').toString('base64')}})).status,401,route);
   assert.equal((await request(`${app.url}/api/projects/${id}/${route}`,{headers})).status,200,route);
  }
  assert.equal((await(await request(`${app.url}/api/projects/${id}/todo`,{headers})).json()).managed,true);
 }finally{await app.close();}
});
test('runs with ids rejects preparation, not_applicable and unknown rows',async t=>{
 const {dir,store,id,codec}=await fixture(t),app=await startUI({port:0,storeDir:path.join(dir,'projects'),credentialCodec:codec,publicDiscovery:stub});t.after(()=>app.close());
 const boot=await(await fetch(app.url+'/api/bootstrap')).json(),post=v=>fetch(`${app.url}/api/projects/${id}/runs`,{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify(v)});
 const rows=catalog(store.context(id).config),page=rows.find(r=>r.id.startsWith('page.')).id,before=store.record(id).version;
 assert(rows.find(r=>r.id==='check.coverage-publishing').preparationRequired);assert(rows.find(r=>r.id==='check.coverage-order').autoNotApplicable);
 for(const [ids,pattern] of [[[page,'check.coverage-publishing'],/設定が必要/],[[page,'check.coverage-order'],/対象外/],[[page,'check.nothing-here'],/見つかりません/],[[],/ids/],['page.home',/ids/],[[page,1],/ids/],[Array.from({length:51},(_,i)=>'page.p'+i),/50/]]){
  const r=await post({suite:'all',ids});assert.equal(r.status,400,JSON.stringify(ids));assert.match((await r.json()).error,pattern,JSON.stringify(ids));
 }
 assert.equal(store.record(id).version,before);assert(!fs.existsSync(store.context(id).outputDir)||!fs.readdirSync(store.context(id).outputDir).length);
});
test('runs with ids executes only those rows',async t=>{
 const site=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><head><title>x</title></head><body>ok</body></html>');});await new Promise(r=>site.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>site.close(r)));
 const {dir,store,id,codec}=await fixture(t,{environment:'local',baseURL:'http://127.0.0.1:'+site.address().port}),app=await startUI({port:0,storeDir:path.join(dir,'projects'),credentialCodec:codec,publicDiscovery:stub});
 try{
  const boot=await(await fetch(app.url+'/api/bootstrap')).json(),pages=catalog(store.context(id).config).filter(r=>r.id.startsWith('page.')).map(r=>r.id);assert.equal(pages.length,3);
  const r=await fetch(`${app.url}/api/projects/${id}/runs`,{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify({suite:'all',ids:[pages[0],pages[1],pages[0]]})});assert.equal(r.status,202,await r.clone().text());
  await app.close();const out=store.context(id).outputDir,result=fs.readdirSync(out).filter(n=>fs.existsSync(path.join(out,n,'results.json'))).map(n=>JSON.parse(fs.readFileSync(path.join(out,n,'results.json')))).at(-1);
  assert.deepEqual(result.rows.filter(r=>r.selected).map(r=>r.id),[pages[0],pages[1]]);for(const p of pages.slice(0,2))assert.notEqual(result.rows.find(r=>r.id===p).status,'not_run',p);assert.equal(result.rows.find(r=>r.id===pages[2]).status,'not_run');
 }finally{await app.close();}
});
