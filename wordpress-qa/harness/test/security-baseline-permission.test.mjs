import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConfig} from '../lib/config.mjs';
import {registrationConfig} from '../ui/registration.mjs';
import {completePreparation} from '../ui/automatic-preparation.mjs';
const base=()=>({name:'fixture',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:true,lang:'ja',links:true}]});
const disc={authenticated:false,pages:[{path:'/'}],warnings:[],automation:{public:{},admin:{}}};
const reg=(environment,profile={})=>registrationConfig({name:'x',baseURL:'https://example.test',environment,profile:{sitePath:'/',timezone:'Asia/Tokyo',language:'ja',indexable:true,...profile},discovery:disc});
test('config accepts boolean allowSensitivePaths and defaults false',()=>{
 assert.equal(validateConfig(base()).allowSensitivePaths,false);
 assert.equal(validateConfig({...base(),allowSensitivePaths:true}).allowSensitivePaths,true);
 assert.throws(()=>validateConfig({...base(),allowSensitivePaths:'yes'}),/allowSensitivePaths/);
});
test('registration default depends on environment',()=>{
 assert.equal(reg('production').allowSensitivePaths,false);
 assert.equal(reg('staging').allowSensitivePaths,true);
 assert.equal(reg('local').allowSensitivePaths,true);
 assert.equal(reg('production',{sensitivePaths:true}).allowSensitivePaths,true);
 assert.equal(reg('staging',{sensitivePaths:false}).allowSensitivePaths,false);
});
test('automatic preparation never widens allowSensitivePaths',async()=>{
 for(const environment of ['staging','production']){
  const config={...base(),environment,allowSensitivePaths:false,allowProductionJourneys:false,checks:[],manual:[],journeys:[],visuals:[],admin:[]};
  const out=await completePreparation(config,{sitePath:'/'},{...disc,authenticated:true});
  assert.equal(out.config.allowSensitivePaths,false);
 }
 const legacy={...base(),checks:[],manual:[],journeys:[],visuals:[],admin:[]};
 const out=await completePreparation(legacy,{sitePath:'/'},{...disc,authenticated:true});
 assert.notEqual(out.config.allowSensitivePaths,true);
});
test('ProjectStore.save derives allowSensitivePaths without resetting stored values',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const {ProjectStore}=await import('../ui/project-store.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-sp-'));
 try{
  const store=new ProjectStore(dir),prof={sitePath:'/',timezone:'Asia/Tokyo',language:'ja',indexable:true};
  const cfg=environment=>({...base(),environment,allowProductionJourneys:environment==='production',admin:[],journeys:[],visuals:[],checks:[],manual:[]});
  const flag=id=>store.view(id).config.allowSensitivePaths;
  assert.equal(flag(store.save({config:cfg('staging'),profile:prof})),true);
  assert.equal(flag(store.save({config:cfg('production'),profile:prof})),false);
  const id=store.save({config:cfg('staging'),profile:{...prof,sensitivePaths:false}});assert.equal(flag(id),false);
  assert.equal(flag(store.save({id,version:store.view(id).version,config:cfg('staging'),profile:prof})),false);
  const id2=store.save({config:cfg('production'),profile:{...prof,sensitivePaths:true}});assert.equal(flag(id2),true);
  assert.equal(flag(store.save({id:id2,version:store.view(id2).version,config:cfg('production'),profile:prof})),true);
  assert.equal(flag(store.save({id:id2,version:store.view(id2).version,config:cfg('production'),profile:{...prof,sensitivePaths:false}})),false);
  const id3=store.save({config:cfg('staging'),profile:prof});
  const rec=store.record(id3);delete rec.config.allowSensitivePaths;fs.writeFileSync(store.file(id3),JSON.stringify(rec));
  assert.equal(flag(store.save({id:id3,version:store.view(id3).version,config:cfg('staging'),profile:prof})),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
