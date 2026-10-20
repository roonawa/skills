import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeReport} from '../lib/results.mjs';
test('temporary Windows destination lock retries without losing the result',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-write-'));
  const original=fs.renameSync;let attempts=0;
  try{
    fs.renameSync=(...args)=>{if(++attempts<=2)throw Object.assign(new Error('locked'),{code:'EPERM'});return original(...args);};
    writeReport(directory,{rows:[{id:'admin.x',status:'pass',required:true}],errors:[],runStatus:'finished'});
    assert.equal(attempts,3);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'results.json'),'utf8')).gatePassed,true);
  }finally{fs.renameSync=original;fs.rmSync(directory,{recursive:true,force:true});}
});
test('interrupted or pending recovery can never produce a successful release gate',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-gate-'));
 try{
  const report={rows:[{id:'check.x',status:'pass',required:true,diagnostics:{events:[{phase:'failure'}]}}],errors:[],runStatus:'interrupted'};
  writeReport(directory,report);assert.equal(report.gatePassed,false);
  report.runStatus='finished';report.recovery={pending:1};
  writeReport(directory,report);assert.equal(report.gatePassed,false);
  assert(fs.readFileSync(path.join(directory,'report.html'),'utf8').includes('実行経過・失敗時の証拠'));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
