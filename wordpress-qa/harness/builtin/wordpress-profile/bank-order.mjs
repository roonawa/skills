import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {load} from 'cheerio';
import {ensure,readSettings,requireWrites,sameOrigin} from './helpers.mjs';
import {preparePublicGate} from '../../lib/registration-gate.mjs';

// Registration schema: bankOrder:true, writes:true, productPath, testEmail,
// customerPrefecture, bankPaymentLabel, expectedTotal (positive integer JPY).
// Defaults: cartPath:'/usces-cart', adminPath:'/wp-admin/'. Customer data is
// deliberately fixed QA dummy data, never copied from the administrator state.
// Checkout evidence: operations/common.mjs and bank-submission-evidence.json.
// Admin controls were subsequently verified by authorized read-only inspection.
export const bankOrderSupport=Object.freeze({checkout:'complete',submission:true,cancellation:true});
// Local evidence audit (no network): operations/*.mjs, staging-mannendo-*.mjs,
// submit-tests/admin-followup.json, coverage-evidence/admin-observations.json,
// both cancelled-order screenshots, blockers22-discovery.json and 16 trace ZIPs.
// Follow-up: authorized read-only staging inspection on 2026-10-26 verified
// note search and canceled order 1036. No order/update POST was executed.
export const bankCancellationEvidence=Object.freeze({
  verified:Object.freeze([
    'Order list menu target: admin.php?page=usces_orderlist (blockers22-discovery.json and saved admin HTML).',
    'Edit screenshots: 対応状況 displays キャンセル; two 設定を更新 buttons; 備考, 支払方法 and 総合計金額 are visible.',
    'Order 1035 screenshot shows 受注データを更新しました。; order 1036 report records list and reopened-detail verification.',
    'Read-only HTML: form_tablesearch, search[order_column][0]=note, search[order_word_term][0]=contain, searchIn; historical exact token returns only order 1036.',
    'Read-only HTML: order_editpost_form POST page=usces_orderlist&order_action=editpost; offer[taio]=cancel, update_order_edit; persisted order 1036 status=cancel.',
  ]),
  missing:Object.freeze([]),
});
export const missingBankAdapter='BLOCKED: Welcart admin layout differs from the verified adapter; purchase requires successful cancellation preflight';

