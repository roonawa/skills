import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startUI} from '../ui/server.mjs';
import {ProjectStore} from '../ui/project-store.mjs';

test('registration saves role credentials through encrypted store, rejects invalid roles and keeps secrets out of profile/logs',{skip:process.platform!=='win32'},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-register-role-'));
 const state={cookies:[{domain:'example.test',path:'/',name:'wordpress_logged_in_fixture',value:'private-admin-cookie'}],origins:[]};
 const role={name:'subscriber',rest:{username:'member',password:'private-role-password'},browser:{cookies:[{domain:'example.test',path:'/',name:'member-session',value:'private-role-cookie'}],origins:[]}};
 const app=await startUI({port:0,storeDir:dir,loginOptions:{resume:{id:'resumed-login',baseURL:'https://example.test',environment:'production',phase:'verified',state}},registrationDiscovery:async()=>({pages:[{path:'/'}],types:[],plugins:[],warnings:[],authenticated:true,publicPasswordRequired:false})});
 try{
  const boot=await (await fetch(app.url+'/api/bootstrap')).json();
  const input={name:'Role registration',baseURL:'https://example.test',environment:'production',loginId:'resumed-login',profile:{timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false},roleCredentials:[role]};
  const post=body=>fetch(app.url+'/api/registration',{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const invalid=await post({...input,roleCredentials:[{...role,name:'INVALID'}]});assert.equal(invalid.status,400);assert(!JSON.stringify(await invalid.json()).includes('private-role-'));
  const response=await post(input),result=await response.json();assert.equal(response.status,201,JSON.stringify(result));assert(!JSON.stringify(result).includes('private-role-'));
  const store=new ProjectStore(dir),record=store.record(result.id);
  assert.deepEqual(record.credentials.roles,{subscriber:{rest:true,browser:true}});assert.equal(record.config.allowTestWrites,false);assert.equal(record.profile.writes,false);
  assert.equal(Object.hasOwn(record.profile,'roleCredentials'),false);assert(!JSON.stringify(record).includes('private-role-'));assert(!record.sealed.includes('private-admin-cookie'));
  const env=store.prepare(result.id).env;assert.deepEqual(JSON.parse(env.WPQA_ROLE_SUBSCRIBER_STATE),role.browser);
  assert.equal(JSON.parse(env.WPQA_ROLE_SUBSCRIBER_HEADERS).Authorization,'Basic '+Buffer.from('member:private-role-password').toString('base64'));
  const log=fs.readFileSync(path.join(dir,'registration-events.jsonl'),'utf8');assert(!log.includes('private-role-'));assert(!log.includes('private-admin-cookie'));assert(!log.includes('roleCredentials'));
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
