import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createSecretCodec} from '../ui/secret-codec.mjs';
import {createSharedAccess,hashPassword} from '../ui/shared-access.mjs';
import {startUI} from '../ui/server.mjs';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProjectStore} from '../ui/project-store.mjs';
const request=(url,options={})=>new Promise((resolve,reject)=>{
 const req=http.request(url,{method:options.method??'GET',headers:options.headers},res=>{
  let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(data)}));
 });req.on('error',reject);req.end(options.body);
});

test('portable secrets are authenticated, randomized and fail closed',()=>{
 const key=randomBytes(32),codec=createSecretCodec(key),secret='cookie-and-password';
 const encrypted=codec(secret);assert(!encrypted.includes(secret));assert.notEqual(encrypted,codec(secret));assert.equal(codec(encrypted,true),secret);
 assert.throws(()=>createSecretCodec(randomBytes(32))(encrypted,true));
 const parts=encrypted.split('.');parts[2]=randomBytes(16).toString('base64');assert.throws(()=>codec(parts.join('.'),true));
 assert.throws(()=>createSecretCodec(Buffer.alloc(8)));assert.throws(()=>codec('unsealed',true));
});
test('shared gate requires per-user auth, exact origin and stable CSRF identity',()=>{
 const access=createSharedAccess({origin:'https://qa.example.test',users:[{name:'alice',...hashPassword('a-long-random-pilot-password')} ]});
 const req={headers:{host:'qa.example.test',authorization:'Basic '+Buffer.from('alice:a-long-random-pilot-password').toString('base64')}};
 const a=access.authenticate(req);assert.equal(a.name,'alice');assert.equal(a.token,access.authenticate(req).token);
 assert.throws(()=>access.authenticate({headers:{host:'qa.example.test'}}));
 assert.throws(()=>access.authenticate({headers:{...req.headers,host:'evil.test'}}));
 assert.throws(()=>access.authenticate({headers:{...req.headers,authorization:'Basic '+Buffer.from('alice:wrong').toString('base64')}}));
 assert.throws(()=>createSharedAccess({origin:'http://qa.example.test',users:[]}));
});
test('shared server protects HTML, bootstrap and evidence; blocks server-local login',async()=>{
 const shared={origin:'https://qa.example.test',users:[{name:'alice',...hashPassword('a-long-random-pilot-password')}]};
 const app=await startUI({port:0,shared,credentialCodec:createSecretCodec(randomBytes(32))});
 const headers={Host:'qa.example.test',Authorization:'Basic '+Buffer.from('alice:a-long-random-pilot-password').toString('base64')};
 try{
  for(const route of ['/','/api/bootstrap','/api/projects/x/runs/y/files?path=report.html'])assert.equal((await request(app.url+route,{headers:{Host:'qa.example.test'}})).status,401);
  const boot=await(await request(app.url+'/api/bootstrap',{headers})).json();assert.equal(boot.shared,true);assert.equal(boot.user,'alice');assert.equal(boot.browserLogin,false);
  assert.equal((await request(app.url+'/api/bootstrap',{headers:{...headers,Host:'evil.test'}})).status,403);
  const postHeaders={...headers,'Content-Type':'application/json',Origin:shared.origin,'X-QA-Token':boot.token};
  assert.equal((await request(app.url+'/api/logins',{method:'POST',headers:postHeaders,body:'{}'})).status,409);
  assert.equal((await request(app.url+'/api/%6cogins',{method:'POST',headers:postHeaders,body:'{}'})).status,409);
  assert.equal((await request(app.url+'/api/logins',{method:'POST',headers:{...postHeaders,Origin:'https://evil.test'},body:'{}'})).status,403);
 }finally{await app.close();}
});

test('shared registration persists encrypted credentials, audits actor and survives restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-pilot-')),codec=createSecretCodec(randomBytes(32));
 const options={port:0,storeDir:path.join(dir,'projects'),auditFile:path.join(dir,'audit.jsonl'),credentialCodec:codec,shared:{origin:'https://qa.example.test',users:[{name:'alice',...hashPassword('a-long-random-pilot-password')},{name:'bob',...hashPassword('another-long-random-password')}]}};
 let app=await startUI(options);
 const headers={Host:'qa.example.test',Authorization:'Basic '+Buffer.from('alice:a-long-random-pilot-password').toString('base64')};
 try{
  const boot=await(await request(app.url+'/api/bootstrap',{headers})).json();
  const bob=await(await request(app.url+'/api/bootstrap',{headers:{...headers,Authorization:'Basic '+Buffer.from('bob:another-long-random-password').toString('base64')}})).json();assert.notEqual(boot.token,bob.token);
  const payload={config:{name:'Shared site',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:false}],journeys:[],visuals:[],admin:[]},auth:{rest:{username:'wp-test',password:'private-wp-secret'}}};
  const postHeaders={...headers,Origin:options.shared.origin,'X-QA-Token':boot.token,'Content-Type':'application/json'};
  assert.equal((await request(app.url+'/api/projects',{method:'POST',headers:{...postHeaders,'X-QA-Token':bob.token},body:JSON.stringify(payload)})).status,403);
  const response=await request(app.url+'/api/projects',{method:'POST',headers:postHeaders,body:JSON.stringify(payload)});assert.equal(response.status,201);const {id}=await response.json();
  const disk=fs.readFileSync(path.join(dir,'projects',id+'.json'),'utf8');assert(!disk.includes('private-wp-secret'));assert(!disk.includes('wp-test'));
  const settings=await(await request(app.url+`/api/projects/${id}/settings`,{headers})).json();assert.equal(settings.credentials.rest,true);assert(!JSON.stringify(settings).includes('private-wp-secret'));
  const audit=fs.readFileSync(path.join(dir,'audit.jsonl'),'utf8');assert(audit.includes('alice'));assert(!audit.includes('private-wp-secret'));assert(!audit.includes('Authorization'));
  await app.close();app=await startUI(options);
  const restored=await(await request(app.url+'/api/bootstrap',{headers})).json();assert.equal(restored.projects[0].id,id);
  const store=new ProjectStore(options.storeDir,{codec});assert.equal(JSON.parse(codec(store.record(id).sealed,true)).rest.password,'private-wp-secret');
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});

