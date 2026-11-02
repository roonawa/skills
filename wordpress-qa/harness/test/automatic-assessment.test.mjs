import {test} from 'node:test';import assert from 'node:assert/strict';
import {collectExamEvidence} from '../lib/exam-evidence.mjs';import {enrichFailures} from '../lib/failure-explanations.mjs';import {buildExam,validateExamItems,customerExamHtml} from '../lib/site-exam.mjs';
function assess(data,missing=false){const report={runId:'r',runStatus:'finished',finishedAt:'now',rows:[{id:'page.home',title:'home',status:'fail',evidence:['audit.json']}]};return collectExamEvidence(enrichFailures(report,()=>data),()=>{if(missing)throw Error();return Buffer.from(JSON.stringify(data));}).report;}
test('structured violations do not imply low impact or limited scope',()=>{
 const r=assess({errors:['canonical differs from expectation']}),e=buildExam(r),i=e.issues[0];assert.equal(i.certainty,'pending');assert.equal(i.score,null);assert.equal(i.proofs[0].file,'audit.json');assert.equal(i.reviewed,false);assert.equal(e.confirmedMaximum,null);assert(customerExamHtml(r,e).includes('評価未完了'));
});
test('missing evidence and unknown errors stay pending with actionable reason',()=>{
 for(const r of [assess({errors:['canonical differs from expectation']},true),assess({errors:['unknown issue']})]){const i=buildExam(r).issues[0];assert.equal(i.score,null);assert(i.pendingReason.includes('確認'));}
});
test('automatic scores cannot become confirmed by changing certainty alone',()=>{
 const e=buildExam(assess({errors:['title differs from expectation or is empty']}));const {id,scores,reasons,impact,action,source,proofs,steps,expected,observed,summary}=e.issues[0];
 assert.throws(()=>validateExamItems([{id,scores,reasons,impact,action,source,proofs,steps,expected,observed,summary,scores:[2,3,2],reasons:['根拠を追加して確認します','別の根拠を追加して確認します','範囲の根拠を追加して確認します'],certainty:'confirmed',reviewed:false}],e),/確定/);
});
test('saved manual evaluations override automatic values and new evidence invalidates old assessment',()=>{
 const r=assess({errors:['canonical differs from expectation']}),e=buildExam(r),i=e.issues[0];const saved={fingerprint:e.fingerprint,items:[{id:i.id,scores:[1,1,1],certainty:'provisional'}]};
 assert.equal(buildExam(r,saved).issues[0].score,1);
 r.rows[0].evidenceState['audit.json'].digest='changed';assert.equal(buildExam(r,saved).stale,true);
});
test('axe without nodes is not evidence for an automated score',()=>{
 const r={runId:'r',rows:[{id:'axe.a',status:'fail',evidence:['axe.json']}]};
 for(const nodes of [[],[{}]]){const d={violations:[{id:'label',nodes}]};const e=buildExam(collectExamEvidence(enrichFailures(r,()=>d),()=>Buffer.from(JSON.stringify(d))).report);assert.equal(e.issues[0].certainty,'pending');}
});

test('unresolved security remains prominent even without fail-status issues',()=>{
 const report={runId:'security',rows:[{id:'check.security-core',status:'review',title:'WP'}]};
 const e=buildExam(report);assert.equal(e.unresolvedSecurity,1);assert(e.warning.includes('セキュリティ'));assert(customerExamHtml(report,e).includes('評価未完了'));
});
test('missing files and unsupported rules are distinct',()=>{
 assert.equal(buildExam(assess({errors:['canonical differs from expectation']},true)).issues[0].pendingCategory,'evidence-missing');
 const r={runId:'x',rows:[{id:'x',status:'fail',evidence:['axe.json']}]},d={violations:[{id:'unsupported-rule',nodes:[{}]}]};
 const e=buildExam(collectExamEvidence(enrichFailures(r,()=>d),()=>Buffer.from(JSON.stringify(d))).report);
 assert.equal(e.issues[0].pendingCategory,'rule-unsupported');
});
