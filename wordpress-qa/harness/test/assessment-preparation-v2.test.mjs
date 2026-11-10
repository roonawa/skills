import test from 'node:test';
import assert from 'node:assert/strict';
import {AiAssistant,preparationKinds} from '../ui/ai-assistant.mjs';
const base={name:'secret-name',baseURL:'https://secret.test',environment:'production',pages:[{id:'home',path:'/',canonical:'https://secret.test/',indexable:true}],checks:[]};
const settings={key:()=> 'synthetic-key',read:()=>({model:'fixture'}),reserve(){}};
function transport(visit=()=>{}){return async(url,opts)=>{
 const body=JSON.parse(opts.body),part=JSON.parse(body.messages[0].content),schema=body.output_config.format.schema;
 assert.equal(schema.properties.cases.maxItems,undefined);assert.ok(schema.properties.cases.description);
 assert.equal(schema.properties.questions.maxItems,undefined);assert.ok(schema.properties.questions.description);
 if(part.pages.length)assert.deepEqual(schema.properties.cases.items.properties.pageIndex.enum,part.pages.map(p=>p.index));
 if(part.checks.length)assert.deepEqual(schema.properties.questions.items.properties.checkIndex.enum,part.checks.map(c=>c.index));
 assert(!JSON.stringify(part).includes('secret'));
 const result={cases:[],questions:[],reviews:part.reviewTargets.map(t=>({...t,reason:'登録構造を確認。合否は未検査。'}))};visit(part,result);
 return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(result)}]}));
};}
test('Claude reviews ALL entries beyond old 80-page and 150-check cutoffs',async()=>{
 const c={...base,pages:Array.from({length:81},(_,i)=>({...base.pages[0],id:'p-'+i,path:'/p'+i})),checks:Array.from({length:151},(_,i)=>({id:'c-'+i,suite:'seo',kind:'unconfigured',options:{instructions:'private instructions'}})),manual:[{id:'m',title:'private title',reason:'private instructions'}]};
 const calls=[];const ai=new AiAssistant(settings,{fetcher:transport(p=>calls.push(p))});
 const result=await ai.propose(c);assert.equal(calls.length,6);assert.equal(result.reviews.length,233);
 assert(result.reviews.some(r=>r.section==='checks'&&r.index===150));assert(result.reviews.some(r=>r.section==='pages'&&r.index===80));
 assert(!JSON.stringify(calls).includes('private'));
});
test('missing or duplicate reviews never yield applicable proposals',async()=>{
 for(const modify of [r=>r.reviews.pop(),r=>r.reviews.push(r.reviews[0])]){
  const ai=new AiAssistant(settings,{fetcher:transport((p,r)=>modify(r))});await assert.rejects(()=>ai.propose(base));assert.equal(ai.pending.size,0);
 }
});
test('all bounded read-only preparation types compile without replacing obligations',async()=>{
 const c={...base,checks:[{id:'coverage-contact-success',suite:'delivery',kind:'unconfigured',options:{instructions:'送信許可が必要'}}]};
 const ai=new AiAssistant(settings,{fetcher:transport((p,r)=>{r.cases=preparationKinds.map(kind=>({pageIndex:0,targetIndex:-1,kind,viewport:'mobile',reason:'追加'}));})});
 const result=await ai.propose(c,{maxLoadMs:3000});const applied=ai.apply(result.id,c,preparationKinds.map((_,i)=>i)).config;
 assert.equal(applied.checks.length,10);assert(!preparationKinds.includes('layout'));assert.equal(applied.checks[0].kind,'unconfigured');assert.equal(applied.allowTestWrites,false);assert.equal(applied.journeys.length,0);
});
test('quota exhaustion in a later batch does not expose partially applicable output',async()=>{
 let calls=0;const limited={...settings,reserve(){if(++calls>1)throw Error('quota');}};
 const c={...base,pages:Array.from({length:41},(_,i)=>({...base.pages[0],id:'p-'+i}))};
 const ai=new AiAssistant(limited,{fetcher:transport()});await assert.rejects(()=>ai.propose(c));assert.equal(ai.pending.size,0);assert.equal(ai.busy,false);
});
