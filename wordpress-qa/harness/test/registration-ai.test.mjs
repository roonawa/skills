import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {SystemSettings} from '../ui/system-settings.mjs';
import {startUI} from '../ui/server.mjs';
import {createSecretCodec} from '../ui/secret-codec.mjs';
for(const mode of ['normal','failure','evidence'])test(`registration auto-complements with Claude; mode=${mode}`,async()=>{
 const unavailable=mode==='failure';
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-register-ai-'));
 const state={cookies:[{domain:'example.test',path:'/',name:'wordpress_logged_in_fixture',value:'secret-cookie'}],origins:[]};
 const codec=createSecretCodec(randomBytes(32));new SystemSettings({directory:path.join(dir,'system'),codec}).save({apiKey:'sk-ant-fixture-only',enabled:true,approved:true,evidenceApproved:mode==='evidence'});
 let calls=0;
 const app=await startUI({port:0,storeDir:dir,credentialCodec:codec,loginOptions:{resume:{id:'login',baseURL:'https://example.test',environment:'production',phase:'verified',state}},registrationDiscovery:async()=>({pages:[{path:'/'}],types:[],plugins:[],warnings:[],authenticated:true,publicPasswordRequired:false,...(mode==='evidence'?{automation:{public:{forms:[{formId:1,path:'/contact/',fields:[{name:'company',type:'text',required:true},{name:'person',type:'text',required:true},{name:'mail',type:'email',required:true},{name:'body',type:'textarea',required:true}]}]}}}:{})}),aiOptions:{fetcher:async(url,opts)=>{
  calls++;if(unavailable)throw Error('service unavailable');
  const p=JSON.parse(JSON.parse(opts.body).messages[0].content);assert(!JSON.stringify(p).includes('secret-cookie'));
  if(p.version===1)return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({bindings:[{key:'contactNameField',formRef:'form-0',fieldRef:'field-1'}],selections:[]})}]}));
  return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({cases:p.pages.length?[{pageIndex:p.pages[0].index,targetIndex:-1,kind:'layout',viewport:'mobile',reason:'構造検査の追加'}]:[],questions:[],reviews:p.reviewTargets.map(t=>({...t,reason:'構造確認'}))})}]}));
 }}});
 try{
  const boot=await(await fetch(app.url+'/api/bootstrap')).json();
  const post=(p,data)=>fetch(app.url+p,{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify(data)});

  const response=await post('/api/registration',{name:'fixture',baseURL:'https://example.test',environment:'production',loginId:'login',profile:{timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false}});
  const result=await response.json();assert.equal(response.status,201,JSON.stringify(result));assert(calls>0);
  const saved=await(await fetch(app.url+`/api/projects/${result.id}/settings`)).json();assert.equal(saved.config.allowTestWrites,false);assert.equal(saved.credentials.browser,true);
  if(mode==='evidence'){assert.equal(saved.profile.contactNameField,'person');assert.equal(result.preparation.mode,'claude');assert.equal(result.preparation.bindings,1);}
  if(unavailable){assert.equal(result.aiPreparation,null);assert(result.warnings.some(w=>w.includes('完了しませんでした')));}
  else{assert(result.aiPreparation.reviewed>0);assert.equal(result.aiPreparation.added,1);assert(saved.profile.automation.additionalChecks.some(c=>c.id==='ai-layout-0-mobile'));}
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
