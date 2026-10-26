import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cleanupOwned,runProfile} from '../builtin/wordpress-profile/runtime.mjs';
import {journalIntent,readJournal} from '../lib/recovery.mjs';
import {readSettings, requireWrites, sameOrigin, parseSettings, scheduleAt, inventoryLinks, contactFields, assertOwned, pageCount} from '../builtin/wordpress-profile/helpers.mjs';

const config = {baseURL:'https://fixture.test',environment:'staging',allowTestWrites:true};
const env = (profile={adminPath:'/wp-admin/',contactFormId:null,writes:true}) => ({WPQA_UI_PROFILE:JSON.stringify(profile),WPQA_UI_ADMIN_STATE:JSON.stringify({cookies:[],origins:[]})});
test('writes require all three explicit permissions, production never writes', () => {
  for (const environment of ['production','preview',undefined]) assert.throws(()=>requireWrites({...config,environment},{writes:true}),/BLOCKED/);
  for (const allowTestWrites of [false,undefined,'true',1]) assert.throws(()=>requireWrites({...config,allowTestWrites},{writes:true}),/BLOCKED/);
  for (const writes of [false,undefined,'true',1]) assert.throws(()=>requireWrites(config,{writes}),/BLOCKED/);
  for (const environment of ['staging','local']) requireWrites({...config,environment},{writes:true});
});
test('environment parsing fails closed without disclosing input', () => {
  assert.equal(readSettings(config,env()).profile.adminPath,'/wp-admin/');
  for (const profile of [null,[],{writes:'true'},{writes:false,contactFormId:0},{writes:false,contactFormId:1.5},{writes:false,adminPath:'//evil.test/'},{writes:false,adminPath:'/wp-admin/?action=logout'},{writes:false,module:'evil.mjs'}]) assert.throws(()=>readSettings(config,env(profile)),/BLOCKED/);
  for (const state of ['secret-invalid-json','null','[]','{}']) assert.throws(()=>readSettings(config,{...env(),WPQA_UI_ADMIN_STATE:state}), e=>e.message.includes('BLOCKED')&&!e.message.includes('secret'));
});
test('URLs and nonce roots cannot escape the configured origin', () => {
  for(const url of ['https://evil.test/wp-json/','//evil.test/','https://user:secret@fixture.test/','javascript:alert(1)']) assert.throws(()=>sameOrigin(url,config.baseURL),/BLOCKED/);
  assert.equal(parseSettings('var wpApiSettings = {"root":"https://fixture.test/wp-json/","nonce":"abc"};',config.baseURL).nonce,'abc');
  assert.throws(()=>parseSettings('var wpApiSettings = {"root":"https://evil.test/","nonce":"secret"};',config.baseURL),/BLOCKED/);
  assert.throws(()=>parseSettings('var wpApiSettings = evil();',config.baseURL),/BLOCKED/);
});
test('scheduling uses server Date, at least 90 seconds and rejects missing dates',()=>{
  const server='Wed, 01 Jan 2020 00:00:00 GMT';
  assert.equal(Date.parse(scheduleAt(server)+'Z')-Date.parse(server),120000);
  for(const value of [undefined,'', 'bad']) assert.throws(()=>scheduleAt(value),/BLOCKED/);
});
test('bounded inventory keeps query permalinks distinct and records absent links',()=>{
  const result=inventoryLinks([{id:1,link:'https://fixture.test/?p=1'},{id:2,link:'https://fixture.test/?p=2'},{id:3}], [{path:'/?p=1'}],config.baseURL);
  assert.deepEqual(result.missing.map(x=>x.id),[2]); assert.deepEqual(result.missingLinks,[3]);
  assert.equal(pageCount('50'),50);
  for(const count of ['51','-1','NaN',undefined]) assert.throws(()=>pageCount(count),/BLOCKED/);
});
test('CF7 schema extracts fields without recording defaults or sending',()=>{
  assert.deepEqual(contactFields('[text* your-name minlength:2 maxlength:50 "secret"] [email mail] [acceptance agree optional]'),[
    {type:'text',name:'your-name',required:true,minlength:2,maxlength:50},
    {type:'email',name:'mail',required:false,minlength:null,maxlength:null},
    {type:'acceptance',name:'agree',required:false,minlength:null,maxlength:null}
  ]);
});
test('cleanup requires exact marker, author, title, content and optional ID',()=>{
  const marker='wpqa-12345678-1234-1234-1234-123456789abc';
  const post={id:7,author:3,slug:marker,title:{raw:marker},content:{raw:marker+'-v1'}};
  assertOwned(post,{marker,owner:3,id:7});
  for(const patch of [{slug:marker+'-2'},{author:4},{id:8},{title:{raw:'someone else'}},{content:{raw:'other'}}]) assert.throws(()=>assertOwned({...post,...patch},{marker,owner:3,id:7}),/ownership/);
});

