import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createEvidence,redactor} from '../lib/evidence.mjs';
import {restoreDiagnostics,scopedFile} from '../lib/diagnostics.mjs';
test('failure evidence is immediately durable and masks credentials and filled data',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-evidence-'));
 const e=createEvidence({runDir:dir,check:{id:'contact',kind:'browser-flow'},config:{checks:[{options:{steps:[{action:'fill',value:'sensitive-message'}]}}]},env:{WPQA_UI_ADMIN_HEADERS:JSON.stringify({Authorization:'Basic abcxyz'}),WPQA_UI_ADMIN_STATE:JSON.stringify({cookies:[{value:'cookie-secret'}]})}});
 e.record({phase:'before',index:2,action:'click'});
 e.record({phase:'failure',error:new Error('sensitive-message cookie-secret Basic abcxyz https://host.test/?token=secret')});
 const text=fs.readFileSync(e.file,'utf8');for(const secret of ['sensitive-message','cookie-secret','abcxyz','token=secret'])assert(!text.includes(secret));
 assert.equal(text.trim().split('\n').length,3);assert.equal(e.summary().events[2].phase,'failure');
 assert.equal(redactor()({password:'pass',headers:{foo:'bar'}}).password,'[REDACTED]');
});
test('custom configured environment references redact message, stack, actual and expected',()=>{
 const clean=redactor({headersEnv:'MY_SITE_AUTH',checks:[{options:{roleEnv:'CUSTOM_ROLE',source:{headersEnv:'MAIL_AUTH'}}}]},{
  MY_SITE_AUTH:JSON.stringify({'X-API-Key':'custom-api-secret'}),
  CUSTOM_ROLE:JSON.stringify({cookies:[{value:'custom-cookie-secret'}],origins:[{localStorage:[{value:'custom-local-secret'}]}]}),
  MAIL_AUTH:JSON.stringify({Authorization:'custom-mail-secret'}),
 });
 const error=new Error('custom-api-secret custom-cookie-secret');
 error.actual='custom-local-secret';error.expected='custom-mail-secret';
 const result=clean(error),text=JSON.stringify(result);
 for(const secret of ['custom-api-secret','custom-cookie-secret','custom-local-secret','custom-mail-secret'])assert.ok(!text.includes(secret));
 assert.match(result.stack,/REDACTED/);
});
test('crashed worker journal restores diagnostics and only scoped artifact links',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-restore-'));
 try {
  fs.mkdirSync(path.join(dir,'diagnostics'));
  fs.writeFileSync(path.join(dir,'proof.txt'),'proof');
  fs.writeFileSync(path.join(dir,'diagnostics','flow.jsonl'),[
   JSON.stringify({phase:'start',kind:'browser-flow'}),
   JSON.stringify({kind:'artifact',file:'proof.txt'}),
   JSON.stringify({kind:'artifact',file:'../outside-secret.txt'}),
   '{"phase":"incomplete"',
  ].join('\n'));
  const row=restoreDiagnostics(dir,{id:'check.flow'});
  assert.equal(row.diagnostics.events.length,3);
  assert.deepEqual(row.evidence,['diagnostics/flow.jsonl','proof.txt']);
  assert.equal(restoreDiagnostics(dir,{id:'check.../outside'}).diagnostics,undefined);
  assert.throws(()=>scopedFile(dir,'../'));
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
