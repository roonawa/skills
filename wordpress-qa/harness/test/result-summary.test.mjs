import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resultStatus,countResults,executionScope} from '../ui/public/result-summary.js';
import {groupRows} from '../lib/editor-report/causes.mjs';
import {renderEditorReport} from '../lib/editor-report/render.mjs';
import {latestResults} from '../lib/latest-results.mjs';

test('each row counts once, including preparation and tool errors',()=>{
 const rows=[{id:'pass',status:'pass'},{id:'warn',status:'fail',level:'caution'},
  {id:'prep',status:'review',preparationRequired:true},{id:'manual',status:'review'},
  {id:'blocked',status:'blocked'},{id:'waiting',status:'not_run'},
  {id:'na',status:'not_run',autoNotApplicable:true},
  {id:'tool',status:'fail',failureOrigin:'tool'}];
 const counts=countResults(rows);
 assert.equal(counts.unverified,5);
 assert.equal(counts.review,1);
 assert.equal(counts.preparation,1);
 assert.equal(counts.fail,0);
 assert.equal(counts.caution,1);
 assert.equal(counts.not_applicable,1);
 assert.equal(rows.map(resultStatus).filter(x=>x==='blocked').length,2);
 assert.equal(groupRows({rows}).counts.unverified,counts.unverified);
});
test('partial selection is explicit; old runs can only infer selected scope',()=>{
 const rows=[{id:'a',selected:true},{id:'b',selected:false}];
 assert.deepEqual(executionScope({rows,selection:{ids:['a'],parentRunId:'old'}}),{partial:true,count:1,parentRunId:'old',explicit:true});
 assert.equal(executionScope({rows}).partial,true);
 assert.equal(executionScope({rows:[{id:'a'}]}).partial,false);
 assert.equal(executionScope({rows:[{id:'a',selected:true},{id:'manual',selected:false,manualReview:true}]}).partial,false);
});
test('report headings start at one and timestamps use Japan time',()=>{
 const html=renderEditorReport({site:{name:'Test'},runId:'run',startedAt:'2026-11-16T01:52:34.378Z',checkedAt:'2026-11-16T02:00:00Z',groups:[],items:[],counts:{fail:0,caution:0,unverified:5,notApplicable:0}});
 assert.match(html,/<h2>1\. ひとことで言うと/);
 assert.match(html,/2026年11月16日 10:52/);
 assert.match(html,/未確認 5件/);
});
test('site-wide latest results preserve the tool-error classification of old runs',()=>{
 const row={id:'a',status:'fail',failureOrigin:'tool',selected:true};
 const result=latestResults([{id:'a'}],'hash',[{configHash:'hash',runStatus:'finished',runId:'old',finishedAt:'2026-11-16T00:00:00Z',rows:[row]}]);
 assert.equal(result.rows[0].status,'blocked');assert.equal(result.counts.blocked,1);
 assert.equal(row.status,'fail');
});
