import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmationPlan,validateConfirmation,selectSingleTest} from '../lib/confirmation.mjs';
test('completed bank registration/cancellation do not imply delivered email',()=>{
 const plan=confirmationPlan({id:'manual.checkout-flow',manualReview:true,details:{adminFollowup:{registration:'verified',cancellation:'verified',orderId:'00001035'}}});
 assert.equal(plan.steps.find(s=>s.id==='registration').status,'pass');
 assert.equal(plan.steps.find(s=>s.id==='cleanup').status,'pass');
 assert.equal(plan.steps.find(s=>s.id==='mail').status,'review');
 assert.equal(plan.mode,'manual');
});
test('cannot certify incomplete or unsupported steps',()=>{
 const plan=confirmationPlan({id:'manual.design-review',manualReview:true});
 const data={reviewer:'tester',notes:'確認',steps:plan.steps.map(s=>({...s,status:'review',evidence:''})),finish:true};
 assert.throws(()=>validateConfirmation(plan,data),/未確認/);
 data.finish=false;assert.equal(validateConfirmation(plan,data).outcome,'review');
 data.steps[0].status='pass';assert.throws(()=>validateConfirmation(plan,data),/証拠/);
 data.steps[0].evidence='screen.png';data.steps.push({id:'forged',status:'pass',evidence:'x'});assert.throws(()=>validateConfirmation(plan,data),/手順/);
});
test('single-case selection never starts unrelated journeys or manual cases',()=>{
 const rows=[{id:'snapshot.home',selected:true},{id:'journey.order',selected:true},{id:'manual.foo',manualReview:true,selected:false}];
 selectSingleTest(rows,'snapshot.home');assert.deepEqual(rows.map(r=>r.selected),[true,false,false]);
 assert.throws(()=>selectSingleTest(rows,'manual.foo'),/手動/);
 assert.throws(()=>selectSingleTest(rows,'missing'),/見つかりません/);
});
