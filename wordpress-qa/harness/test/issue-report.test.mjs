import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildIssueReport,selectReportRows,reproduction} from '../lib/issue-report.mjs';
const run=(runId,startedAt,rows,extra={})=>({runId,startedAt,finishedAt:startedAt,runStatus:'finished',configHash:'same',baseURL:'https://example.test',environment:'production',name:'QA',rows,...extra});
test('only matching rule and selector screenshots are embedded with reference fallback',()=>{
 const current=run('now','2026-01-01',[{id:'axe.pc',title:'PC',status:'fail',evidence:['axe.json','marked-screenshots.json','marked-001-hash.png','marked-002-hash.png']}]);
 const result=buildIssueReport({current,readEvidence:(_r,f)=>f==='axe.json'?{violations:[{id:'color-contrast',nodes:[{target:['#one'],html:'<p id="one">text</p>'}]}]}:{shots:[{id:'marked-001',number:1,rule:'color-contrast',target:['#one'],status:'captured'},{id:'marked-002',number:2,rule:'color-contrast',target:['#other'],status:'captured'}]},readImage:(_r,f)=>`data:image/png;base64,${f.includes('001')?'MATCH':'OTHER'}`});
 assert.match(result.html,/data:image\/png;base64,MATCH/);assert(!result.html.includes('base64,OTHER'));assert.match(result.html,/赤枠・番号1/);
});
test('reproduction uses historical page and viewport without inventing observed user-visible failures',()=>{
 const entry={run:run('old','2026-01-01',[]),row:{id:'javascript.guide-pc',title:'guide PC'},details:[{message:"Cannot read properties of null (reading 'style')"}]};
 const r=reproduction(entry,'javascript',{pages:[{id:'guide',path:'/shopguide'}],visuals:[{id:'guide-pc',pageId:'guide',width:1280,height:900}]});
 assert.match(r.condition,/https:\/\/example.test\/shopguide/);assert.match(r.condition,/1280px × 900px/);
 assert.match(r.actual,/reading 'style'/);assert.match(r.visible,/確認できません/);assert.match(r.limit,/厳密な時点は未特定/);
 const unknown=reproduction(entry,'journey');assert.match(unknown.limit,/自動推定していません/);
 const policy=reproduction({...entry,row:{id:'policy.missing'},details:[{status:302,errors:['302 != 404']}]},'policy',{policies:[{id:'missing',path:'/missing',statuses:[404]}]});
 assert.match(policy.expected,/HTTP 404/);assert.match(policy.actual,/302/);
});
test('history supplements only unexecuted cases from compatible earlier completed runs',()=>{
  const now=run('now','2026-02-01',[{id:'a',status:'pass'},{id:'b',status:'not_run'},{id:'c',status:'review'}]);
  const old=run('old','2026-01-01',[{id:'a',status:'fail'},{id:'b',status:'fail'},{id:'c',status:'fail'}]);
  const bad=run('bad','2026-01-31',[{id:'b',status:'pass'}],{configHash:'different'});
  const future=run('future','2026-03-01',[{id:'b',status:'pass'}]);
  assert.deepEqual(selectReportRows(now,[bad,future,old],true).map(x=>[x.row.status,x.run.runId]),[['pass','now'],['fail','old'],['review','now']]);
  assert.equal(selectReportRows(now,[old],false)[1].row.status,'not_run');
});
test('axe evidence is grouped by component with exact nodes preserved and HTML escaped',()=>{
  const rows=['pc','sp'].map(s=>({id:'axe.'+s,title:s,status:'fail',evidence:['axe.json']}));
  const result=buildIssueReport({current:run('now','2026-02-01',rows),readEvidence:()=>({url:'https://example.test/qa',violations:[{id:'color-contrast',impact:'serious',nodes:[{target:['.copyright'],html:'<p class="copyright">X</p>',failureSummary:'ratio 1.76'}]}]}),notes:'<script>alert(1)</script>'});
  assert.equal(result.issueCount,1);assert.equal(result.failedCases,2);
  assert.match(result.html,/ratio 1.76/);assert.match(result.html,/https:\/\/example.test\/qa/);
  assert(!result.html.includes('<script>'));assert.match(result.html,/&lt;script&gt;/);
});
test('JS failure never turns a passing layout into an issue; review and missing evidence stay explicit',()=>{
  const result=buildIssueReport({current:run('now','2026-02-01',[
    {id:'javascript.pc',title:'PC',status:'fail',evidence:['javascript.json']},
    {id:'layout.pc',status:'pass'}, {id:'snapshot.pc',status:'review'},
    {id:'axe.sp',title:'SP',status:'fail',reason:'timeout',evidence:['axe.json']}
  ]),readEvidence:(_id,file)=>{if(file==='axe.json')throw Error('missing');return {jsErrors:[{message:'jQuery is not defined',stack:'site:12'}]};}});
  assert.equal(result.issueCount,2);assert.equal(result.warnings.length,1);assert.equal(result.counts.review,1);
  assert.match(result.html,/原因未確認|原因は未確認/);assert(!result.html.includes('layout.pc'));
});
