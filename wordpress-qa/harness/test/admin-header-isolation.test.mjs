import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
test('admin-only config needs no public headers; public audit still requires them',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-admin-'));
 try{for(const suite of ['admin','audit']){
 const file=path.join(dir,'context.json');fs.writeFileSync(file,JSON.stringify({config:{timeoutMs:1000,baseURL:'https://example.test',headersEnv:'QA_ABSENT_PUBLIC_HEADERS'},report:{rows:[{selected:true,suite}]},runDir:dir,baselineDir:dir}));
 const env={...process.env,WPQA_CONTEXT:file};delete env.QA_ABSENT_PUBLIC_HEADERS;
 const r=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(path.resolve('playwright.config.mjs')).href)})`],{env,encoding:'utf8'});
 if(suite==='admin')assert.equal(r.status,0,r.stderr);else {assert.notEqual(r.status,0);assert.match(r.stderr,/QA_ABSENT_PUBLIC_HEADERS missing/);}
 }}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
