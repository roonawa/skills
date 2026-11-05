import test from 'node:test';import assert from 'node:assert/strict';import {contactImpactObservations} from '../lib/automatic-assessment.mjs';
const sample=()=>({area:'contact-retry',network:{forwardedWrites:0,feedbackAttempts:2},observations:[{schema:'wpqa-contact-impact-v1',delivery:'intercepted',scope:'single-form-network-failure',path:'/contact',formId:12,attempts:[1,2].map(attempt=>({attempt,requestBlocked:true,feedbackVisible:false,retryEnabled:true,inputsRetained:true,formVisible:true,reportedSuccess:false}))}]});
test('observed recoverable single-form failure is recorded as a contact feedback observation',()=>{
 const obs=contactImpactObservations(sample());assert.equal(obs.length,1);
 assert.equal(obs[0].key,'interaction:feedback-missing:/contact:12');assert.equal(obs[0].category,'contact-feedback');
});
test('no observation with missing repeats, lost data, success claim or forwarded writes',()=>{
 for(const change of [d=>d.observations[0].attempts.pop(),d=>d.observations[0].attempts[0].inputsRetained=false,d=>d.observations[0].attempts[0].reportedSuccess=true,d=>d.network.forwardedWrites=1,d=>delete d.network.feedbackAttempts]){
 const d=sample();change(d);assert.equal(contactImpactObservations(d).length,0);}
});
import {blockedRetryObservations} from '../lib/automatic-assessment.mjs';
test('a completed retry click without a request is recorded as a blocked retry observation',()=>{
 const d=sample();d.network.feedbackAttempts=1;d.observations[0].attempts.forEach((a,i)=>{a.clickCompleted=true;a.requestBlocked=i===0;});
 const obs=blockedRetryObservations(d);assert.equal(obs.length,1);
 assert.equal(obs[0].key,'interaction:retry-blocked:/contact:12');assert.equal(obs[0].category,'contact-retry-blocked');
 d.observations[0].attempts[1].clickCompleted=false;assert.equal(blockedRetryObservations(d).length,0);
});
test('malformed network observations are ignored',()=>{
 assert.deepEqual(blockedRetryObservations({area:'contact-retry',network:{forwardedWrites:0,feedbackAttempts:1},observations:'broken'}),[]);
});
