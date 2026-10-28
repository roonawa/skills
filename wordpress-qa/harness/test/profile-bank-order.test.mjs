import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {readBankSettings,requireBankOrder,bankMarker,bankNote,parseBankTotal,assertBankConfirmation,beginBankAttempt,bankRequestAllowed,bankOrderSupport,bankCancellationEvidence,bankSearchForm,bankSearchMatches,bankEdit,bankAdmin,bankPublicState,bankRoute,run} from '../builtin/wordpress-profile/bank-order.mjs';

const config={baseURL:'https://fixture.test',environment:'staging',allowTestWrites:true};
const profile={bankOrder:true,writes:true,productPath:'/archives/42',testEmail:'QA+checkout@example.test',customerPrefecture:'長野県',bankPaymentLabel:'銀行振込',expectedTotal:1466};
const env=(p=profile,state={cookies:[],origins:[]})=>({WPQA_UI_PROFILE:JSON.stringify(p),WPQA_UI_ADMIN_STATE:JSON.stringify(state)});

test('write guards require explicit booleans and staging/local',()=>{
  for(const environment of ['production','preview',undefined])assert.throws(()=>requireBankOrder({...config,environment},profile),/BLOCKED/);
  for(const value of [false,undefined,1,'true']){
    assert.throws(()=>requireBankOrder({...config,allowTestWrites:value},profile),/BLOCKED/);
    for(const key of ['writes','bankOrder'])assert.throws(()=>requireBankOrder(config,{...profile,[key]:value}),/BLOCKED/);
  }
  for(const environment of ['local','staging'])requireBankOrder({...config,environment},profile);
});
test('schema defaults and same-site state; invalid values fail closed',()=>{
  const settings=readBankSettings(config,env());
  assert.equal(settings.profile.cartPath,'/usces-cart');assert.equal(settings.profile.adminPath,'/wp-admin/');
  for(const key of ['productPath','cartPath','adminPath'])for(const value of ['https://other.test/a','//other.test/a','/a?b=c','/a#b','/a/../b','/a\\b','/%2fother','/a//b',''])assert.throws(()=>readBankSettings(config,env({...profile,[key]:value})),/BLOCKED/);
  for(const patch of [{expectedTotal:'1466'},{expectedTotal:0},{expectedTotal:1.5},{expectedTotal:Infinity},{testEmail:' a@b.test'},{testEmail:'a@b.test\r\n'},{customerPrefecture:''},{bankPaymentLabel:'クレジットカード'},{bankPaymentLabel:'銀行振込（credit card）'}])assert.throws(()=>readBankSettings(config,env({...profile,...patch})),/BLOCKED/);
  assert.throws(()=>readBankSettings({...config,baseURL:'https://fixture.test/sub/'},env()),/BLOCKED/);
  for(const state of [{cookies:[],origins:[{origin:'https://other.test',localStorage:[]}]},{cookies:[{name:'secret',value:'redacted',domain:'.test'}],origins:[]}])assert.throws(()=>readBankSettings(config,env(profile,state)),/BLOCKED/);
});
test('markers are unique, bounded and do not expose case token; notes are exact',()=>{
  const marker=bankMarker('case-private-token');
  assert.notEqual(marker,bankMarker('case-private-token'));
  assert.ok(!marker.includes('private'));assert.match(bankNote(marker),/発送・請求不要/);
  for(const token of ['',null,'a\nb','a'.repeat(201)])assert.throws(()=>bankMarker(token),/BLOCKED/);
  assert.throws(()=>bankNote('arbitrary-note'),/BLOCKED/);
});
test('total parser rejects substring matches, broken grouping and multiple amounts',()=>{
  for(const text of ['¥1,466','￥1,466','1466円',' 1466 '])assert.equal(parseBankTotal(text),1466);
  for(const text of ['1,46','14,66','1,466 850','-1466','1466.00','USD 1466','subtotal ¥1466','001466','9007199254740992'])assert.throws(()=>parseBankTotal(text),/BLOCKED/);
});
test('confirmation binds exact payment, labeled grand total and exact note',()=>{
  const marker=bankMarker('qa-confirm');
  const text=`商品合計\t¥616\n送料\t¥850\n \t \t総合計金額\t¥1,466\n支払方法\t銀行振込\n備考\t${bankNote(marker)}`;
  assertBankConfirmation(text,profile,marker);
  for(const bad of [text.replace('総合計金額','商品合計'),text.replace('¥1,466','¥11,466'),text.replace('支払方法\t銀行振込','支払方法\tカード\n銀行振込'),text.replace(bankNote(marker),bankNote(marker)+'x'),text+'\n総合計金額\t¥1,466',text+'\n支払方法\t銀行振込'])assert.throws(()=>assertBankConfirmation(bad,profile,marker),/BLOCKED/);
});
function request(data,{url='https://fixture.test/usces-cart',method='POST',type='application/x-www-form-urlencoded'}={}){
  return {url:()=>url,method:()=>method,headers:()=>({'content-type':type}),postData:()=>new URLSearchParams(data).toString()};
}
test('transport permits purchase only in the explicit commit phase; rejects extra fields and off-origin traffic',()=>{
  const p={...profile,cartPath:'/usces-cart'},base=new URL(config.baseURL);
  const allowed=(r,step='confirm')=>bankRequestAllowed(r,base,p,step);
  assert.ok(allowed(request({confirm:'next','offer[payment_name]':'銀行振込'})));
  assert.ok(allowed(request({'inCart[0]':'add'}),'add'));
  for(const data of [{purchase:'yes'},{confirm:'yes',purchase:'yes'},{confirm:'yes','offer[payment_name]':'カード'},{deliveryinfo:'next'},{confirm:'yes',customerinfo:'yes'}])assert.equal(allowed(request(data)),false);
  for(const options of [{url:'https://other.test/usces-cart'},{url:'https://fixture.test/wp-admin/'},{type:'multipart/form-data'},{method:'PUT'}])assert.equal(allowed(request({confirm:'next'},options)),false);
  assert.equal(allowed(request({confirm:'next'}),null),false);
  assert.equal(allowed(request({}, {url:'https://other.test/',method:'GET'})),false);
  assert.equal(allowed(request({purchase:'上記内容で注文する'}),'purchase'),true);
  assert.equal(allowed(request({purchase:'yes',confirm:'yes'}),'purchase'),false);
});
test('durable pending record blocks uncertain retries and contains no auth/customer data',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-bank-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const runDir=path.join(dir,'run');fs.mkdirSync(runDir);
  const context={config,configDir:dir,runDir};const marker=bankMarker('qa-journal');
  const journal=beginBankAttempt(config,context,marker);
  const pending=path.join(dir,'profile-bank-pending.json');
  const saved=fs.readFileSync(pending,'utf8');assert.equal(JSON.parse(saved).status,'pending');
  assert.ok(!saved.includes(profile.testEmail));assert.ok(!saved.includes('cookies'));
  assert.throws(()=>beginBankAttempt(config,context,bankMarker('other')),/locked/);
  journal.close();assert.throws(()=>beginBankAttempt(config,context,bankMarker('other')),/unresolved/);
});
test('pre-submit resolution records limitations and permits a fresh attempt',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-bank-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const context={config,configDir:dir,runDir:dir};
  const journal=beginBankAttempt(config,context,bankMarker('qa-first'));journal.finish('confirmation_verified');journal.close();
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'profile-bank-pending.json'),'utf8'));
  assert.equal(saved.status,'not_submitted');assert.equal(saved.support.cancellation,true);
  assert.deepEqual(saved.cancellationEvidence,bankCancellationEvidence);
  const next=beginBankAttempt(config,context,bankMarker('qa-next'));next.finish('not_started');next.close();
});
test('evidence records authenticated read-only control verification',()=>{
  assert.equal(bankCancellationEvidence.missing.length,0);
  assert.ok(bankCancellationEvidence.verified.some(item=>item.includes('admin.php?page=usces_orderlist')));
  assert.equal(bankOrderSupport.submission,true);
  assert.equal(bankOrderSupport.cancellation,true);
});
test('production run rejects before browser launch',async()=>{
  const previous=process.env.WPQA_UI_PROFILE;process.env.WPQA_UI_PROFILE=JSON.stringify(profile);
  try{await assert.rejects(run({config:{...config,environment:'production'},token:'qa-production'}),/BLOCKED/);}
  finally{if(previous===undefined)delete process.env.WPQA_UI_PROFILE;else process.env.WPQA_UI_PROFILE=previous;}
  assert.deepEqual(bankOrderSupport,{checkout:'complete',submission:true,cancellation:true});
});

