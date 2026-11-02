import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {startUI} from '../ui/server.mjs';
test('remove from list persists, retains files and rejects unsafe or busy requests',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-remove-')),file=path.join(dir,'site.json'),storeDir=path.join(dir,'store'),runs=path.join(dir,'runs');
 fs.mkdirSync(runs);fs.writeFileSync(file,JSON.stringify({name:'削除テスト',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:true}],journeys:[],visuals:[],outputDir:runs}));
 let app=await startUI({configPaths:[file],storeDir,port:0,credentialCodec:x=>x});
 try{
  const b=await(await fetch(app.url+'/api/bootstrap')).json(),p=b.projects[0],endpoint=app.url+'/api/projects/'+p.id+'/remove';
  const post=(data,auth=true)=>fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...(auth?{origin:app.url,'x-qa-token':b.token}:{})},body:JSON.stringify(data)});
  assert.equal((await post({confirmed:true,configHash:p.configHash},false)).status,403);
  assert.equal((await post({confirmed:false,configHash:p.configHash})).status,400);
  fs.writeFileSync(path.join(runs,'.qa-active-run.json'),JSON.stringify({parentPid:process.pid}));
  assert.equal((await post({confirmed:true,configHash:p.configHash})).status,409);
  fs.unlinkSync(path.join(runs,'.qa-active-run.json'));
  assert.equal((await post({confirmed:true,configHash:p.configHash})).status,200);
  assert.equal((await(await fetch(app.url+'/api/bootstrap')).json()).projects.length,0);
  assert(fs.existsSync(file));assert(fs.existsSync(runs));
  await app.close();app=await startUI({configPaths:[file],storeDir,port:0,credentialCodec:x=>x});
  assert.equal((await(await fetch(app.url+'/api/bootstrap')).json()).projects.length,0);
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});

import {ProjectStore} from '../ui/project-store.mjs';
test('managed site removal keeps encrypted credentials and results byte-for-byte',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-remove-managed-'));const store=new ProjectStore(dir,{codec:s=>'encrypted:'+s});
 const id=store.save({config:{name:'managed',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:true}],journeys:[],visuals:[]},auth:{browser:{cookies:[],origins:[]}}});
 const before=fs.readFileSync(store.file(id)),runs=store.context(id).outputDir;fs.mkdirSync(runs,{recursive:true});fs.writeFileSync(path.join(runs,'retained.txt'),'evidence');
 const app=await startUI({storeDir:dir,port:0,credentialCodec:s=>s});
 try{const boot=await(await fetch(app.url+'/api/bootstrap')).json();const r=await fetch(app.url+'/api/projects/'+id+'/remove',{method:'POST',headers:{origin:app.url,'x-qa-token':boot.token,'content-type':'application/json'},body:JSON.stringify({confirmed:true,configHash:boot.projects[0].configHash})});assert.equal(r.status,200);assert.deepEqual(fs.readFileSync(store.file(id)),before);assert.equal(fs.readFileSync(path.join(runs,'retained.txt'),'utf8'),'evidence');}finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
