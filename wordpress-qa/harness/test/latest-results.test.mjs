import test from 'node:test';import assert from 'node:assert/strict';
import {latestResults} from '../lib/latest-results.mjs';
const planned=[{id:'a',title:'A'},{id:'b',title:'B'},{id:'c',preparationRequired:true}];
const run=(id,rows,extra={})=>({runId:id,startedAt:id,finishedAt:id,runStatus:'finished',configHash:'same',rows,...extra});
test('partial reruns replace only observed cases, preserving provenance and inputs',()=>{
 const reports=[run('1',[{id:'a',status:'fail'},{id:'b',status:'pass'}]),run('2',[{id:'a',status:'pass'},{id:'b',status:'not_run'}])];const before=JSON.stringify(reports);
 const r=latestResults(planned,'same',reports);assert.equal(r.rows[0].sourceRunId,'2');assert.equal(r.rows[1].sourceRunId,'1');assert.equal(r.rows[2].status,'preparation');assert.equal(JSON.stringify(reports),before);
});
test('config changes, incomplete runs and synthetic summaries cannot clear known failures',()=>{
 const reports=[run('1',[{id:'a',status:'fail'}]),run('2',[{id:'a',status:'pass'}],{configHash:'old'}),run('3',[{id:'a',status:'pass'}],{runStatus:'interrupted'}),run('4',[{id:'a',status:'pass'}],{sourceRuns:['1']})];
 assert.equal(latestResults(planned,'same',reports).rows[0].status,'fail');assert.equal(latestResults(planned,'new',reports).rows[0].status,'not_run');
});
test('new blocked observations supersede old passes; unselected placeholders do not',()=>{
 const r=latestResults(planned,'same',[run('1',[{id:'a',status:'pass'},{id:'b',status:'fail'}]),run('2',[{id:'a',status:'blocked',selected:true},{id:'b',status:'review',selected:false}])]);
 assert.equal(r.rows[0].status,'blocked');assert.equal(r.rows[1].status,'fail');
});
