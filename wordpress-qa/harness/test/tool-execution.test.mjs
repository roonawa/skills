import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify,displayStatus} from '../lib/results.mjs';
import {groupRows} from '../lib/editor-report/causes.mjs';
import {collectIssues,isConfirmed} from '../lib/handoff-issues.mjs';
import {run} from '../lib/checks/standard.mjs';
import {buildEditorReport} from '../lib/editor-report/index.mjs';
import {enrichFailures} from '../lib/failure-explanations.mjs';

const reason='Error: "apiResponse.dispose: Target page, context or browser has been closed" while running route callback.';
test('route disposal failures are blocked, not site failures; ordinary assertions remain failures',()=>{
 assert.equal(classify({status:'failed',errors:[{message:reason}]},[]),'blocked');
 assert.equal(classify({status:'failed',errors:[{message:'Expected 200, received 500'}]},[]),'fail');
 assert.equal(classify({status:'failed',errors:[{message:reason},{message:'Expected 200, received 500'}]},[]),'fail');
});
test('old and new tool failures agree across display, report and handoff without changing stored rows',()=>{
 for(const status of ['fail','blocked']){
  const row={id:'check.auto-forms',status,reason,failures:[{key:'unclassified:forms',title:'unknown'}]};
  assert.equal(displayStatus(row),'blocked');
  assert.equal(isConfirmed(row),false);
  const {groups}=groupRows({rows:[row]});
  assert.equal(groups[0].category,'not-site');
  assert.equal(groups[0].rule,'tool-execution');
  assert.deepEqual(collectIssues({report:{rows:[row]}}),[]);
  assert.equal(row.status,status);
  const displayed=enrichFailures({rows:[row]},()=>null).rows[0];
  assert.equal(displayed.status,'blocked');
  assert.equal(displayed.failureOrigin,'tool');
  assert.deepEqual(displayed.failures,[]);
 }
});
test('tool-only report preserves evidence and asks for a rerun without AI or site requests',async()=>{
 const report={baseURL:'https://example.test',rows:[{id:'check.auto-performance',status:'fail',reason}]};
 const result=await buildEditorReport({report,ai:{writeEditorItems(){throw Error('AI must not be needed');}},client:{get(){throw Error('No site request');}}});
 assert.equal(result.aiCalls,0);
 assert.match(result.html,/検査ツールの通信終了処理のエラー/);
 assert.match(result.html,/診断担当がツールを修正して再検査/);
 assert.match(result.basisHtml,/apiResponse.dispose/);
 assert.equal(result.counts.fail,0);
 assert.equal(result.counts.unverified,1);
});
test('standard checks detach route callbacks before closing the context',async()=>{
 const events=[];
 const page={setDefaultTimeout(){},async goto(){return {ok:()=>true};},url:()=> 'https://example.test/',async evaluate(){return {durationMs:1};},async reload(){}};
 const context={async route(){},async newPage(){return page;},async unrouteAll(options){assert.equal(options.behavior,'ignoreErrors');events.push('drained');},async close(){events.push('closed');assert.equal(events.at(-2),'drained');}};
 await run({check:{kind:'standard-public',suite:'performance',options:{area:'performance',paths:['/']}},config:{baseURL:'https://example.test'},browser:{async newContext(){return context;}},requestFactory:{async newContext(){return {async dispose(){}};}}});
 assert.deepEqual(events,['drained','closed']);
});