test('uncertain create cleanup resolves only one exact owned post and durably records deletion',async()=>{
  const runDir=await mkdtemp(path.join(os.tmpdir(),'wpqa-profile-'));
  const entry={marker:'wpqa-12345678-1234-1234-1234-123456789abc',owner:3,site:config.baseURL,collection:'/wp-json/wp/v2/posts'};
  const post={id:7,author:3,slug:entry.marker,title:{raw:entry.marker},content:{raw:entry.marker+'-v1'}};
  let mode='foreign',deleted=false; const calls=[];
  const api=async(url,method='GET')=>{
    calls.push({url,method});
    if(method==='DELETE'){deleted=true;return {status:200,data:{deleted:true}};}
    if(deleted)return {status:404,data:{}};
    if(url.includes('slug='))return {status:200,data:mode==='ambiguous'?[post,post]:[{...post,author:mode==='foreign'?4:3}]};
    return {status:200,data:post};
  };
  const args={api,entry,runDir,config,profile:{writes:true}};
  try{
    await journalIntent(runDir,entry);
    for(mode of ['foreign','ambiguous']){
      await assert.rejects(cleanupOwned(args),/BLOCKED/);
      assert.equal(deleted,false); assert.equal((await readJournal(runDir))[0].state,'pending');
    }
    mode='owned';
    assert.equal((await cleanupOwned(args)).deleted,true);
    assert.equal((await readJournal(runDir))[0].state,'deleted');
    assert.equal(calls.filter(c=>c.method==='DELETE').length,1);
    assert(!JSON.stringify(await readJournal(runDir)).includes('nonce'));
  }finally{await rm(runDir,{recursive:true,force:true});}
});

test('production cleanup refuses even before calling the supplied API',async()=>{
  let calls=0;
  await assert.rejects(cleanupOwned({api:async()=>{calls++;},config:{...config,environment:'production'},profile:{writes:true}}),/BLOCKED/);
  assert.equal(calls,0);
});

test('failed deletion leaves durable pending intent',async()=>{
  const runDir=await mkdtemp(path.join(os.tmpdir(),'wpqa-profile-'));
  const entry={marker:'wpqa-12345678-1234-1234-1234-123456789abc',owner:3,site:config.baseURL,collection:'/wp-json/wp/v2/posts',id:7};
  const post={id:7,author:3,slug:entry.marker,title:{raw:entry.marker},content:{raw:entry.marker+'-v2'}};
  try{
    await journalIntent(runDir,entry);
    await assert.rejects(cleanupOwned({entry,runDir,config,profile:{writes:true},api:async(url,method)=>method==='DELETE'?{status:403,data:{}}:{status:200,data:url.includes('slug=')?[post]:post}}),/unconfirmed/);
    assert.equal((await readJournal(runDir))[0].state,'pending');
  }finally{await rm(runDir,{recursive:true,force:true});}
});

test('all wrappers export run; write wrappers reject production before browser launch',async()=>{
  const saved={WPQA_UI_PROFILE:process.env.WPQA_UI_PROFILE,WPQA_UI_ADMIN_STATE:process.env.WPQA_UI_ADMIN_STATE};
  Object.assign(process.env,env());
  try{
    for(const kind of ['inventory','contact-schema','post-lifecycle','scheduled']){
      const module=await import(`../builtin/wordpress-profile/${kind}.mjs`);
      assert.equal(typeof module.run,'function');
      if(['post-lifecycle','scheduled'].includes(kind))await assert.rejects(module.run({config:{...config,environment:'production'}}),/BLOCKED/);
    }
    await assert.rejects(runProfile('../../arbitrary.mjs',{config}),/unknown built-in/);
  }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
