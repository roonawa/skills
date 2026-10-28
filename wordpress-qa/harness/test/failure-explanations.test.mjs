import {test} from 'node:test';
import assert from 'node:assert/strict';
import {explainFailure,enrichFailures} from '../lib/failure-explanations.mjs';
test('admin settings and hidden form feedback have actionable Japanese guidance',()=>{
 assert.match(explainFailure({id:'admin.indexing',status:'fail',setting:{expected:true,actual:false}})[0].admin,/設定 → 表示設定/);
 assert.equal(explainFailure({id:'any-site',status:'fail',reason:'wpcf7-response-output hidden Timeout'})[0].key,'cf7:feedback-hidden');
 assert.equal(explainFailure({id:'old',status:'fail'},[{errors:{},jsErrors:42,violations:[null]}]).length,1);
});
test('same indexability mismatch groups across sites and retains direction',()=>{
 const a=explainFailure({id:'page.a',status:'fail'},[{errors:['indexable differs from expectation (false)']}]);
 const b=explainFailure({id:'page.b',status:'fail'},[{errors:['indexable differs from expectation (false)']}]);
 const c=explainFailure({id:'page.c',status:'fail'},[{errors:['indexable differs from expectation (true)']}]);
 assert.equal(a[0].key,b[0].key);assert.notEqual(a[0].key,c[0].key);assert.match(a[0].admin,/オン/);assert.match(c[0].admin,/オフ/);
});
test('all mismatches retained; unknown cases and timeouts not conflated',()=>{
 assert.equal(explainFailure({status:'fail'},[{errors:['title differs from expectation or is empty','canonical differs from expectation']}]).length,2);
 assert.notEqual(explainFailure({id:'a',status:'fail',reason:'Timeout'})[0].key,explainFailure({id:'b',status:'fail',reason:'Timeout'})[0].key);
 assert.match(explainFailure({id:'x',status:'fail'})[0].title,/追加確認/);
});
test('structured javascript and accessibility evidence; pass unchanged',()=>{
 assert.equal(explainFailure({status:'fail'},[{jsErrors:[{message:'bad'}],violations:[{id:'link-name'}]}]).length,2);
 assert.deepEqual(explainFailure({status:'pass'}),[]);
});
test('old or missing artifacts gracefully fall back without altering verdict',()=>{
 const report={rows:[{id:'a',status:'fail',evidence:['artifacts/a/attachments/audit-x.json']}]};
 const out=enrichFailures(report,()=>{throw Error('missing');});
 assert.equal(out.rows[0].status,'fail');assert.equal(out.rows[0].failures.length,1);assert.equal(report.rows[0].failures,undefined);
 const actual=enrichFailures(report,()=>({errors:['indexable differs from expectation (false)']}));assert.equal(actual.rows[0].failures[0].key,'indexable:false');
});
