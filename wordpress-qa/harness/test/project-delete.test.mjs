import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ProjectStore} from '../ui/project-store.mjs';import {deletionPlan,deleteSiteData} from '../ui/project-removal.mjs';import {startUI} from '../ui/server.mjs';
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-delete-')),store=new ProjectStore(root,{codec:x=>x});
 const config={name:'削除対象',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:true}],journeys:[],visuals:[]};
 const id=store.save({config,auth:{browser:{cookies:[],origins:[]}}}),other=store.save({config:{...config,name:'残すサイト'}});
 const dir=path.join(root,id);fs.mkdirSync(path.join(dir,'runs','r'),{recursive:true});fs.writeFileSync(path.join(dir,'runs','r','results.json'),'{}');
 return {root,store,id,other,dir};
}
test('complete deletion requires matching name and fresh inventory, preserves other sites',()=>{
 const {root,store,id,other,dir}=setup();try{
 const p=deletionPlan(store,id);assert.equal(p.runs,1);
 assert.throws(()=>deleteSiteData(store,id,{name:'wrong',hash:p.hash}));
 fs.writeFileSync(path.join(dir,'new.txt'),'new');
 assert.throws(()=>deleteSiteData(store,id,{name:p.name,hash:p.hash}));
 const next=deletionPlan(store,id);deleteSiteData(store,id,next);
 assert(!fs.existsSync(store.file(id)));assert(!fs.existsSync(dir));assert(fs.existsSync(store.file(other)));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('outside output paths and directory links cannot be deleted',()=>{
 const {root,store,id,dir}=setup();const outside=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-keep-'));fs.writeFileSync(path.join(outside,'keep'),'safe');
 try{fs.symlinkSync(outside,path.join(dir,'linked'),'junction');assert.throws(()=>deletionPlan(store,id),/リンク/);fs.unlinkSync(path.join(dir,'linked'));
 const record=store.record(id);record.config.outputDir=outside;fs.writeFileSync(store.file(id),JSON.stringify(record));assert.throws(()=>deletionPlan(store,id),/専用/);assert.equal(fs.readFileSync(path.join(outside,'keep'),'utf8'),'safe');
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});
test('API preview and complete deletion persist across restart',async()=>{
 const {root,store,id,other,dir}=setup();let app=await startUI({storeDir:root,port:0,credentialCodec:x=>x});
 try{
 const boot=await(await fetch(app.url+'/api/bootstrap')).json(),p=boot.projects.find(p=>p.id===id);
 const preview=await(await fetch(app.url+'/api/projects/'+id+'/removal')).json();assert.equal(preview.canDelete,true);assert(!('targets' in preview));
 const post=data=>fetch(app.url+'/api/projects/'+id+'/remove',{method:'POST',headers:{origin:app.url,'x-qa-token':boot.token,'content-type':'application/json'},body:JSON.stringify({confirmed:true,configHash:p.configHash,mode:'delete',...data})});
 assert.equal((await post({name:'wrong',hash:preview.hash})).status,409);
 assert.equal((await post({name:preview.name,hash:preview.hash})).status,200);
 assert(!fs.existsSync(dir));assert(fs.existsSync(store.file(other)));
 await app.close();app=await startUI({storeDir:root,port:0,credentialCodec:x=>x});
 const after=await(await fetch(app.url+'/api/bootstrap')).json();assert(!after.projects.some(p=>p.id===id));
 }finally{await app.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('interrupted deletion retains site identity and can be retried',()=>{
 const {root,store,id,dir}=setup(),original=fs.rmSync;
 try{
  const plan=deletionPlan(store,id);let injected=false;
  fs.rmSync=(target,options)=>{if(target===dir&&!injected){injected=true;throw Error('simulated interruption');}return original(target,options);};
  assert.throws(()=>deleteSiteData(store,id,plan),/interruption/);assert(fs.existsSync(store.file(id)));
  fs.rmSync=original;const retry=deletionPlan(store,id);assert.equal(retry.interrupted,true);deleteSiteData(store,id,retry);assert(!fs.existsSync(store.file(id)));
 }finally{fs.rmSync=original;fs.rmSync(root,{recursive:true,force:true});}
});
