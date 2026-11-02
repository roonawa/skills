import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceGapInput,validateGapPlans,attachGapPlans} from '../lib/evidence-gaps.mjs';
import {AiAssistant} from '../ui/ai-assistant.mjs';
const issue=n=>({id:'issue-'+n,key:'javascript:secret-message',kind:'javascript',certainty:'pending',pendingCategory:'evidence-insufficient',cases:[{id:'check.read',title:'SECRET title',evidenceState:{'secret/path':{available:true}},observations:[]},{id:'check.write',evidenceState:{}}]});
const config={checks:[{id:'read',kind:'metadata'},{id:'write',kind:'custom'}]};
const exam={fingerprint:'fp',issues:[issue(0)]};
const plan=index=>({index,missingAxes:['impact','conditions','scope'],reason:'例外だけでは利用者の操作への影響を特定できません。',verification:'失敗した操作と期待する結果、実際の結果を照合してください。',caseRefs:[]});
test('projection excludes raw evidence, messages, titles, paths and unknown code; only known readers are rerunPermitted',()=>{
 const input=evidenceGapInput(exam,config),text=JSON.stringify(input);
 assert(!/SECRET|secret|javascript:/.test(text));assert.equal(input[0].cases[0].rerunPermitted,true);assert.equal(input[0].cases[1].rerunPermitted,false);
 for(const mutate of [p=>({...p,caseRefs:[1]}),p=>({...p,index:99}),p=>({...p,scores:[5,5,4]}),p=>({...p,caseRefs:[0,0]}),p=>({...p,missingAxes:['arbitrary']})])assert.throws(()=>validateGapPlans({plans:[mutate(plan(0))]},input,exam.issues));
 assert.throws(()=>validateGapPlans({plans:[]},input,exam.issues));
 assert.equal(validateGapPlans({plans:[plan(0)]},input,exam.issues)[0].observed,false);
});
test('all pending entries are processed across batches without truncation; unknown categories retain a plan',async()=>{
 const many={fingerprint:'fp',issues:Array.from({length:43},(_,n)=>({...issue(n),kind:n===42?'future-kind':'javascript'}))};let calls=0,reserves=0;
 const settings={read:()=>({evidenceApproved:true,model:'claude-fixture'}),key:()=> 'fixture',reserve:()=>reserves++};
 const ai=new AiAssistant(settings,{fetcher:async(url,opts)=>{calls++;assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(opts.redirect,'error');const input=JSON.parse(JSON.parse(opts.body).messages[0].content);assert(input.length<=20);return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({plans:input.map(i=>plan(i.index))})}]}));}});
 const result=await ai.completeAssessmentEvidence(many,config);assert.equal(result.plans.length,43);assert.equal(calls,3);assert.equal(reserves,3);assert.equal(result.plans[42].issueId,'issue-42');
 const attached=attachGapPlans(many,result);assert(attached.issues.every(i=>i.certainty==='pending'&&!i.scores&&i.evidenceGap));assert.equal(attachGapPlans({...many,fingerprint:'changed'},result).evidenceCompletion,undefined);
 assert.equal(attachGapPlans({...many,version:'new-manual-assessment'},result).evidenceCompletion,undefined);
});
test('missing consent and malformed Claude responses cannot modify evidence or produce a partial successful record',async()=>{
 let requests=0;const settings={read:()=>({evidenceApproved:false}),key:()=> 'fixture',reserve(){}};
 const ai=new AiAssistant(settings,{fetcher:async()=>{requests++;return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:'{"plans":[]}'}]}));}});
 await assert.rejects(()=>ai.completeAssessmentEvidence(exam,config));assert.equal(requests,0);
 settings.read=()=>({evidenceApproved:true,model:'fixture'});await assert.rejects(()=>ai.completeAssessmentEvidence(exam,config));assert.equal(ai.busy,false);assert.equal(exam.issues[0].certainty,'pending');
});
