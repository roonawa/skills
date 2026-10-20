import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {acquireRunLock,processAlive,runIsAlive,projectIsAlive,ownershipAlive} from '../lib/run-lock.mjs';
test('runner ownership survives UI restart and blocks parallel recovery or run',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qa-lock-')),one=path.join(root,'one'),two=path.join(root,'two');
 fs.mkdirSync(one);fs.mkdirSync(two);
 try {
  const lock=acquireRunLock(root,one);
  assert.equal(processAlive(process.pid),true);
  assert.equal(runIsAlive(one),true);assert.equal(projectIsAlive(root),true);
  assert.throws(()=>acquireRunLock(root,two),/another runner/);
  lock.worker(process.pid);
  assert.equal(JSON.parse(fs.readFileSync(path.join(one,'run-owner.json'))).workerPid,process.pid);
  lock.finish();
  assert.equal(projectIsAlive(root),false);
  const next=acquireRunLock(root,two);next.finish();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('dead parent with live worker remains owned; ambiguous spawn is conservative',()=>{
 assert.equal(ownershipAlive({parentPid:-1,workerPid:process.pid,phase:'running'}),true);
 assert.equal(ownershipAlive({parentPid:-1,workerPid:-1,phase:'running'}),false);
 assert.equal(ownershipAlive({parentPid:-1,workerPid:null,phase:'spawning'}),true);
 assert.equal(ownershipAlive({parentPid:process.pid,ended:true}),false);
});
test('empty selected suite disconnects IPC and exits instead of retaining an active UI job',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qa-empty-')),config=path.join(root,'site.json');
 fs.writeFileSync(config,JSON.stringify({name:'Empty suite',baseURL:'http://127.0.0.1',environment:'local',pages:[{id:'home',path:'/',canonical:'http://127.0.0.1/',indexable:false}],outputDir:path.join(root,'runs')}));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../bin/qa.mjs',import.meta.url)),'run','--config',config,'--suite','scheduled'],{stdio:['ignore','pipe','pipe','ipc']});
 let stderr='',timer;
 child.stderr.on('data',chunk=>stderr+=chunk);
 try {
  const code=await Promise.race([new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('CLI retained IPC after empty suite error')),10000);})]);
  assert.equal(code,2);assert.match(stderr,/No tests in selected suite/);
  assert.equal(projectIsAlive(path.join(root,'runs')),false);
 }finally{clearTimeout(timer);if(child.exitCode===null)child.kill();fs.rmSync(root,{recursive:true,force:true});}
});
