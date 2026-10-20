import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareSetting,readField,inspectSetting} from '../lib/admin.mjs';
import {validateConfig,catalog} from '../lib/config.mjs';
const config={name:'test',baseURL:'http://localhost',environment:'local',pages:[{id:'home',path:'/',canonical:'http://localhost/',indexable:true}]};
test('admin settings require explicit expectations, same origin, and typed boolean checks',()=>{
  const setting={id:'timezone',source:'rest',path:'/wp-json/wp/v2/settings',field:'timezone',expected:'Asia/Tokyo'};
  const c=validateConfig({...config,admin:[setting]});
  assert.equal(catalog(c,'admin').find(r=>r.id==='admin.timezone').selected,true);
  for(const bad of [{...setting,expected:undefined},{...setting,path:'https://other.test/'},{...setting,source:'browser',field:undefined,selector:'#x',read:'checked',expected:'false'}]) assert.throws(()=>validateConfig({...config,admin:[bad]}));
});
test('REST rejects redirects and permission errors, extracts only selected fields and sanitizes transport errors',async()=>{
  const setting={source:'rest',path:'/wp-json/wp/v2/settings',field:'timezone'};
  for(const status of [302,401,403,500]) {
    let disposed=false;
    const requestFactory={newContext:async()=>({get:async(url,opts)=>{assert.equal(opts.maxRedirects,0);return {status:()=>status};},dispose:async()=>{disposed=true;}})};
    await assert.rejects(()=>inspectSetting({setting,config,requestFactory}),/BLOCKED/);
    assert.equal(disposed,true);
  }
  const requestFactory={newContext:async()=>({get:async()=>({status:()=>200,headers:()=>({'content-type':'application/json'}),json:async()=>({timezone:'Asia/Tokyo',password:'do-not-record'})}),dispose:async()=>{}})};
  assert.equal(await inspectSetting({setting,config,requestFactory}),'Asia/Tokyo');
  requestFactory.newContext=async()=>({get:async()=>{throw Error('Authorization: secret');},dispose:async()=>{}});
  await assert.rejects(()=>inspectSetting({setting,config,requestFactory}),error=>error.message.includes('BLOCKED')&&!error.message.includes('secret'));
});
test('missing fields block, false and zero are present, and comparison does not coerce types',()=>{
  assert.equal(readField({x:false},'x'),false);
  assert.equal(readField({x:0},'x'),0);
  assert.throws(()=>readField({},'x'),/BLOCKED/);
  assert.throws(()=>readField({},'toString'),/BLOCKED/);
  assert.equal(compareSetting({expected:0},'0').matched,false);
  const result=compareSetting({expected:'secret',sensitive:true},'different-secret');
  assert.equal(result.matched,false);assert.ok(!JSON.stringify(result).includes('secret'));
});
