import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {startUI} from '../ui/server.mjs';
import {createSecretCodec} from '../ui/secret-codec.mjs';
import {hashPassword} from '../ui/shared-access.mjs';
import http from 'node:http';
const fetch=(url,options={})=>new Promise((resolve,reject)=>{const req=http.request(url,{method:options.method??'GET',headers:options.headers},res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(data),text:async()=>data}));});req.on('error',reject);req.end(options.body);});
test('system settings require admin and CSRF; keys never returned or audited; targets fail closed',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-ai-access-')),origin='https://qa.test',auditFile=path.join(dir,'audit.jsonl');
 const app=await startUI({port:0,storeDir:path.join(dir,'projects'),credentialCodec:createSecretCodec(randomBytes(32)),auditFile,systemOptions:{admins:['admin'],enforceEgress:true},shared:{origin,users:['admin','member'].map(name=>({name,...hashPassword('synthetic-password-long')}))}});
 try{
  async function client(name){const headers={Host:'qa.test',Authorization:'Basic '+Buffer.from(name+':synthetic-password-long').toString('base64')};const b=await(await fetch(app.url+'/api/bootstrap',{headers})).json();return {...headers,Origin:origin,'Content-Type':'application/json','X-QA-Token':b.token};}
  const admin=await client('admin'),member=await client('member');
  const body=JSON.stringify({apiKey:'sk-ant-fixture-only',enabled:true,approved:true,destinations:[{origin:'https://site.test'}]});
  const post=(route,headers,data=body)=>fetch(app.url+route,{method:'POST',headers,body:data});
  assert.equal((await post('/api/system/settings',member)).status,403);
  assert.equal((await post('/api/system/settings',{...admin,'X-QA-Token':'bad'})).status,403);
  const saved=await post('/api/system/settings',admin);assert.equal(saved.status,200);assert(!(await saved.text()).includes('sk-ant-fixture-only'));
  const view=await(await fetch(app.url+'/api/system/settings',{headers:member})).json();assert.equal(view.canEdit,false);assert.equal(view.configured,true);
  const blocked=await post('/api/logins',member,JSON.stringify({baseURL:'http://127.0.0.1',environment:'local',loginPath:'/'}));assert.equal(blocked.status,403);
  assert(!fs.readFileSync(auditFile,'utf8').includes('sk-ant-fixture-only'));
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
