import test from 'node:test';import assert from 'node:assert/strict';import {collectExamEvidence} from '../lib/exam-evidence.mjs';
test('large screenshots never exhaust capacity before later structured evidence',()=>{
 const report={rows:[{id:'first',evidence:Array.from({length:9},(_,i)=>'image'+i+'.png')},{id:'last',evidence:['audit.json']}]};
 const r=collectExamEvidence(report,f=>f==='audit.json'?Buffer.from('{"errors":["canonical differs from expectation"]}'):Buffer.alloc(8*1024*1024)).report;
 assert.equal(r.rows[1].evidenceState['audit.json'].available,true);assert.equal(r.rows[1].assessmentObservations.length,1);
});
