import fs from 'node:fs';
import path from 'node:path';
import {request,chromium} from '@playwright/test';
const origin='https://mannendo-test.rgr.jp',out=path.resolve('../../debug-evidence/mannendo-staging/payment-followup');fs.mkdirSync(out,{recursive:true});
const client=await request.newContext({baseURL:origin});await client.get('/?password-protected=login');
await client.post('/?password-protected=login',{form:{password_protected_pwd:process.env.WPQA_SITE_PASSWORD,password_protected_cookie_test:'1','password-protected':'login',redirect_to:origin+'/'}});
if((await client.get('/')).url().includes('password-protected'))throw Error('Authentication failed');
const browser=await chromium.launch();const context=await browser.newContext({storageState:await client.storageState(),viewport:{width:1280,height:900}});
const page=await context.newPage(),evidence={checks:[],snapshots:[],errors:[],blockedRequests:[],cartRequests:[]};
evidence.dialogs=[];
page.on('dialog',async dialog=>{evidence.dialogs.push({type:dialog.type(),message:dialog.message()});if(page.url().startsWith(origin+'/usces-cart')&&/数量|削除|更新/.test(dialog.message()))await dialog.accept();else await dialog.dismiss();});
page.on('request',req=>{if(req.method()==='POST'&&req.url()===origin+'/usces-cart')evidence.cartRequests.push({keys:[...new URLSearchParams(req.postData()??'').keys()]});});
page.on('pageerror',e=>evidence.errors.push(e.message));
// Only cart add/update and moving to customer input are allowed. Never finalize an order or send a contact form.
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url());
 if(!['GET','HEAD'].includes(req.method())){
   const data=new URLSearchParams(req.postData()??'');
   const allowed=url.origin===origin&&url.pathname==='/usces-cart'&&[...data.keys()].some(k=>/^inCart\[/.test(k)||['upButton','customerinfo','deliveryinfo','confirm','backDelivery','backCart','delButton'].includes(k)||/^delButton\[/.test(k));
   if(!allowed){evidence.blockedRequests.push({url:url.origin+url.pathname,method:req.method()});return route.abort();}
 }
 await route.continue();
});
async function capture(name){
 await page.waitForTimeout(1500);
 const snapshot=await page.evaluate(()=>({url:location.href,text:document.body.innerText,forms:[...document.forms].map(f=>({action:f.action,fields:[...f.elements].map(e=>({tag:e.tagName,type:e.type,name:e.name,value:['hidden','password'].includes(e.type)?'[redacted]':e.value,required:e.required,disabled:e.disabled,options:e.options?[...e.options].map(o=>({value:o.value,text:o.text})):undefined}))}))}));
 snapshot.name=name;evidence.snapshots.push(snapshot);await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});console.log(JSON.stringify({name,url:snapshot.url,forms:snapshot.forms}));
 snapshot.cartControls=await page.locator('input[type=submit]').evaluateAll(es=>es.map(e=>({name:e.name,onclick:e.getAttribute('onclick')})));
}
try{
 await page.goto(origin+'/archives/2481');await page.getByRole('button',{name:'カートへ入れる',exact:true}).click();await page.waitForLoadState('domcontentloaded');
 await capture('cart-added');
 evidence.checks.push({id:'add-to-cart',pass:(await page.locator('body').innerText()).includes('パインブック リバーシブルクリップ ゆるカワ')&&page.url().includes('/usces-cart')});
 await page.locator('input[name="quant[0][2481][k302018]"]').fill('2');
 await page.getByRole('button',{name:'数量更新',exact:true}).click();await page.waitForLoadState('domcontentloaded');
 await capture('cart-quantity-two');
 evidence.checks.push({id:'quantity-limit',pass:evidence.dialogs.some(d=>d.message.includes('一度に1まで'))&&!(await page.locator('body').innerText()).includes('1,232'),expected:'購入上限1点を超えた入力は警告して更新しない',text:await page.locator('body').innerText()});
 await page.locator('input[name="quant[0][2481][k302018]"]').fill('1');
 await page.getByRole('button',{name:'数量更新',exact:true}).click();await page.waitForLoadState('domcontentloaded');await page.waitForTimeout(1500);
 await page.locator('input[name="customerinfo"]').click();await page.waitForLoadState('domcontentloaded');
 await capture('customer-input');
 evidence.checks.push({id:'customer-input-transition',pass:await page.locator('input[name="customer[name1]"]').count()>0});
 await page.locator('input[name="deliveryinfo"]').click();await page.waitForTimeout(1500);await capture('customer-empty-validation');
 evidence.checks.push({id:'customer-empty-validation',pass:(await page.locator('body').innerText()).includes('入力')&&await page.locator('input[name="customer[name1]"]').count()>0,text:await page.locator('body').innerText()});
 for(const [key,value] of Object.entries({mailaddress1:'qa-no-order@example.invalid',mailaddress2:'qa-no-order@example.invalid',name1:'動作確認',name2:'注文しない',name3:'ドウサカクニン',name4:'チュウモンシナイ',zipcode:'000-0000',address1:'検証用市',address2:'架空住所0-0',address3:'テストデータ',tel:'000-0000-0000'}))await page.locator(`input[name="customer[${key}]"]`).fill(value);
 await page.locator('select[name="customer[pref]"]').selectOption('長野県');
 await page.locator('input[name="deliveryinfo"]').click();await page.waitForTimeout(1500);await capture('delivery-payment-input');
 evidence.checks.push({id:'delivery-payment-transition',pass:await page.locator('input[name="customer[name1]"]').count()===0});

 await page.locator('input[name="offer[payment_name]"][value="銀行振込"]').check();
 await page.locator('input[name="confirm"]').click();
 await page.waitForLoadState('domcontentloaded');await capture('bank-order-confirmation');

 await page.locator('input[name="backDelivery"]').click();await page.waitForLoadState('domcontentloaded');
 await page.locator('select[name="offer[delivery_method]"]').selectOption('3');
 await page.locator('input[name="confirm"]').click();await page.waitForLoadState('domcontentloaded');await capture('packet-order-confirmation');
 await page.locator('input[name="backDelivery"]').click();await page.waitForLoadState('domcontentloaded');
 await page.locator('input[name="offer[payment_name]"][value="クレジットカード"]').check();
 await page.locator('input[name="confirm"]').click();await page.waitForLoadState('domcontentloaded');await capture('credit-order-confirmation');

}finally{fs.writeFileSync(path.join(out,'payment-options-evidence.json'),JSON.stringify(evidence,null,2));await browser.close();await client.dispose();}
