import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {SystemSettings} from '../ui/system-settings.mjs';
import {AiAssistant,aiProjection,validateProposal} from '../ui/ai-assistant.mjs';
import {createSecretCodec} from '../ui/secret-codec.mjs';
import {resolveDestination,addressClass,validateDestinations} from '../lib/egress-policy.mjs';
const config={name:'private-name',baseURL:'https://private.example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://private.example.test/',indexable:false}],checks:[]};
const candidate={cases:[{pageIndex:0,targetIndex:-1,kind:'layout',viewport:'mobile',reason:'スマホの横はみ出し検査を追加します'}],questions:[]};
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-ai-'));const settings=new SystemSettings({directory:dir,policyFile:path.join(dir,'policy.json'),codec:createSecretCodec(randomBytes(32))});settings.save({apiKey:'sk-ant-fixture-only',enabled:true,approved:true,dailyLimit:2,destinations:[]});return {dir,settings};}
test('AI sends only structural data, fixed endpoint, Claude Messages protocol; compiles read-only candidates',async()=>{
 const {dir,settings}=fixture();try{
  assert(!fs.readFileSync(settings.file,'utf8').includes('sk-ant-fixture-only'));assert(!JSON.stringify(settings.view()).includes('sk-ant-fixture-only'));
  const ai=new AiAssistant(settings,{fetcher:async(url,options)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(options.redirect,'error');const b=JSON.parse(options.body);assert.equal(options.headers['x-api-key'],'sk-ant-fixture-only');assert.equal(options.headers['anthropic-version'],'2023-06-01');assert.equal(options.headers.Authorization,undefined);assert.equal(b.store,undefined);assert.equal(b.output_config.format.type,'json_schema');assert(!b.messages[0].content.includes('private'));return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({...candidate,reviews:JSON.parse(b.messages[0].content).reviewTargets.map(x=>({...x,reason:"構造確認。期待値の妥当性は別途照合"}))})}]}));}});
  const p=await ai.propose(config,{},'alice');assert.throws(()=>ai.apply(p.id,config,[0],'bob'));assert.throws(()=>ai.apply(p.id,{...config,name:'changed'},[0],'alice'));
  const result=ai.apply(p.id,config,[0],'alice');assert.equal(result.config.checks[0].kind,'compatibility-screen');assert.equal(result.config.checks[0].options.viewport.width,390);assert.equal(result.config.allowTestWrites,false);assert.throws(()=>ai.apply(p.id,config,[0],'alice'));
  await ai.propose(config);await assert.rejects(()=>ai.propose(config));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('AI rejects executable operations, unknown fields and absent expectations',()=>{
 assert.throws(()=>validateProposal({...candidate,script:'code'},config));assert.throws(()=>validateProposal({cases:[{...candidate.cases[0],kind:'order'}],questions:[]},config));
 assert.throws(()=>aiProjection(config,{maxLoadMs:-1}));
 assert.throws(()=>validateProposal({cases:[{...candidate.cases[0],kind:'canonical'}],questions:[]},{...config,pages:[{path:'/'}]}));
});
test('legacy OpenAI credentials are disabled and never reused for Claude',()=>{
 const {dir,settings}=fixture();try{
  const old=settings.read();delete old.provider;old.model='gpt-4.1-mini';
  fs.writeFileSync(settings.file,JSON.stringify(old));
  assert.equal(settings.view().configured,false);assert.equal(settings.view().enabled,false);assert.equal(settings.view().approved,false);
  assert.equal(settings.view().model,'claude-sonnet-4-6');assert.throws(()=>settings.key());
  assert.throws(()=>settings.save({apiKey:'sk-openai-fixture',enabled:true,approved:true}));
  settings.save({apiKey:'sk-ant-new-fixture',enabled:true,approved:true});assert.equal(settings.key(),'sk-ant-new-fixture');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Claude refusals and token truncation do not produce applicable proposals',async()=>{
 const {dir,settings}=fixture();try{
  for(const stop_reason of ['refusal','max_tokens']){
   const ai=new AiAssistant(settings,{fetcher:async()=>new Response(JSON.stringify({stop_reason,content:[{type:'text',text:JSON.stringify(candidate)}]}))});
   await assert.rejects(()=>ai.propose(config));assert.equal(ai.pending.size,0);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('egress pins only approved public or exact private DNS answers',async()=>{
 const rules=[{origin:'https://site.test',privateIPs:[]}];
 const lookup=addresses=>async()=>addresses.map(address=>({address,family:4}));
 assert.equal((await resolveDestination('https://site.test/path',rules,lookup(['93.184.216.34']))).address,'93.184.216.34');
 for(const ip of ['127.0.0.1','169.254.169.254','10.0.0.1'])await assert.rejects(()=>resolveDestination('https://site.test',rules,lookup([ip])));
 await assert.rejects(()=>resolveDestination('https://other.test',rules,lookup(['93.184.216.34'])));
 await assert.rejects(()=>resolveDestination('https://site.test',rules,lookup(['93.184.216.34','10.0.0.1'])));
 assert.equal((await resolveDestination('https://site.test',[{origin:'https://site.test',privateIPs:['10.0.0.1']}],lookup(['10.0.0.1']))).address,'10.0.0.1');
 for(const ip of ['::1','::ffff:127.0.0.1','2001:0000::1','2001:db8::1','2002::1'])assert.equal(addressClass(ip),'forbidden');
 assert.throws(()=>validateDestinations([{origin:'http://site.test'}]));assert.throws(()=>validateDestinations([{origin:'https://site.test',privateIPs:['127.0.0.1']}]));
});

test('long Claude response timeout is reported without blaming credentials',async()=>{
 const {dir,settings}=fixture();try{const ai=new AiAssistant(settings,{fetcher:async()=>{throw new DOMException('Timeout','TimeoutError');}});await assert.rejects(()=>ai.propose(config,{}),/制限時間内に完了しませんでした/);assert.equal(ai.pending.size,0);assert.equal(ai.busy,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
