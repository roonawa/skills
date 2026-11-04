import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http,{createServer} from 'node:http';import {randomBytes} from 'node:crypto';
import {startUI} from '../ui/server.mjs';import {ProjectStore} from '../ui/project-store.mjs';import {registrationConfig} from '../ui/registration.mjs';import {triage} from '../ui/todo-triage.mjs';import {addSecurityChecks} from '../ui/public/case-generator.js';import {catalog} from '../lib/config.mjs';import {createSecretCodec} from '../ui/secret-codec.mjs';import {hashPassword} from '../ui/shared-access.mjs';
const request=(url,options={})=>new Promise((resolve,reject)=>{const req=http.request(url,{method:options.method??'GET',headers:options.headers},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(data)}));});req.on('error',reject);req.end(options.body);});
const profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false,automation:{pluginInventory:{observed:true,slugs:['contact-form-7']}}};
const stub=async()=>({public:{},admin:{}});
const adminState={cookies:[{name:'wordpress_logged_in_x',value:'v',domain:'example.test',path:'/'}],origins:[]},adminMsg='管理画面のログインを保存すると検査できます（技術担当が準備）。';
async function fixture(t,{codec=v=>v,environment='staging',baseURL='https://example.test',auth}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-todo-api-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new ProjectStore(path.join(dir,'projects'),{codec}),config=registrationConfig({name:'Todo',baseURL,environment,profile,discovery:{pages:[{path:'/'},{path:'/about/'},{path:'/contact/'}],warnings:[]}});
 const id=store.save({config,profile,...(auth?{auth}:{})});return {dir,store,id,codec};
}
test('todo api returns triage for managed site and managed:false for external',async t=>{
 const {dir,store,id,codec}=await fixture(t),external=path.join(dir,'site.json');
 fs.writeFileSync(external,JSON.stringify({name:'External',baseURL:'https://external.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://external.test/',indexable:false}],journeys:[],visuals:[]}));
 const app=await startUI({port:0,storeDir:path.join(dir,'projects'),credentialCodec:codec,configPaths:[external],publicDiscovery:stub});t.after(()=>app.close());
 const boot=await(await fetch(app.url+'/api/bootstrap')).json(),ext=boot.projects.find(p=>p.id!==id);
 const r=await fetch(`${app.url}/api/projects/${id}/todo`);assert.equal(r.status,200);const data=await r.json(),record=store.record(id);
 assert.equal(data.managed,true);assert.equal(data.environment,'staging');assert.equal(data.version,store.view(id).version);
 assert.deepEqual(data,{managed:true,environment:'staging',version:record.version,...triage(addSecurityChecks(structuredClone(record.config),'/wp-admin/'),record.profile,{adminLogin:false,notApplicable:record.config.autoNotApplicable})});
 assert(!data.todo.some(x=>x.key==='writes'));assert.equal(data.technical.find(x=>x.id==='coverage-publishing').message,adminMsg);assert(data.notRelevant.some(x=>x.id==='coverage-order'));for(const k of ['toolGap','technical'])assert(Array.isArray(data[k]));
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
test('settings save keeps a pass/fail check for the agreed display limit and refuses stale versions with 409',async t=>{
 const {dir,store,id,codec}=await fixture(t),app=await startUI({port:0,storeDir:path.join(dir,'projects'),credentialCodec:codec,publicDiscovery:stub});t.after(()=>app.close());
 const boot=await(await fetch(app.url+'/api/bootstrap')).json(),post=v=>fetch(`${app.url}/api/projects/${id}/settings`,{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify(v)});
 const save=async patch=>{const s=store.view(id),r=await post({version:s.version,config:s.config,profile:{...s.profile,...patch}});assert.equal(r.status,200,await r.clone().text());return store.context(id).config;};
 const budget=c=>c.checks.find(x=>x.id==='registration-performance')?.options.budgets.durationMs;
 let config=await save({performanceMs:3000});assert.equal(budget(config),3000);
 const row=catalog(config).find(r=>r.id==='check.registration-performance');assert(row&&!row.preparationRequired&&!row.autoNotApplicable);
 assert(!config.checks.some(x=>x.id==='coverage-performance'));
 assert(!(await(await fetch(`${app.url}/api/projects/${id}/todo`)).json()).todo.some(x=>x.key==='performance'));
 config=await save({performanceMs:2500});assert.equal(budget(config),2500);assert.equal(config.checks.filter(x=>x.id==='registration-performance').length,1);
 const {performanceMs,...cleared}=store.view(id).profile;const s=store.view(id);
 assert.equal((await post({version:s.version,config:s.config,profile:cleared})).status,200);config=store.context(id).config;assert.equal(budget(config),undefined);
 assert.equal(catalog(config).find(r=>r.id==='check.coverage-performance')?.preparationRequired,true);
 assert((await(await fetch(`${app.url}/api/projects/${id}/todo`)).json()).todo.some(x=>x.key==='performance'&&x.count===1));
 const before=store.record(id).version,stale=await post({version:'stale-version',config:s.config,profile:cleared});
 assert.equal(stale.status,409);const body=await stale.json();assert.equal(body.conflict,true);assert.match(body.error,/別の画面で設定が更新されました/);assert.equal(store.record(id).version,before);
});
test('todo api offers the writes item only when an admin login is saved',async t=>{
 const {dir,store,id,codec}=await fixture(t,{auth:{browser:adminState}}),app=await startUI({port:0,storeDir:path.join(dir,'projects'),credentialCodec:codec,publicDiscovery:stub});t.after(()=>app.close());
 assert.equal(store.record(id).credentials.browser,true);
 const data=await(await fetch(`${app.url}/api/projects/${id}/todo`)).json();assert(data.todo.some(x=>x.key==='writes'&&x.count===3));assert(!data.technical.some(x=>x.id==='coverage-publishing'));
});
test('todo api reads exclusions from the stored record like the list and the gate',async t=>{
 const {dir,store,id,codec}=await fixture(t),file=store.file(id),record=store.record(id);
 // 更新前に保存されたサイト：自動の対象外がまだ記録されていない。
 delete record.config.autoNotApplicable;fs.writeFileSync(file,JSON.stringify(record));
 const app=await startUI({port:0,storeDir:path.join(dir,'projects'),credentialCodec:codec,publicDiscovery:stub});t.after(()=>app.close());
 const data=await(await fetch(`${app.url}/api/projects/${id}/todo`)).json(),rows=catalog(store.context(id).config);
 assert.deepEqual(data.notRelevant,[]);assert(!rows.some(r=>r.autoNotApplicable));for(const k of ['coverage-order','coverage-membership'])assert(data.technical.some(x=>x.id===k),k);
});
test('settings saves keep the stored plugin inventory and overrides and ignore a forged inventory',async t=>{
 const {dir,store,id,codec}=await fixture(t),app=await startUI({port:0,storeDir:path.join(dir,'projects'),credentialCodec:codec,publicDiscovery:stub});t.after(()=>app.close());
 const boot=await(await fetch(app.url+'/api/bootstrap')).json(),headers={Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'};
 const post=(route,v)=>fetch(`${app.url}/api/projects${route}`,{method:'POST',headers,body:JSON.stringify(v)});
 const inventory=store.record(id).profile.automation.pluginInventory,s=store.view(id);
 // 結果画面の「関係ありに戻す」
 assert.equal((await post('/'+id+'/settings',{version:s.version,config:s.config,profile:{...s.profile,automation:{...s.profile.automation,relevantOverrides:['coverage-membership']}}})).status,200);
 // 設定画面の保存：automation は useObservedBaselines と additionalChecks だけを送る。続けて偽の一覧を送る。
 for(const automation of [{useObservedBaselines:true,additionalChecks:[]},{useObservedBaselines:true,additionalChecks:[],pluginInventory:{observed:true,slugs:['woocommerce','wp-members']}}]){
  const v=store.view(id),r=await post('/'+id+'/settings',{version:v.version,config:v.config,profile:{...v.profile,automation}});assert.equal(r.status,200,await r.clone().text());
  const saved=store.record(id);assert.deepEqual(saved.profile.automation.pluginInventory,inventory);assert.deepEqual(saved.profile.automation.relevantOverrides,['coverage-membership']);
  assert(saved.config.autoNotApplicable['coverage-order']);assert(!saved.config.autoNotApplicable['coverage-membership']);
 }
 const v=store.view(id);assert.equal((await post('/'+id+'/settings',{version:v.version,config:v.config,profile:{...v.profile,automation:{useObservedBaselines:true,additionalChecks:[],relevantOverrides:[]}}})).status,200);
 assert.deepEqual(store.record(id).profile.automation.relevantOverrides,[]);assert(store.record(id).config.autoNotApplicable['coverage-membership']);
 // 新規登録でも画面から届いた一覧は使わない。
 const created=await post('',{config:{...v.config,name:'Forged'},profile:{...v.profile,automation:{useObservedBaselines:true,additionalChecks:[],pluginInventory:{observed:true,slugs:[]}}}});assert.equal(created.status,201,await created.clone().text());
 const other=store.record((await created.json()).id);assert.equal(other.profile.automation?.pluginInventory,undefined);assert.equal(other.config.autoNotApplicable,undefined);
});