export function requireBankOrder(config,profile){
  requireWrites(config,profile);
  ensure(profile.bankOrder===true,'BLOCKED: bankOrder=true required');
}
export function readBankSettings(config,env=process.env){
  let raw;
  try{raw=JSON.parse(env.WPQA_UI_PROFILE);}catch{throw Error('BLOCKED: invalid bank profile JSON');}
  ensure(raw&&typeof raw==='object'&&!Array.isArray(raw),'BLOCKED: invalid bank profile');
  requireBankOrder(config,raw); // Production rejection precedes state/browser access.
  const profile={cartPath:'/usces-cart',adminPath:'/wp-admin/',...raw};
  const {base,state}=readSettings(config,{...env,WPQA_UI_PROFILE:JSON.stringify({writes:true,adminPath:profile.adminPath})});
  for(const key of ['productPath','cartPath','adminPath']){
    const value=profile[key];
    ensure(typeof value==='string'&&/^\/(?!\/)[A-Za-z0-9_/-]+$/.test(value)&&!value.includes('//')&&!value.split('/').includes('..'),'BLOCKED: invalid '+key);
    sameOrigin(value,base.href);
  }
  ensure(profile.productPath!==profile.cartPath&&!profile.productPath.startsWith(profile.adminPath)&&!profile.cartPath.startsWith(profile.adminPath),'BLOCKED: checkout paths overlap');
  ensure(typeof profile.testEmail==='string'&&profile.testEmail.length<=254&&/^[^\s@<>\x00-\x1f\x7f]+@[^\s@<>\x00-\x1f\x7f]+\.[^\s@<>\x00-\x1f\x7f]+$/.test(profile.testEmail),'BLOCKED: exact testEmail required');
  ensure(typeof profile.customerPrefecture==='string'&&/^(?:北海道|東京都|大阪府|京都府|[一-龠]{2,3}県)$/.test(profile.customerPrefecture),'BLOCKED: invalid customerPrefecture');
  // This evidenced Japanese layout supports bank transfer only; never accept a
  // configurable credit/card/gateway label masquerading as the bank option.
  ensure(typeof profile.bankPaymentLabel==='string'&&/^(?:銀行振込|銀行振り込み)(?:[（(][^\r\n<>]{1,60}[）)])?$/.test(profile.bankPaymentLabel)&&!/カード|credit|card|paypal/i.test(profile.bankPaymentLabel),'BLOCKED: bank-transfer payment label required');
  ensure(Number.isSafeInteger(profile.expectedTotal)&&profile.expectedTotal>0,'BLOCKED: positive integer expectedTotal required');
  for(const cookie of state.cookies)ensure(cookie.domain.replace(/^\./,'')===base.hostname,'BLOCKED: admin cookies must be scoped to this site');
  return {profile,base,state};
}
export function bankMarker(token){
  ensure(typeof token==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(token),'BLOCKED: invalid case token');
  return `wpqa-bank-${createHash('sha256').update(token).digest('hex').slice(0,16)}-${randomUUID()}`;
}
export function bankNote(marker){
  ensure(/^wpqa-bank-[a-f0-9]{16}-[a-f0-9-]{36}$/.test(marker),'BLOCKED: invalid bank marker');
  return `${marker} QA動作確認用テスト注文。発送・請求不要。`;
}
export function parseBankTotal(value){
  ensure(typeof value==='string','BLOCKED: missing total');
  const match=value.trim().match(/^(?:[¥￥]\s*)?((?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+))(?:\s*円)?$/);
  const total=match?Number(match[1].replaceAll(',','')):NaN;
  ensure(Number.isSafeInteger(total)&&total>=0,'BLOCKED: ambiguous total');
  return total;
}
// Extract exact labeled lines observed in the confirmation snapshot. A total
// elsewhere in the page or a payment label in navigation cannot pass this check.
export function assertBankConfirmation(text,profile,marker){
  const lines=text.split(/\r?\n/).map(s=>s.trim());
  const read=label=>{
    const rows=lines.filter(s=>s.replace(/^[\s\t]+/,'').startsWith(label+'\t'));
    ensure(rows.length===1,'BLOCKED: missing or ambiguous confirmation '+label);
    return rows[0].slice(label.length).trim();
  };
  ensure(read('支払方法')===profile.bankPaymentLabel,'BLOCKED: final payment mismatch');
  ensure(parseBankTotal(read('総合計金額'))===profile.expectedTotal,'BLOCKED: final total mismatch');
  ensure(read('備考')===bankNote(marker),'BLOCKED: final marker mismatch');
}