// Synthetic fixtures transcribe only the controls inspected read-only on
// staging (2026-10-26). No real cookies, customer records or nonces are saved.
const base=new URL(config.baseURL),p={...profile,adminPath:'/wp-admin/',cartPath:'/usces-cart'};
const listURL=base.origin+'/wp-admin/admin.php?page=usces_orderlist';
const editURL=listURL+'&order_action=edit&order_id=44&wc_nonce=fixture';
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const field=(name,value,type='text')=>`<input type="${type}" name="${name}" value="${escape(value)}">`;
const select=(name,value,options,id='')=>`<select name="${name}" id="${id}">${options.map(v=>`<option value="${v}" ${v===value?'selected':''}>${v}</option>`).join('')}</select>`;
function searchHTML(marker='',count=0,links=count?[editURL]:[]){
  return `<div id="wpadminbar"></div><form id="form_tablesearch" method="post" action="${escape(listURL)}">${select('search[order_column][0]','note',['','note'])}${field('search[order_word][0]',marker)}${select('search[order_word_term][0]','contain',['contain','equal'])}${field('searchIn','検索開始','submit')}${field('wc_nonce','fixture','hidden')}</form><div class="usces_tablenav_top">${count} / 9 件first prev 1 next last</div><table id="mainDataTable">${links.map(h=>`<tr><td><a href="${escape(h)}">00000044</a></td></tr>`).join('')}</table>`;
}
function editHTML(marker,status='#none#'){
  return `<div id="wpadminbar"></div><form id="order_editpost_form" method="post" action="${escape(listURL+'&order_action=editpost')}">
  ${field('order_id','44','hidden')}${field('order_action','editpost','hidden')}${field('wc_nonce','fixture','hidden')}
  ${field('customer[mailaddress]',p.testEmail)}${field('customer[name1]','QAテスト注文')}${field('customer[name2]','発送不要')}
  ${select('offer[payment_name]',p.bankPaymentLabel,[p.bankPaymentLabel,'カード'])}${select('offer[receipt]','noreceipt',['noreceipt','receipted'])}
  ${select('offer[taio]',status,['#none#','cancel','completion'],'order_taio')}<textarea name="offer[note]">${bankNote(marker)}</textarea>
  ${field('skuPrice[80]','616')}${field('quant[80]','1')}${field('offer[discount]','0')}${field('offer[shipping_charge]','850')}${field('offer[cod_fee]','0')}${field('offer[tax]','0')}${field('offer[usedpoint]','0')}
  ${field('update_order_edit','設定を更新','submit')}${field('update_order_edit2','設定を更新','submit')}${field('delButtonAdmin[80]','削除','submit')}
  ${field('mailChecked','','hidden')}${field('change_taxrate','1','checkbox')}${field('up_modified','','hidden')}</form>`;
}
test('search uses only notes/contain and recognizes matched count, not total orders',()=>{
  const marker=bankMarker('search'),input=bankSearchForm(searchHTML(),base,p,marker);
  assert.equal(input.form['search[order_column][0]'],'note');assert.equal(input.form['search[order_word][0]'],marker);
  assert.ok(!('collective' in input.form));assert.ok(!('listcheck[]' in input.form));
  assert.equal(bankSearchMatches(searchHTML(marker,1),base,p,marker)[0].id,'44');
  assert.deepEqual(bankSearchMatches(searchHTML(marker),base,p,marker),[]);
  for(const html of [searchHTML('other',1),searchHTML(marker,2,[editURL]),searchHTML(marker,1,[editURL,editURL]),searchHTML(marker,1,[editURL.replace(base.origin,'https://other.test')])])assert.throws(()=>bankSearchMatches(html,base,p,marker),/BLOCKED/);
});
test('edit payload requires exact ownership and changes only status plus save submitter',()=>{
  const marker=bankMarker('edit'),source=editHTML(marker),expected={id:'44',marker};
  const parsed=bankEdit(source,base,p,expected),data=new URLSearchParams(parsed.data);
  assert.equal(parsed.total,1466);assert.equal(data.get('offer[taio]'),'cancel');assert.equal(data.get('update_order_edit'),'設定を更新');
  assert.equal(data.get('offer[note]'),bankNote(marker));assert.equal(data.get('skuPrice[80]'),'616');
  for(const key of ['update_order_edit2','delButtonAdmin[80]','change_taxrate'])assert.equal(data.has(key),false);
  for(const bad of [source.replace(bankNote(marker),bankNote(marker)+'extra'),source.replace(p.testEmail,'other@example.test'),source.replace('QAテスト注文','Customer'),source.replace('value="850"','value="851"'),source.replace('name="order_id" value="44"','name="order_id" value="45"'),editHTML(marker,'completion'),source.replace('value="noreceipt" selected','value="receipted" selected'),source.replace('value="銀行振込" selected','value="カード" selected'),source.replace('order_action=editpost','order_action=delete')])assert.throws(()=>bankEdit(bad,base,p,expected),/BLOCKED/);
});

