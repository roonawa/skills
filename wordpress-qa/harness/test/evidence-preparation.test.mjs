import test from 'node:test';
import assert from 'node:assert/strict';
import {preparationEvidence,applyEvidenceDecision,requiredRegistrationInputs,unresolvedPreparation} from '../ui/evidence-preparation.mjs';
import {AiAssistant} from '../ui/ai-assistant.mjs';
const config={name:'private-name',baseURL:'https://private.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://private.test/',indexable:false}],checks:[{id:'coverage-navigation',title:'navigation',suite:'delivery',kind:'unconfigured',required:true,options:{instructions:'missing'}}]};
const profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false};
const discovery={authenticated:true,privateSecret:'do-not-send',automation:{observedAt:'2026-10-29',admin:{discussion:[{id:'comment_moderation',expected:true},{id:'admin_email',expected:'secret@example.test'}]},public:{search:{path:'/',actionPath:'/',formSelector:'form',inputSelector:'input[name=s]'},fieldLabels:[{formId:1,name:'company',label:'会社名'},{formId:1,name:'person',label:'お名前'}],forms:[{path:'/contact/',formId:1,formSelector:'form',submitSelector:'button',fields:[{name:'company',type:'text',required:true},{name:'person',type:'text',required:true},{name:'mail',type:'email',required:true},{name:'body',type:'textarea',required:true}]}]}}};
test('Claude can select only observed form controls, never invent selectors or replace an existing control',()=>{
 const d=structuredClone(discovery);delete d.automation.public.forms[0].submitSelector;
 d.automation.public.formControls=[{formId:1,path:'/contact/',selector:'input[name="confirm"]',label:'確認画面へ',type:'button'}];
 const e=preparationEvidence(config,profile,d);assert.equal(e.projection.forms[0].controls[0].label,'確認画面へ');assert(!JSON.stringify(e.projection).includes('input[name='));
 const r=applyEvidenceDecision(config,profile,d,{bindings:[],selections:[],controls:[{formRef:'form-0',controlRef:'control-0'}]});
 assert.equal(r.discovery.automation.public.forms[0].submitSelector,'input[name="confirm"]');
 assert.throws(()=>applyEvidenceDecision(config,profile,d,{bindings:[],selections:[],controls:[{formRef:'form-0',controlRef:'fake'}]}));
 assert.throws(()=>applyEvidenceDecision(config,profile,discovery,{bindings:[],selections:[],controls:[{formRef:'form-0',controlRef:'control-0'}]}));
});
test('only allowlisted observed structure and safe scalar settings leave the server',()=>{
 const e=preparationEvidence(config,profile,discovery),str=JSON.stringify(e.projection);assert(!str.includes('private'));assert(!str.includes('secret@example'));assert(!str.includes('do-not-send'));assert(str.includes('お名前'));assert(str.includes('comment_moderation'));assert.equal(e.local.candidates.length,1);
});
test('invalid semantic binding cannot discard independently valid observed controls or be silently applied',async()=>{
 const d=structuredClone(discovery);delete d.automation.public.forms[0].submitSelector;
 d.automation.public.formControls=[{formId:1,path:'/contact/',selector:'#send',label:'送信',type:'button'}];
 const settings={read:()=>({model:'fixture',evidenceApproved:true}),key:()=> 'synthetic',reserve(){}};
 const ai=new AiAssistant(settings,{fetcher:async()=>new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({bindings:[{key:'contactConsentField',formRef:'form-0',fieldRef:'field-0'}],controls:[{formRef:'form-0',controlRef:'control-0',nextControlRef:''}],selections:[]})}]}))});
 const r=await ai.resolveEvidence(config,profile,d);assert.equal(r.rejectedBindings,1);assert.equal(r.profile.contactConsentField,undefined);assert.equal(r.discovery.automation.public.forms[0].submitSelector,'#send');
});
test('evidence bindings compile existing pending case and fill ambiguous contact field without code generation',()=>{
 const e=preparationEvidence(config,profile,discovery),r=applyEvidenceDecision(config,profile,discovery,{selections:[e.local.candidates[0].ref],bindings:[{key:'contactNameField',formRef:'form-0',fieldRef:'field-1'}]});
 assert.equal(r.config.checks[0].kind,'discovered-public');assert.equal(r.profile.contactNameField,'person');assert.equal(r.profile.contactEmailField,'mail');assert.equal(r.profile.writes,false);assert.equal(r.config.checks[0].required,true);assert.equal(config.checks[0].kind,'unconfigured');
});
test('forged references, wrong field types, changed existing expectations, and multiple forms are rejected',()=>{
 const b={key:'contactNameField',formRef:'form-0',fieldRef:'field-1'};
 for(const decision of [{selections:['forged'],bindings:[]},{selections:[],bindings:[{...b,fieldRef:'field-2'}]},{selections:[],bindings:[{...b,key:'writes'}]},{selections:[],bindings:[b],code:'evil'}])assert.throws(()=>applyEvidenceDecision(config,profile,discovery,decision));
 assert.throws(()=>applyEvidenceDecision(config,{...profile,contactNameField:'company'},discovery,{selections:[],bindings:[b]}));
 const d=structuredClone(discovery);d.automation.public.forms.push({...d.automation.public.forms[0],formId:2,path:'/other/'});assert.throws(()=>applyEvidenceDecision(config,profile,d,{selections:[],bindings:[b]}));
 assert.equal(requiredRegistrationInputs({...profile,submit:true},d)[0].key,'contactFormId');
});
test('only unresolved business inputs are requested; permission and integration states stay distinct',()=>{
 assert.deepEqual(requiredRegistrationInputs(profile,discovery),[]);
 const required=requiredRegistrationInputs({...profile,submit:true,contactEmailField:'mail',contactMessageField:'body'},discovery);assert.equal(required.length,1);assert.equal(required[0].key,'contactNameField');assert.equal(required[0].choices[1].label,'お名前');
 assert.equal(unresolvedPreparation(config,profile)[0].category,'discovery');
});
test('Claude receives observed facts, outputs references only, and requires distinct evidence consent',async()=>{
 let sent=false;const settings={read:()=>({model:'fixture',evidenceApproved:true}),key:()=> 'synthetic',reserve(){}};
 const ai=new AiAssistant(settings,{fetcher:async(url,options)=>{sent=true;const body=JSON.parse(options.body),input=JSON.parse(body.messages[0].content);assert.equal(input.forms[0].fields[1].label,'お名前');assert.match(body.system,/selections MUST be/);assert.match(body.system,/existingBindings/);return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({bindings:[{key:'contactNameField',formRef:'form-0',fieldRef:'field-1'}],selections:['candidate-0']})}]}));}});
 const r=await ai.resolveEvidence(config,profile,discovery);assert.equal(r.mode,'claude');assert.equal(r.adopted,1);assert.equal(r.bindings,1);assert(sent);
 settings.read=()=>({evidenceApproved:false});sent=false;await assert.rejects(()=>ai.resolveEvidence(config,profile,discovery));assert.equal(sent,false);
});
