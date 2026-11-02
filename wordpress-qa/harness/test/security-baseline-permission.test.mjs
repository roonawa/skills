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