function fakeAdmin(marker,{badNote=false,persist=true,alreadyCancelled=false,loseSaveResponse=false,completionMismatch=false}={}){
  let status=alreadyCancelled?'cancel':'#none#',exists=false;const writes=[];
  const response=(body,status=200)=>({status:()=>status,text:async()=>body,dispose:async()=>{}});
  const client={
    async get(url){
      if(url===listURL)return response(searchHTML('',1));
      assert.equal(url,editURL);
      let html=editHTML(marker,status);if(exists&&badNote)html=html.replace(bankNote(marker),'unowned order');
      if(status==='cancel'&&completionMismatch)html=html.replace('value="850"','value="999"');return response(html);
    },
    async post(url,options){
      assert.equal(options.maxRedirects,0);assert.equal(options.maxRetries,0);
      if(options.form){assert.equal(url,listURL);return response(searchHTML(options.form['search[order_word][0]'],exists?1:0));}
      assert.equal(url,listURL+'&order_action=editpost');const data=new URLSearchParams(options.data);assert.equal(data.get('offer[taio]'),'cancel');writes.push(data);
      if(persist)status='cancel';if(loseSaveResponse)throw Error('transport lost');return response('',302);
    },
  };
  return {client,adapter:bankAdmin(client,base,p),writes,create(){exists=true;}};
}
test('adapter preflights without updates, then cancels and reopens exactly the owned order',async()=>{
  const marker=bankMarker('flow'),fake=fakeAdmin(marker),events=[];
  await fake.adapter.preflight(marker);assert.equal(fake.writes.length,0);fake.create();
  const id=await fake.adapter.cancel(marker,{matched:id=>events.push(['matched',id]),cancelled:id=>events.push(['cancelled',id])});
  assert.equal(id,'44');assert.equal(fake.writes.length,1);assert.deepEqual(events,[['matched','44'],['cancelled','44']]);
});
test('adapter never updates an unmatched note and never confirms failed or uncertain cleanup',async()=>{
  for(const options of [{badNote:true},{persist:false},{loseSaveResponse:true},{completionMismatch:true}]){
    const marker=bankMarker('fail'),fake=fakeAdmin(marker,options);await fake.adapter.preflight(marker);fake.create();let cancelled=false;
    await assert.rejects(fake.adapter.cancel(marker,{matched(){},cancelled(){cancelled=true;}}));assert.equal(cancelled,false);
    assert.equal(fake.writes.length,options.badNote?0:1);
  }
});
test('already-cancelled owned order is verified without another save',async()=>{
  const marker=bankMarker('already'),fake=fakeAdmin(marker,{alreadyCancelled:true});await fake.adapter.preflight(marker);fake.create();
  await fake.adapter.cancel(marker,{matched(){},cancelled(){}});assert.equal(fake.writes.length,0);
});
test('durable purchase intent cannot be resolved by ordinary finish or wrong-ID cancellation',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-bank-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const context={config,configDir:dir,runDir:dir},j=beginBankAttempt(config,context,bankMarker('intent'));
  j.submission();j.finish('lost_completion');assert.equal(j.status,'submission_pending');
  j.matched('44');assert.throws(()=>j.cancelled('45'),/BLOCKED/);j.cancelled('44');assert.equal(j.status,'cancelled');j.close();
  const next=beginBankAttempt(config,context,bankMarker('next'));next.finish('not_started');next.close();
});

