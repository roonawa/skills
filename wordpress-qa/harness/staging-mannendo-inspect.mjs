import fs from 'node:fs';
import path from 'node:path';
import {request,chromium} from '@playwright/test';
const origin='https://mannendo-test.rgr.jp';
const out=path.resolve('../../debug-evidence/mannendo-staging');fs.mkdirSync(out,{recursive:true});
const client=await request.newContext({baseURL:origin});
await client.get('/?password-protected=login');
await client.post('/?password-protected=login',{form:{password_protected_pwd:process.env.WPQA_SITE_PASSWORD,password_protected_cookie_test:'1','password-protected':'login',redirect_to:origin+'/'}});
const home=await client.get('/');
if(home.url().includes('password-protected')){console.log('Password protection login rejected');await client.dispose();process.exit(2);}
const browser=await chromium.launch();
const context=await browser.newContext({storageState:await client.storageState()});
const page=await context.newPage();
const data=[];
for(const p of (process.argv.slice(2).length?process.argv.slice(2):['/','/shopguide','/qa','/usces-cart','/contact','/sitemap'])){
 const response=await page.goto(origin+p,{waitUntil:'domcontentloaded'});
 await page.waitForTimeout(1000);
 const item=await page.evaluate(()=>({url:location.href,title:document.title,text:document.body.innerText.slice(0,18000),canonical:document.querySelector('link[rel="canonical"]')?.href,robots:document.querySelector('meta[name="robots"]')?.content,links:[...document.querySelectorAll('a[href]')].map(a=>({text:a.innerText.trim(),url:a.href})),forms:[...document.forms].map(f=>({action:f.action,method:f.method,fields:[...f.elements].map(e=>({tag:e.tagName,type:e.type,name:e.name,label:e.labels?.[0]?.innerText,value:e.type==='hidden'?'[hidden]':e.type==='password'?'[password]':e.value}))}))}));
 item.status=response?.status();data.push(item);
 if(p==='/')await page.screenshot({path:path.join(out,'home-initial.png'),fullPage:true});
 console.log(JSON.stringify({path:p,status:item.status,title:item.title,url:item.url,canonical:item.canonical,robots:item.robots,forms:item.forms.map(f=>({action:f.action,fields:f.fields.map(e=>e.name)}))}));
}
fs.writeFileSync(path.join(out,process.argv.slice(2).length?'product-inspection.json':'inspection.json'),JSON.stringify(data,null,2));
await browser.close();await client.dispose();
