import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startUI} from '../ui/server.mjs';
import {ProjectStore} from '../ui/project-store.mjs';

const profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false,sitePath:'/',adminPath:'/wp-admin/',maxPages:20};
const state={cookies:[{name:'admin-session',value:'private-cookie',domain:'example.test',path:'/'}],origins:[]};
const config={name:'Saved',baseURL:'https://example.test',environment:'staging',allowTestWrites:false,pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:false},{id:'custom-page',path:'/explicit/',canonical:'https://example.test/explicit/',indexable:false}],admin:[{id:'timezone',title:'Explicit timezone',source:'browser',path:'/wp-admin/options-general.php',selector:'#timezone_string',read:'value',expected:'UTC',authenticatedSelector:'#wpadminbar'}],checks:[{id:'coverage-metadata',kind:'standard-public',suite:'seo',options:{area:'metadata',paths:['/explicit/']}}]};
const discovery={pages:[{path:'/'},{path:'/new/'}],types:[],plugins:[],warnings:['fixture discovery'],authenticated:true};

test('rediscovery uses saved administrator auth, preserves expectations and rejects stale versions',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-rediscovery-'));
 const codec=(value,decode)=>decode?Buffer.from(value,'base64').toString():Buffer.from(value).toString('base64');
 const store=new ProjectStore(dir,{codec});
 const auth={browser:state,rest:{username:'admin',password:'private-rest'},publicPassword:'private-gate',roleCredentials:[{name:'subscriber',browser:state}]};
 const id=store.save({config,profile,auth});let calls=0,hold,entered;
 const app=await startUI({port:0,storeDir:dir,credentialCodec:codec,registrationDiscovery:async input=>{
  calls++;assert.deepEqual(input.state,state);assert.equal(input.publicPassword,'private-gate');assert.equal(input.baseURL,config.baseURL);assert.equal(input.profile.writes,false);
  entered?.();if(hold)await hold;return structuredClone(discovery);
 }});
 try{
  const boot=await (await fetch(app.url+'/api/bootstrap')).json();
  const post=(body)=>fetch(app.url+`/api/projects/${id}/rediscover`,{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const asset=await fetch(app.url+'/automation-inputs.js');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
  const before=store.record(id),bad=await post({version:'stale'});assert.equal(bad.status,409);assert.equal(calls,0);
  const extra=await post({version:before.version,profile:{writes:true}});assert.equal(extra.status,400);assert.equal(calls,0);
  const response=await post({version:before.version});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(calls,1);
  const after=store.record(id);assert.notEqual(after.version,before.version);assert.equal(result.version,after.version);
  assert.equal(after.config.allowTestWrites,false);assert.equal(after.profile.writes,false);
  assert.deepEqual(after.config.admin.find(a=>a.id==='timezone'),before.config.admin.find(a=>a.id==='timezone'));
  assert.deepEqual(after.config.checks.find(c=>c.id==='coverage-metadata'),before.config.checks.find(c=>c.id==='coverage-metadata'));
  assert(after.config.pages.some(p=>p.path==='/explicit/'));assert(after.config.pages.some(p=>p.path==='/new/'));
  assert.equal(after.sealed,before.sealed);assert.deepEqual(after.credentials,before.credentials);
  assert(!JSON.stringify(result).includes('private-'));
  const previewResponse=await post({version:after.version,preview:true});assert.equal(previewResponse.status,200);const preview=await previewResponse.json();assert.equal(preview.preview,true);assert.deepEqual(store.record(id),after);assert(!JSON.stringify(preview).includes('private-'));assert(preview.config.pages.some(p=>p.path==='/new/'));assert.equal(preview.profile.writes,false);
  let release;hold=new Promise(resolve=>{release=resolve;});const started=new Promise(resolve=>{entered=resolve;});
  const pending=post({version:after.version});await started;
  store.save({id,version:after.version,config:{...after.config,name:'Concurrent edit'},profile:after.profile});const concurrent=store.record(id);
  release();assert.equal((await pending).status,409);assert.deepEqual(store.record(id),concurrent);
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('settings save compiles additional checks, retains observed baselines and validates real executor options',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-save-automation-'));
 const codec=(value,decode)=>decode?Buffer.from(value,'base64').toString():Buffer.from(value).toString('base64');
 const store=new ProjectStore(dir,{codec});
 const baseline={id:'observed-reading-show-on-front',title:'Observed baseline',source:'browser',path:'/wp-admin/options-reading.php',selector:'#show_on_front',read:'value',expected:'page',authenticatedSelector:'#wpadminbar'};
 const id=store.save({config:{...config,admin:[...config.admin,baseline]},profile,auth:{browser:state}});
 const app=await startUI({port:0,storeDir:dir,credentialCodec:codec});
 try{
  const boot=await (await fetch(app.url+'/api/bootstrap')).json();
  const post=body=>fetch(app.url+`/api/projects/${id}/settings`,{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const before=store.record(id),check={id:'coverage-membership',suite:'membership',kind:'browser-flow',options:{steps:[{action:'goto',url:'/account/'},{action:'assertText',selector:'h1',value:'Account'}]}};
  const {generateCases}=await import('../ui/public/case-generator.js');
  const generated=generateCases(before.config);assert(generated.checks.some(c=>c.id==='coverage-admin-reading'));
  const updatedProfile={...before.profile,automation:{useObservedBaselines:true,additionalChecks:[check]}};
  const response=await post({version:before.version,config:generated,profile:updatedProfile});assert.equal(response.status,200,await response.text());
  const after=store.record(id);
  assert.equal(after.config.checks.find(c=>c.id===check.id).kind,'browser-flow');assert.deepEqual(after.config.checks.find(c=>c.id===check.id).options,check.options);
  assert(!after.config.checks.some(c=>c.id==='coverage-admin-reading'));
  assert.deepEqual(after.config.admin.find(a=>a.id===baseline.id),before.config.admin.find(a=>a.id===baseline.id));assert.equal(after.sealed,before.sealed);assert.equal(after.config.allowTestWrites,false);
  const invalid={...updatedProfile,automation:{...updatedProfile.automation,additionalChecks:[{...check,options:{steps:[]}}]}};
  const bad=await post({version:after.version,config:after.config,profile:invalid});assert.equal(bad.status,400);assert.deepEqual(store.record(id),after);
  const permitted={...after.profile,writes:true};const pendingConfig={...after.config,checks:[...after.config.checks.filter(c=>c.id!=='coverage-publishing'),{id:'coverage-publishing',title:'投稿検査',suite:'publishing',kind:'unconfigured',options:{instructions:'保存済みの独自案内'}}]};
  const enabled=await post({version:after.version,config:pendingConfig,profile:permitted});assert.equal(enabled.status,200,await enabled.text());const ready=store.record(id);assert(ready.config.journeys.some(j=>j.id==='profile-post-lifecycle'));assert(!ready.config.checks.some(c=>c.id==='coverage-publishing'&&c.kind==='unconfigured'));assert.equal(ready.profile.submit,after.profile.submit);
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