test('main run commits only after durable intent and cancels even when completion fails',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-bank-main-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const old=Object.fromEntries(['WPQA_UI_PROFILE','WPQA_UI_ADMIN_STATE','WPQA_CONTEXT','WPQA_UI_SITE_PASSWORD','WPQA_UI_PUBLIC_HEADERS'].map(k=>[k,process.env[k]]));
  t.after(()=>{for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  delete process.env.WPQA_UI_SITE_PASSWORD;delete process.env.WPQA_UI_PUBLIC_HEADERS;
  for(const lostCompletion of [false,true]){
    const scenario=path.join(dir,String(lostCompletion));fs.mkdirSync(scenario);
    const contextPath=path.join(scenario,'context.json');fs.writeFileSync(contextPath,JSON.stringify({config,configDir:scenario,runDir:scenario}));
    Object.assign(process.env,env());process.env.WPQA_CONTEXT=contextPath;
    const pending=path.join(scenario,'profile-bank-pending.json');let marker,fake,contexts=0,purchased=false,attached;
    const locator=selector=>({
      async click(){
        if(selector==='input[name="purchase"]'){
          assert.equal(JSON.parse(fs.readFileSync(pending)).status,'submission_pending');
          purchased=true;fake.create();if(lostCompletion)throw Error('lost purchase response');
        }
      },
      async fill(value){if(selector==='textarea[name="offer[note]"]')assert.equal(value,bankNote(marker));},
      async selectOption(){},async check(){},nth(){return this;},async evaluateAll(){return [p.bankPaymentLabel];},
      async count(){return 1;},async isVisible(){return true;},async evaluate(){return base.origin+p.cartPath;},
      async innerText(){return purchased?'お買い上げありがとうございました。':`総合計金額\t¥1,466\n支払方法\t銀行振込\n備考\t${bankNote(marker)}`;},
    });
    const page={setDefaultTimeout(){},async goto(){},locator,getByRole(){return locator('add');}};
    const launchBrowser=async()=>{
      marker=JSON.parse(fs.readFileSync(pending)).marker;fake=fakeAdmin(marker);
      return {async newContext(options){
        contexts++;
        if(contexts===1)return {request:fake.client,async close(){}};
        assert.deepEqual(options.storageState,{cookies:[],origins:[]});
        return {async route(){},async newPage(){return page;},async close(){}};
      },async close(){}};
    };
    const promise=run({config,token:'main-run',launchBrowser,attach:async(name,data)=>{attached=data;}});
    if(lostCompletion)await assert.rejects(promise,/BLOCKED/);else assert.equal((await promise).status,'cancelled');
    assert.equal(fake.writes.length,1);assert.equal(attached.status,'cancelled');assert.equal(attached.orderId,'44');
    assert.equal(JSON.parse(fs.readFileSync(pending)).status,'cancelled');
  }
});

test('journey-only public gate preparation obtains bid cookie without any admin cookie',async()=>{
  const seen=[];const server=createServer(async(req,res)=>{
    let data='';for await(const chunk of req)data+=chunk;
    seen.push({cookie:req.headers.cookie,authorization:req.headers.authorization});
    if(req.method==='POST'){
      assert.equal(new URLSearchParams(data).get('password_protected_pwd'),'fixture-password');
      res.setHeader('Set-Cookie',['bid_1_password_protected_auth=fresh-gate; Path=/','wordpress_logged_in_fixture=admin; Path=/']);
    }
    res.end('<input name="password_protected_pwd">');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const baseURL=`http://127.0.0.1:${server.address().port}`;
    const state=await bankPublicState({baseURL},new URL(baseURL),{cookies:[],origins:[]},{WPQA_UI_SITE_PASSWORD:'fixture-password'});
    assert.deepEqual(state.cookies.map(c=>[c.name,c.value]),[['bid_1_password_protected_auth','fresh-gate']]);
    assert.deepEqual(state.origins,[]);assert.ok(seen.every(s=>!s.cookie&&!s.authorization));
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('only public gate cookies cross into checkout; env gate overrides stale saved gate',async()=>{
  const state={cookies:[{name:'bid_1_password_protected_auth',value:'old',domain:base.hostname,path:'/'},{name:'wordpress_logged_in_test',value:'admin-secret',domain:base.hostname,path:'/'}],origins:[{origin:base.origin,localStorage:[{name:'secret',value:'secret'}]}]};
  const publicState=await bankPublicState(config,base,state,{WPQA_UI_PUBLIC_HEADERS:JSON.stringify({Cookie:'bid_1_password_protected_auth=new; wordpress_logged_in_test=admin-secret; password_protected_cookie_test=1',Authorization:'must-not-forward'})});
  assert.deepEqual(publicState.cookies.map(c=>[c.name,c.value]),[['bid_1_password_protected_auth','new']]);
  assert.deepEqual(publicState.origins,[]);assert.ok(!JSON.stringify(publicState).includes('secret'));
  const saved=await bankPublicState(config,base,state,{});assert.equal(saved.cookies[0].value,'old');
});

async function routeFixture(responses,method='POST'){
  const fetched=[];let aborted=false,fulfilled=false;
  const req=request(method==='POST'?{purchase:'submit'}:{},{method});
  const route={request:()=>req,async abort(){aborted=true;},async fulfill(){fulfilled=true;},async fetch(options){
    fetched.push(options);const r=responses[fetched.length-1];assert.ok(r,'unexpected redirect fetch');
    assert.equal(options.maxRedirects,0);assert.equal(options.maxRetries,0);
    return {status:()=>r.status,headers:()=>r.location?{location:r.location}:{},async dispose(){}};
  }};
  await bankRoute(route,base,p,method==='POST'?'purchase':null);return {fetched,aborted,fulfilled};
}
test('redirect handling never sends the next request off-origin or replays purchase',async()=>{
  for(const location of ['https://card.example.test/pay','//other.test/cart','https://user:password@fixture.test/usces-cart','/gateway/card']){
    const result=await routeFixture([{status:302,location}]);assert.equal(result.fetched.length,1);assert.ok(result.aborted);assert.equal(result.fulfilled,false);
  }
  for(const status of [307,308]){const r=await routeFixture([{status,location:'/usces-cart'}]);assert.equal(r.fetched.length,1);assert.ok(r.aborted);}
  const chain=await routeFixture([{status:303,location:'/usces-cart?complete=1'},{status:302,location:'https://card.example.test/pay'}]);
  assert.equal(chain.fetched.length,2);assert.equal(chain.fetched[1].method,'GET');assert.equal(chain.fetched[1].postData,'');assert.ok(chain.aborted);
});
test('same-site completion redirect is followed as GET with no purchase body',async()=>{
  const r=await routeFixture([{status:303,location:'/usces-cart?complete=1'},{status:200}]);
  assert.equal(r.fetched.length,2);assert.equal(r.fetched[1].method,'GET');assert.ok(r.fulfilled);assert.equal(r.aborted,false);
});