export function beginBankAttempt(config,context,marker){
  bankNote(marker);
  ensure(context?.config?.baseURL===config.baseURL&&context.config.environment===config.environment&&context.config.allowTestWrites===true,'BLOCKED: runner context mismatch');
  const dir=context.configPath?path.dirname(context.configPath):context.configDir;
  ensure(typeof dir==='string'&&path.isAbsolute(dir)&&typeof context.runDir==='string'&&path.isAbsolute(context.runDir),'BLOCKED: durable bank directories required');
  const pending=path.join(fs.realpathSync(dir),'profile-bank-pending.json');
  const evidence=path.join(fs.realpathSync(context.runDir),marker+'.json');
  const mutex=pending+'.lock';
  try{fs.mkdirSync(mutex);}catch{throw Error('BLOCKED: bank attempt locked; inspect recovery evidence');}
  const write=(file,data,flag)=>{
    const fd=fs.openSync(file,flag,0o600);
    try{fs.writeFileSync(fd,JSON.stringify(data,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  };
  try{
    if(fs.existsSync(pending)){
      const stat=fs.lstatSync(pending);
      ensure(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<8192,'BLOCKED: invalid bank pending record');
      const previous=JSON.parse(fs.readFileSync(pending,'utf8'));
      ensure(['not_submitted','cancelled'].includes(previous.status),'BLOCKED: unresolved bank attempt; inspect token in authenticated order list before retry');
      fs.unlinkSync(pending);
    }
    let record={marker,status:'pending',submissionEnabled:true,startedAt:new Date().toISOString(),support:bankOrderSupport,cancellationEvidence:bankCancellationEvidence,recovery:'Never repeat purchase while pending. Search the exact marker in authenticated Welcart orders; verify exact note, customer, payment, total and order ID before cancellation. Preserve this record until persisted cancellation is verified.'};
    write(pending,record,'wx');write(evidence,record,'wx');
    const persist=patch=>{
      record={...record,...patch,updatedAt:new Date().toISOString()};
      // Pending first: a crash must not leave a resolved record before intent.
      write(pending,record,'w');write(evidence,record,'w');
    };
    return {submission(){ensure(record.status==='pending','BLOCKED: duplicate purchase intent');persist({status:'submission_pending'});},
      matched(id){ensure(/^\d+$/.test(id),'BLOCKED: invalid order ID');persist({orderId:id});},
      cancelled(id){ensure(record.status==='submission_pending'&&record.orderId===id,'BLOCKED: cancellation identity mismatch');persist({status:'cancelled'});},
      finish(stage){persist({status:record.status==='pending'?'not_submitted':record.status,stage});},
      get status(){return record.status;},close(){fs.rmdirSync(mutex);}};
  }catch(error){fs.rmdirSync(mutex);throw error;}
}

// The caller enables purchase once, only after durable intent and preflight.
export function bankRequestAllowed(request,base,profile,transition){
  let url;try{url=new URL(request.url());}catch{return false;}
  if(url.origin!==base.origin||url.username||url.password)return false;
  if(['GET','HEAD'].includes(request.method()))return !url.searchParams.has('purchase');
  if(request.method()!=='POST'||url.pathname!==profile.cartPath||url.search||!transition)return false;
  const headers=request.headers();
  if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(headers['content-type']??''))return false;
  const data=new URLSearchParams(request.postData()??'');
  const keys=[...data.keys()];
  if(keys.some(k=>/card|credit|settlement/i.test(k)))return false;
  if(keys.includes('purchase'))return transition==='purchase'&&data.getAll('purchase').length===1&&keys.every(k=>k==='purchase');
  if(data.has('offer[payment_name]')&&data.get('offer[payment_name]')!==profile.bankPaymentLabel)return false;
  const controls=keys.filter(k=>/^inCart\[/.test(k)||['customerinfo','deliveryinfo','confirm'].includes(k));
  return controls.length===1&&(transition==='add'?/^inCart\[/.test(controls[0]):controls[0]===transition);
}

export async function bankPublicState(config,base,state,env=process.env){
  // Journey-only runs bypass the CLI's public-gate setup. Refresh the viewing
  // gate here using WPQA_UI_SITE_PASSWORD without inheriting administrator auth.
  const gateEnv={WPQA_UI_SITE_PASSWORD:env.WPQA_UI_SITE_PASSWORD,WPQA_UI_PUBLIC_HEADERS:env.WPQA_UI_PUBLIC_HEADERS};
  await preparePublicGate({...config,headersEnv:'WPQA_UI_PUBLIC_HEADERS'},gateEnv);
  const isGate=name=>/^(?:bid_\d+_)?password_protected_auth$/.test(name);
  const cookies=new Map(state.cookies.filter(c=>isGate(c.name)&&c.domain.replace(/^\./,'')===base.hostname).map(c=>[c.name,{...c,domain:base.hostname,path:'/'}]));
  if(gateEnv.WPQA_UI_PUBLIC_HEADERS){
    let headers;try{headers=JSON.parse(gateEnv.WPQA_UI_PUBLIC_HEADERS);}catch{throw Error('BLOCKED: invalid public gate headers');}
    ensure(headers&&typeof headers==='object'&&!Array.isArray(headers),'BLOCKED: invalid public gate headers');
    for(const [key,header] of Object.entries(headers)){
      if(key.toLowerCase()!=='cookie')continue; // No Authorization or admin headers.
      ensure(typeof header==='string'&&!/[\r\n]/.test(header),'BLOCKED: invalid public gate cookie');
      for(const pair of header.split(';')){
        const i=pair.indexOf('=');if(i<1)continue;
        const name=pair.slice(0,i).trim(),value=pair.slice(i+1).trim();
        if(!isGate(name))continue;
        ensure(value&&!/[\x00-\x20\x7f]/.test(value),'BLOCKED: invalid gate cookie value');
        cookies.set(name,{name,value,domain:base.hostname,path:'/',httpOnly:true,secure:base.protocol==='https:',sameSite:'Lax'});
      }
    }
  }
  return {cookies:[...cookies.values()],origins:[]};
}

// Browser route.continue() does not reliably re-intercept a redirect chain.
// Fetch one hop at a time and fulfill only the terminal same-site response.
// POST-preserving redirects are rejected to prevent replaying purchase.
export async function bankRoute(route,base,profile,transition){
  if(!bankRequestAllowed(route.request(),base,profile,transition)){await route.abort();return;}
  let url=route.request().url(),method=route.request().method(),redirected=false;
  const responses=[];
  try{
    for(let hop=0;hop<10;hop++){
      const response=await route.fetch({url,method,maxRedirects:0,maxRetries:0,timeout:20000,...(redirected?{postData:''}:{})});responses.push(response);
      const status=response.status();
      if(![301,302,303,307,308].includes(status)){await route.fulfill({response});return;}
      const location=response.headers().location;ensure(location,'BLOCKED: redirect missing destination');
      const next=sameOrigin(location,url);ensure(next.origin===base.origin,'BLOCKED: off-origin redirect');
      const clean=s=>s.replace(/\/$/,'');
      ensure([profile.productPath,profile.cartPath,new URL(url).pathname].some(p=>clean(p)===clean(next.pathname))&&!next.searchParams.has('purchase'),'BLOCKED: unexpected checkout redirect');
      ensure(['GET','HEAD'].includes(method)||![307,308].includes(status),'BLOCKED: purchase replay redirect');
      if(method!=='HEAD')method='GET';url=next.href;redirected=true;
    }
    throw Error('BLOCKED: redirect loop');
  }catch{await route.abort();}
  finally{for(const response of responses)await response.dispose();}
}

function adminURL(base,profile,action){
  const url=new URL(profile.adminPath+'admin.php',base);
  url.searchParams.set('page','usces_orderlist');
  if(action)url.searchParams.set('order_action',action);
  return url;
}
function adminDocument(source){
  ensure(typeof source==='string'&&Buffer.byteLength(source)<8*1024*1024,'BLOCKED: invalid admin HTML');
  const $=load(source);ensure($('#wpadminbar').length===1,'BLOCKED: admin authentication unavailable');return $;
}
function one($,root,name){
  const field=root.find('[name]').filter((_,e)=>$(e).attr('name')===name);
  ensure(field.length===1&&!field.is('[disabled]'),'BLOCKED: admin control missing or ambiguous');return field;
}
function checkedAction(form,expected){
  ensure(form.length===1&&form.attr('method')?.toLowerCase()==='post'&&new URL(form.attr('action'),expected).href===expected.href,'BLOCKED: admin form target mismatch');
}
export function bankSearchForm(source,base,profile,marker){
  bankNote(marker);const $=adminDocument(source),form=$('#form_tablesearch');
  const url=adminURL(base,profile);checkedAction(form,url);
  ensure(one($,form,'search[order_column][0]').find('option[value="note"]').length===1&&one($,form,'search[order_word_term][0]').find('option[value="contain"]').length===1,'BLOCKED: note search unavailable');
  one($,form,'search[order_word][0]');one($,form,'searchIn');
  const nonce=one($,form,'wc_nonce').val();ensure(typeof nonce==='string'&&/^[a-zA-Z0-9]+$/.test(nonce),'BLOCKED: search nonce unavailable');
  return {url:url.href,form:{'search[order_column][0]':'note','search[order_word][0]':marker,'search[order_word_term][0]':'contain','search[order_column][1]':'','search[order_term]':'AND','search[product_column][0]':'','search[product_column][1]':'',searchIn:'検索開始',wc_nonce:nonce}};
}
function editLinks($,base,profile){
  return $('#mainDataTable a[href]').toArray().flatMap(e=>{
    const url=sameOrigin($(e).attr('href'),base);
    if(url.searchParams.get('order_action')!=='edit')return [];
    ensure(url.pathname===adminURL(base,profile).pathname&&url.searchParams.get('page')==='usces_orderlist'&&[...url.searchParams.keys()].every(k=>['page','order_action','order_id','wc_nonce'].includes(k)),'BLOCKED: invalid edit link');
    const id=url.searchParams.get('order_id');ensure(/^[1-9]\d*$/.test(id),'BLOCKED: invalid order ID');return [{id,url:url.href}];
  });
}
export function bankSearchMatches(source,base,profile,marker){
  const $=adminDocument(source),form=$('#form_tablesearch');
  ensure(one($,form,'search[order_column][0]').val()==='note'&&one($,form,'search[order_word][0]').val()===marker&&one($,form,'search[order_word_term][0]').val()==='contain','BLOCKED: search was not applied');
  const nav=$('.usces_tablenav_top');
  const match=nav.text().trim().match(/^(\d+)\s*\/\s*\d+\s*件/);
  ensure(nav.length===1&&match,'BLOCKED: search count unavailable');
  const links=editLinks($,base,profile),count=Number(match[1]);
  ensure(count<=1&&links.length===count,'BLOCKED: ambiguous or paginated order search');
  return links;
}

// Serialize the native edit form, retaining its current nonce and all order
// values. Only offer[taio] and the observed save submitter are changed. Never
// activate deletion, mail, recalculation or bulk action controls.
export function bankEdit(source,base,profile,expected){
  const $=adminDocument(source),form=$('#order_editpost_form'),url=adminURL(base,profile,'editpost');checkedAction(form,url);
  const value=name=>one($,form,name).val();
  const id=value('order_id');ensure(/^[1-9]\d*$/.test(id)&&value('order_action')==='editpost','BLOCKED: invalid edit identity');
  ensure(one($,form,'offer[taio]').attr('id')==='order_taio'&&one($,form,'offer[taio]').find('option[value="cancel"]').length===1,'BLOCKED: cancel control unavailable');
  ensure(one($,form,'update_order_edit').attr('type')==='submit','BLOCKED: save control unavailable');
  const numeric=name=>{const v=value(name);ensure(typeof v==='string'&&/^-?\d+$/.test(v)&&Number.isSafeInteger(Number(v)),'BLOCKED: invalid order amount');return Number(v);};
  const prices=form.find('input[name^="skuPrice["]');ensure(prices.length>0,'BLOCKED: order items missing');
  let total=0;
  prices.each((_,e)=>{const name=$(e).attr('name'),m=name.match(/^skuPrice\[(\d+)\]$/);ensure(m,'BLOCKED: invalid item control');const price=numeric(name),quantity=numeric(`quant[${m[1]}]`);ensure(price>=0&&quantity>0,'BLOCKED: invalid item amounts');total+=price*quantity;});
  // Formula observed in orderfunc.sumPrice: tax is additional tax only.
  total+=numeric('offer[discount]')+numeric('offer[shipping_charge]')+numeric('offer[cod_fee]')+numeric('offer[tax]')-numeric('offer[usedpoint]');
  ensure(Number.isSafeInteger(total)&&total>=0,'BLOCKED: invalid grand total');
  const status=value('offer[taio]');
  if(expected){
    ensure(id===expected.id&&value('offer[note]')===bankNote(expected.marker)&&value('customer[mailaddress]')===profile.testEmail&&value('customer[name1]')==='QAテスト注文'&&value('customer[name2]')==='発送不要'&&value('offer[payment_name]')===profile.bankPaymentLabel&&value('offer[receipt]')==='noreceipt'&&total===profile.expectedTotal&&['#none#','cancel'].includes(status),'BLOCKED: order ownership/payment/total/status mismatch');
  }
  const data=new URLSearchParams();
  form.find('input,select,textarea').each((_,e)=>{
    const field=$(e),name=field.attr('name'),type=(field.attr('type')??'text').toLowerCase();
    if(!name||field.is('[disabled]')||field.parents('fieldset[disabled]').length||['submit','button','reset','file','image'].includes(type)||(['checkbox','radio'].includes(type)&&!field.is('[checked]')))return;
    const val=field.val();
    if(field.is('select')&&val==null){ensure(!/^(offer|customer|delivery)\[/.test(name),'BLOCKED: dynamic order select is not initialized');return;}
    for(const v of Array.isArray(val)?val:[val??''])data.append(name,String(v));
  });
  ensure(data.get('wc_nonce')&&data.getAll('order_id').length===1&&data.getAll('offer[taio]').length===1,'BLOCKED: edit metadata unavailable');
  data.set('offer[taio]','cancel');data.set('update_order_edit',one($,form,'update_order_edit').val());
  return {id,status,total,url:url.href,data:data.toString()};
}

const adminOptions={maxRedirects:0,maxRetries:0,timeout:20000};
async function adminRead(client,url){
  const response=await client.get(url,adminOptions);
  try{ensure(response.status()===200,'BLOCKED: admin read unavailable');return await response.text();}finally{await response.dispose();}
}
export function bankAdmin(client,base,profile){
  const list=adminURL(base,profile).href;
  const search=async marker=>{
    const input=bankSearchForm(await adminRead(client,list),base,profile,marker);
    const response=await client.post(input.url,{...adminOptions,form:input.form});
    try{ensure(response.status()===200,'BLOCKED: admin search unavailable');return bankSearchMatches(await response.text(),base,profile,marker);}finally{await response.dispose();}
  };
  return {
    async preflight(marker){
      const source=await adminRead(client,list),$=adminDocument(source);
      bankSearchForm(source,base,profile,marker);
      const sample=editLinks($,base,profile)[0];
      ensure(sample,'BLOCKED: no existing order available to verify cancellation form before purchase');
      bankEdit(await adminRead(client,sample.url),base,profile);
      ensure((await search(marker)).length===0,'BLOCKED: marker already exists before purchase');
    },
    async cancel(marker,journal){
      const matches=await search(marker);ensure(matches.length===1,'BLOCKED: submitted order not uniquely found; pending recovery required');
      const order=matches[0],expected={id:order.id,marker};journal.matched(order.id);
      // Fresh detail, exact ownership checked immediately before sending save.
      const edit=bankEdit(await adminRead(client,order.url),base,profile,expected);
      if(edit.status!=='cancel'){
        const response=await client.post(edit.url,{...adminOptions,data:edit.data,headers:{'content-type':'application/x-www-form-urlencoded'}});
        try{ensure([200,302,303].includes(response.status()),'BLOCKED: cancellation response uncertain');}finally{await response.dispose();}
      }
      const reopened=await search(marker);
      ensure(reopened.length===1&&reopened[0].id===order.id,'BLOCKED: cancellation order identity changed');
      const saved=bankEdit(await adminRead(client,reopened[0].url),base,profile,expected);
      ensure(saved.status==='cancel','BLOCKED: cancellation not persisted');journal.cancelled(order.id);return order.id;
    },
  };
}

export async function run(args){
  const {config,token,attach=async()=>{},testInfo}=args;
  const {profile,base,state}=readBankSettings(config);
  const marker=bankMarker(token);
  let runner;
  try{runner=JSON.parse(fs.readFileSync(process.env.WPQA_CONTEXT,'utf8'));}catch{throw Error('BLOCKED: valid WPQA_CONTEXT required for durable bank evidence');}
  const journal=beginBankAttempt(config,runner,marker);
  let browser,context,adminContext,admin,stage='not_started',transition=null,submitted=false,completion=false,orderId,failed=false;
  testInfo?.setTimeout(120000);
  try{
    const {chromium}=await import('@playwright/test');
    // Test seam for offline orchestration fixtures; not a profile setting.
    browser=await (args.launchBrowser?args.launchBrowser():chromium.launch());
    adminContext=await browser.newContext({storageState:state,serviceWorkers:'block',javaScriptEnabled:false});
    admin=bankAdmin(adminContext.request,base,profile);
    await admin.preflight(marker);
    const publicState=await bankPublicState(config,base,state);
    context=await browser.newContext({storageState:publicState,serviceWorkers:'block',javaScriptEnabled:false});
    await context.route('**/*',route=>{
      const phase=transition;
      if(bankRequestAllowed(route.request(),base,profile,phase)&&route.request().method()==='POST')transition=null;
      return bankRoute(route,base,profile,phase);
    });
    const page=await context.newPage();page.setDefaultTimeout(config.timeoutMs||15000);
    const click=async(selector,step)=>{
      args.checkCancellation?.();transition=step;
      try{await page.locator(selector).click();}finally{transition=null;}
    };
    await page.goto(new URL(profile.productPath,base).href);
    transition='add';
    try{await page.getByRole('button',{name:'カートへ入れる',exact:true}).click();}finally{transition=null;}
    await click('input[name="customerinfo"]','customerinfo');
    for(const [key,value] of Object.entries({mailaddress1:profile.testEmail,mailaddress2:profile.testEmail,name1:'QAテスト注文',name2:'発送不要',name3:'テスト',name4:'ハッソウフヨウ',zipcode:'000-0000',address1:'QA検証用市',address2:'架空住所0-0',address3:'QAテストデータ',tel:'000-0000-0000'}))await page.locator(`input[name="customer[${key}]"]`).fill(value);
    await page.locator('select[name="customer[pref]"]').selectOption(profile.customerPrefecture);
    await click('input[name="deliveryinfo"]','deliveryinfo');
    const payments=page.locator('input[name="offer[payment_name]"]');
    const index=(await payments.evaluateAll(es=>es.map(e=>e.value))).map((v,i)=>v===profile.bankPaymentLabel?i:-1).filter(i=>i>=0);
    ensure(index.length===1,'BLOCKED: bank payment option missing or ambiguous');
    await payments.nth(index[0]).check();
    await page.locator('textarea[name="offer[note]"]').fill(bankNote(marker));
    await click('input[name="confirm"]','confirm');
    assertBankConfirmation(await page.locator('body').innerText(),profile,marker);
    const purchase=page.locator('input[name="purchase"]');
    ensure(await purchase.count()===1&&await purchase.isVisible(),'BLOCKED: purchase control missing or ambiguous');
    ensure(await purchase.evaluate(e=>e.form.action)===new URL(profile.cartPath,base).href,'BLOCKED: purchase destination mismatch');
    stage='confirmation_verified';
    args.checkCancellation?.();requireBankOrder(config,profile);
    journal.submission();submitted=true;stage='submission_pending';transition='purchase';
    try{await purchase.click();}finally{transition=null;}
    completion=(await page.locator('body').innerText()).includes('お買い上げありがとうございました。');
    ensure(completion,'BLOCKED: order completion not confirmed');stage='completion_verified';
  }catch{failed=true;
  }finally{
    // Cleanup deliberately ignores a cancellation signal after purchase starts.
    // Even a failed/lost completion response must attempt exact-marker cleanup.
    if(submitted){try{orderId=await admin.cancel(marker,journal);stage='cancelled';}catch{failed=true;stage='recovery_required';}}
    try{
      await context?.close();await adminContext?.close();await browser?.close();
    }finally{
      try{journal.finish(stage);await attach('bank-order',{marker,status:journal.status,stage,orderId,completion,support:bankOrderSupport,cancellationEvidence:bankCancellationEvidence,notificationDelivery:'unverified'});}
      finally{journal.close();}
    }
  }
  ensure(!failed&&completion&&journal.status==='cancelled','BLOCKED: bank journey incomplete; inspect sanitized bank evidence and pending journal before retry');
  return {marker,status:'cancelled',orderId,completion,notificationDelivery:'unverified'};
}
