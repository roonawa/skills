import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {startUI} from '../ui/server.mjs';
test('registration HTTP failure exposes matching safe diagnostic ID and durable stage log',async()=>{
 const storeDir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-diagnostic-'));const app=await startUI({port:0,storeDir});
 try{
  const boot=await (await fetch(app.url+'/api/bootstrap')).json();const r=await fetch(app.url+'/api/registration',{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify({profile:{},publicPassword:'never-log-this'})});const result=await r.json();
  assert.equal(r.status,400);assert.equal(result.stage,'input');assert.ok(result.diagnosticId);assert.match(result.error,/入力チェック/);
  const log=fs.readFileSync(path.join(storeDir,'registration-events.jsonl'),'utf8');assert.ok(log.includes(result.diagnosticId));assert(!log.includes('never-log-this'));
 }finally{await app.close();fs.rmSync(storeDir,{recursive:true,force:true});}
});
