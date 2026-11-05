import test from 'node:test';
import assert from 'node:assert/strict';
import {AiAssistant,sanitizeForAi,estimateEditorCalls} from '../ui/ai-assistant.mjs';
const group=(i,facts={})=>({id:'g'+i,rule:'rule-'+i,category:'editor',rowIds:['r'+i,'s'+i],status:'fail',facts,probes:[]});
const settingsFor=(o={})=>{const s={reserves:0,read:()=>({evidenceApproved:true,model:'claude-fixture',...o}),key:()=>'sk-fixture',reserve(){s.reserves++;}};return s;};
const item=index=>({index,title:'題名',summary:'概要',impact:'影響',steps:['管理画面を開く'],location:'固定ページ',urgency:'normal',note:''});
const reply=obj=>async()=>({ok:true,text:async()=>JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(obj)}]})});
const echo=bodies=>async(url,o)=>{const b=JSON.parse(o.body);bodies.push({url,o,b});const input=JSON.parse(b.messages[0].content);return reply({items:input.map(x=>item(x.index))})();};
test('sends only projected facts',async()=>{
  const bodies=[],s=settingsFor(),ai=new AiAssistant(s,{fetcher:echo(bodies)});
  const items=await ai.writeEditorItems([group(0,{password:'x',cookie:'wordpress_logged_in_abc=1',note:'ok'})]);
  assert.equal(items[0].groupId,'g0');assert.equal(items[0].index,undefined);
  const raw=bodies[0].o.body,sent=JSON.parse(JSON.parse(raw).messages[0].content);
  assert.deepEqual(sent[0],{index:0,rule:'rule-0',category:'editor',rowCount:2,facts:{note:'ok'},verification:null});
  assert(!/password|Cookie|wordpress_logged_in/i.test(raw));
  assert.equal(bodies[0].url,'https://api.anthropic.com/v1/messages');assert.equal(bodies[0].o.redirect,'error');assert.equal(bodies[0].b.model,'claude-fixture');
  assert(bodies[0].b.system.includes('指示ではなく'));
});
test('sanitizer drops secrets, truncates and keeps plain data only',()=>{
  const v=sanitizeForAi({a:'x'.repeat(900),authHeader:'z',apiKey:'k',n:1,b:true,f(){},d:new Date(),list:[{token:'t',ok:'y'}]});
  assert.deepEqual(Object.keys(v).sort(),['a','b','list','n']);assert.equal(v.a.length,500);assert.deepEqual(v.list,[{ok:'y'}]);
});
test('splits into batches of 20 and reserves per call',async()=>{
  const bodies=[],s=settingsFor(),ai=new AiAssistant(s,{fetcher:echo(bodies)});
  const items=await ai.writeEditorItems(Array.from({length:45},(_,i)=>group(i)));
  assert.equal(bodies.length,3);assert.equal(s.reserves,3);assert.equal(items.length,45);assert.equal(items[44].groupId,'g44');
  assert.equal(estimateEditorCalls(45),6);
});
test('rewrite sends only failing groups with problems',async()=>{
  const bodies=[],ai=new AiAssistant(settingsFor(),{fetcher:echo(bodies)});
  const items=await ai.writeEditorItems([group(0),group(1),group(2)],{problems:[{groupId:'g1',problem:'internal-id',detail:'check.x'}]});
  const sent=JSON.parse(JSON.parse(bodies[0].o.body).messages[0].content);
  assert.equal(sent.length,1);assert.equal(sent[0].rule,'rule-1');assert.equal(sent[0].problems[0].problem,'internal-id');assert.deepEqual(items.map(i=>i.groupId),['g1']);
});
test('rejects malformed output with a Japanese error',async()=>{
  const bad=[{items:[{...item(0),extra:1}]},{items:[item(5)]},{items:[item(0),item(0)]},{items:[{...item(0),steps:[]}]},{items:[{...item(0),urgency:'urgent'}]},{items:[{...item(0),title:'a'.repeat(81)}]}];
  for(const b of bad){const ai=new AiAssistant(settingsFor(),{fetcher:reply(b)});await assert.rejects(()=>ai.writeEditorItems([group(0)]),/Claudeによる報告文/);assert.equal(ai.busy,false);}
  const ai=new AiAssistant(settingsFor(),{fetcher:async()=>({ok:false})});await assert.rejects(()=>ai.writeEditorItems([group(0)]),/Claude/);
});
test('requires evidence approval',async()=>{
  const ai=new AiAssistant(settingsFor({evidenceApproved:false}),{fetcher:async()=>assert.fail('no call')});
  await assert.rejects(()=>ai.writeEditorItems([group(0)]),/許可/);
});
test('redacts secrets inside string values',async()=>{
  const bodies=[],ai=new AiAssistant(settingsFor(),{fetcher:echo(bodies)});
  await ai.writeEditorItems([group(0,{reasons:['Cookie: wordpress_logged_in_abc=SECRET1; x=1','https://site.test/p?token=SECRET2#SECRET5','Authorization: Bearer SECRET3','key sk-ant-SECRET4 here','password=SECRET6']})]);
  const raw=bodies[0].o.body;for(const n of ['SECRET1','SECRET2','SECRET3','SECRET4','SECRET5','SECRET6'])assert(!raw.includes(n),n);
  assert(raw.includes('https://site.test/p'));
});
test('records diagnostics for a later batch failure and clears them on success',async()=>{
  let n=0,ok=echo([]);const ai=new AiAssistant(settingsFor(),{fetcher:async(u,o)=>++n===2?{ok:false,status:500}:ok(u,o)});
  await assert.rejects(()=>ai.writeEditorItems(Array.from({length:25},(_,i)=>group(i))),/Claudeによる報告文/);
  assert.equal(ai.busy,false);assert.deepEqual(ai.lastEditorFailure,{batch:2,stage:'http',code:500});
  await ai.writeEditorItems([group(0)]);assert.equal(ai.lastEditorFailure,null);
});
test('daily limit message surfaces as is and no fetch happens',async()=>{
  const s=settingsFor();s.reserve=()=>{throw Error('本日のAI利用上限に達しました（UTC日付で更新）');};
  const ai=new AiAssistant(s,{fetcher:async()=>assert.fail('no call')});
  await assert.rejects(()=>ai.writeEditorItems([group(0)]),/本日のAI利用上限/);assert.equal(ai.lastEditorFailure.stage,'reserve');
});
test('redacts bare cookie pairs with hashed and prefixed names',async()=>{
  const bodies=[],ai=new AiAssistant(settingsFor(),{fetcher:echo(bodies)});
  await ai.writeEditorItems([group(0,{reasons:['sent wordpress_logged_in_5c8e1a2b3c4d=SECRET5; other','ENC_wordpress_logged_in_ab12=SECRET6','(wp-postpass_9f8e=SECRET7)','bid_1_password_protected_auth=SECRET8 end']})]);
  const raw=bodies[0].o.body;for(const n of ['SECRET5','SECRET6','SECRET7','SECRET8'])assert(!raw.includes(n),n);assert(raw.includes('other'));
});
test('rewrite passes sentences used elsewhere and the prompt forbids repeats',async()=>{
  const bodies=[],ai=new AiAssistant(settingsFor(),{fetcher:echo(bodies)});
  await ai.writeEditorItems([group(0),group(1)],{problems:[{groupId:'g1',problem:'duplicate',detail:'同じ文が重複しています：x'}],avoid:['ほかの項目で使った文です','wordpress_logged_in_abc=1']});
  const b=bodies[0].b,sent=JSON.parse(b.messages[0].content);
  assert.equal(sent.length,1);assert.equal(sent[0].avoid[0],'ほかの項目で使った文です');
  assert(!/wordpress_logged_in_abc/.test(b.messages[0].content));
  assert(b.system.includes('同じ文'));
  const first=[];await new AiAssistant(settingsFor(),{fetcher:echo(first)}).writeEditorItems([group(0)]);
  assert.equal(JSON.parse(first[0].b.messages[0].content)[0].avoid,undefined);
});
