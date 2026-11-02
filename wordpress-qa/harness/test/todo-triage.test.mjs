import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConfig} from '../lib/config.mjs';
import {triage,notApplicableChecks,plainMessage,ITEM_CHECKS,COMMERCE_PLUGINS,MEMBERSHIP_PLUGINS} from '../ui/todo-triage.mjs';
const pending=['publishing','cache','scheduled','contact-success','performance','order','order-record','order-cleanup','order-notification','membership','analytics','notification','roles','update','navigation'];
const site=(environment='staging',allowSensitivePaths=environment!=='production')=>validateConfig({name:'site',baseURL:'https://site.test',environment,allowSensitivePaths,allowProductionJourneys:environment==='production',pages:[{id:'home',path:'/',canonical:'https://site.test/',indexable:false}],checks:[...pending.map(k=>({id:'coverage-'+k,title:k,suite:'delivery',kind:'unconfigured',required:true,options:{instructions:'browser-flow の送信→waitForMail を additionalChecks に指定'}})),{id:'auto-security-exposure',title:'機密パスの外部公開',suite:'authz',kind:'security-baseline',required:true,options:{area:'exposure',paths:['/'],wpPath:'/'}}]});
const observed=(slugs=[])=>({pluginInventory:{observed:true,slugs}});
const profile=(extra={})=>({timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false,contactPath:'/contact/',contactFormId:1,automation:observed(['contact-form-7']),...extra});
const ids=rows=>rows.map(r=>r.id).sort();
const orders=['coverage-order','coverage-order-cleanup','coverage-order-notification','coverage-order-record'],prodFour=[...ITEM_CHECKS.writes,...ITEM_CHECKS.submit];
test('staging site without commerce or membership plugins',()=>{
 const r=triage(site(),profile());
 assert.deepEqual(r.todo.map(x=>x.key),['writes','submit','performance']);
 assert.deepEqual(r.todo.map(x=>x.count),[3,1,1]);assert.deepEqual(r.todo[0].checkIds,ITEM_CHECKS.writes);assert.equal(r.todo[1].input.type,'email+checkbox');assert.equal(r.todo[2].input.type,'seconds');
 assert.deepEqual(ids(r.notRelevant),[...orders,'coverage-membership'].sort());assert(r.notRelevant.every(x=>x.revertible===true&&x.reason));
 assert.equal(r.notRelevant.find(x=>x.id==='coverage-order').reason,'有効なプラグインに通販機能が見つからないため対象外（登録時の取得）');
 assert.deepEqual(ids(r.toolGap),['coverage-navigation']);assert.deepEqual(ids(r.technical),['coverage-analytics','coverage-notification','coverage-roles','coverage-update']);
 const all=[...r.todo.flatMap(x=>x.checkIds),...r.toolGap,...r.technical,...r.notRelevant].map(x=>x.id??x);assert.equal(new Set(all).size,all.length);
 assert(COMMERCE_PLUGINS.includes('usc-e-shop')&&COMMERCE_PLUGINS.includes('woocommerce')&&MEMBERSHIP_PLUGINS.length);
});
test('commerce and membership plugins keep those checks in technical',()=>{
 const r=triage(site(),profile({automation:observed(['usc-e-shop'])}));
 assert.deepEqual(r.notRelevant,[]);for(const id of [...orders,'coverage-membership'])assert(r.technical.some(x=>x.id===id),id);
 assert.deepEqual(Object.keys(notApplicableChecks(site(),profile({automation:observed(['woocommerce','wp-members'])}))),[]);
 for(const slug of ['woocommerce-gateway-stripe','usc-e-shop-x','woocommerce-8-5-1','wc-shipping','wcex-auto-delivery','welcart-basic']){const n=notApplicableChecks(site(),profile({automation:observed([slug])}));for(const id of [...orders,'coverage-membership'])assert(!n[id],slug+' '+id);const r=triage(site(),profile({automation:observed([slug])}));assert(r.technical.some(x=>x.id==='coverage-order'),slug);}
 for(const slug of ['sfwd-lms','lifterlms','tutor','learnpress','bbpress','wpforo','wp-user-manager','peepso-core']){const n=notApplicableChecks(site(),profile({automation:observed([slug])}));assert(!n['coverage-membership'],slug);assert(n['coverage-order'],slug);}
});
test('bankOrder declared by the person in charge keeps orders out of notRelevant',()=>{
 const r=triage(site(),profile({bankOrder:true}));assert(!r.notRelevant.some(x=>orders.includes(x.id)));for(const id of orders)assert(r.technical.some(x=>x.id===id),id);
 assert(r.notRelevant.some(x=>x.id==='coverage-membership'));
 const p=notApplicableChecks(site('production'),profile({bankOrder:true}));for(const id of orders)assert(!p[id],id);assert(p['coverage-publishing']);
});
test('production site',()=>{
 const r=triage(site('production'),profile());
 assert.deepEqual(r.todo.map(x=>x.key),['performance','sensitivePaths']);assert.deepEqual(r.todo[1].checkIds,['auto-security-exposure']);assert.equal(r.todo[1].count,1);assert.equal(r.todo[1].input.type,'checkbox');
 for(const id of prodFour){const row=r.notRelevant.find(x=>x.id===id);assert.equal(row.revertible,false,id);assert.equal(row.reason,'本番環境ではテスト投稿・フォーム送信を実行しないため対象外');}
 assert(r.notRelevant.find(x=>x.id==='coverage-order').revertible);
 assert(!triage(site('production',true),profile()).todo.some(x=>x.key==='sensitivePaths'));
 const n=notApplicableChecks(site('production'),profile({automation:{pluginInventory:{observed:false,slugs:[]}}}));assert.deepEqual(Object.keys(n).sort(),[...prodFour].sort());
});
test('inventory not observed',()=>{
 for(const automation of [undefined,{pluginInventory:{observed:false,slugs:[]}}]){
  const r=triage(site(),profile({automation}));assert.deepEqual(r.notRelevant,[]);
  for(const id of [...orders,'coverage-membership'])assert(r.technical.some(x=>x.id===id),id);
 }
});
test('writes already allowed hides writes item',()=>{
 const r=triage(site(),profile({writes:true}));
 assert(!r.todo.some(x=>x.key==='writes'));for(const id of ITEM_CHECKS.writes)assert(r.technical.some(x=>x.id===id),id);
 const done=triage(site(),profile({submit:true,testEmail:'qa@site.test',performanceMs:3000}));assert.deepEqual(done.todo.map(x=>x.key),['writes']);
 const c=site();c.checks=c.checks.filter(x=>!ITEM_CHECKS.writes.includes(x.id));assert(!triage(c,profile()).todo.some(x=>x.key==='writes'));
});
test('relevantOverrides puts order back into technical and keeps production four non-revertible',()=>{
 const overrides=['coverage-order',...prodFour];
 const r=triage(site(),profile({automation:{...observed(),relevantOverrides:overrides}}));
 assert(r.technical.some(x=>x.id==='coverage-order'));assert(!r.notRelevant.some(x=>x.id==='coverage-order'));assert(r.notRelevant.some(x=>x.id==='coverage-order-record'));
 const p=triage(site('production'),profile({automation:{...observed(),relevantOverrides:overrides}}));
 for(const id of prodFour)assert.equal(p.notRelevant.find(x=>x.id===id)?.revertible,false,id);
 assert(p.technical.some(x=>x.id==='coverage-order'));
});
test('no form detected moves contact-success to technical',()=>{
 const r=triage(site(),profile({contactPath:undefined,contactFormId:undefined}));
 assert(!r.todo.some(x=>x.key==='submit'));assert(r.technical.some(x=>x.id==='coverage-contact-success'));
 assert(triage(site(),profile({contactFormId:undefined})).todo.some(x=>x.key==='submit'));
});
test('plain messages contain no developer terms',()=>{
 const bad=/browser-flow|waitForMail|adminに登録|信頼済みアダプター|additionalChecks/;
 for(const r of [triage(site(),profile()),triage(site('production'),profile({writes:true,automation:undefined})),triage(site(),profile({writes:true,contactPath:undefined,contactFormId:undefined,automation:observed(['woocommerce'])}))]){
  const texts=[...r.todo.flatMap(x=>[x.label,x.effect]),...[...r.toolGap,...r.technical,...r.notRelevant].flatMap(x=>[x.message,x.reason??''])];
  for(const t of texts){assert.equal(typeof t,'string');assert(!bad.test(t),t);}
  for(const x of [...r.toolGap,...r.technical,...r.notRelevant])assert(x.message.trim(),x.id);
 }
 for(const k of [...pending,'unknown'])for(const c of ['discovery','permission','input','integration','credentials','implementation','mixed'])assert(!bad.test(plainMessage('coverage-'+k,c)));
});
