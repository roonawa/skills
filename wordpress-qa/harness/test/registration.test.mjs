import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {validateProfile,registrationConfig} from '../ui/registration.mjs';import {ProjectStore} from '../ui/project-store.mjs';
const profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:true,contactFormId:31};
test('registration generates known self-authenticated modules and core expectations',()=>{
 const c=registrationConfig({name:'Fixture',baseURL:'https://example.test',environment:'staging',profile,discovery:{pages:[{path:'/'},{path:'/contact'}],warnings:[]}});
 assert.equal(c.journeys.length,4);assert.equal(c.admin.length,5);assert.equal(c.visuals.length,4);assert.equal(c.admin.find(a=>a.id==='indexing').expected,true);
});
test('production cannot generate mutation journeys',()=>{
 assert.throws(()=>validateProfile(profile,'production'),/本番/);const c=registrationConfig({name:'Fixture',baseURL:'https://example.test',environment:'production',profile:{...profile,writes:false},discovery:{pages:[{path:'/'}],warnings:[]}});assert(!c.journeys.some(j=>/lifecycle|scheduled/.test(j.id)));
});
test('profile and credentials persist without permitting arbitrary modules',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-reg-'));try{
 const store=new ProjectStore(dir,{codec:(s,decode)=>decode?Buffer.from(s,'base64').toString():Buffer.from(s).toString('base64')});
 const config=registrationConfig({name:'Fixture',baseURL:'https://example.test',environment:'staging',profile,discovery:{pages:[{path:'/'}],warnings:[]}});
 const id=store.save({config,profile,auth:{publicPassword:'test-secret'}});assert.equal(JSON.parse(store.prepare(id).env.WPQA_UI_PROFILE).writes,true);assert.equal(store.prepare(id).env.WPQA_UI_SITE_PASSWORD,'test-secret');assert(!JSON.stringify(store.view(id)).includes('test-secret'));
 assert.throws(()=>store.save({profile,config:{...config,journeys:[{id:'evil',module:'C:/evil.mjs'}]}}),/標準検査/);
 const current=store.view(id);
 assert.throws(()=>store.save({id,version:current.version,config:{...current.config,baseURL:'https://other.test'}}),/閲覧パスワード/);
 store.save({id,version:current.version,config:{...current.config,environment:'production'},profile:{...profile,writes:false,submit:false,bankOrder:false}});
 const production=store.view(id);assert.equal(production.profile.writes,false);assert.equal(production.config.allowTestWrites,false);assert(!production.config.journeys.some(j=>/post-lifecycle|scheduled|submit|bank-order/.test(j.id)));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('submission permissions require booleans',()=>{
 for(const key of ['writes','submit','bankOrder'])assert.throws(()=>validateProfile({...profile,[key]:'false'},'staging'),/真偽値/);
});
