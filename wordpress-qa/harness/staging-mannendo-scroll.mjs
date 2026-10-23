import fs from 'node:fs';
import path from 'node:path';
import {request,chromium} from '@playwright/test';
const origin='https://mannendo-test.rgr.jp',out=path.resolve('../../debug-evidence/mannendo-staging');
const client=await request.newContext({baseURL:origin});await client.get('/?password-protected=login');
await client.post('/?password-protected=login',{form:{password_protected_pwd:process.env.WPQA_SITE_PASSWORD,password_protected_cookie_test:'1','password-protected':'login',redirect_to:origin+'/'}});
if((await client.get('/')).url().includes('password-protected'))throw Error('Authentication failed');
const browser=await chromium.launch(),context=await browser.newContext({storageState:await client.storageState()});
await context.route('**/*',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.abort());
const results=[];
try {
 for(const width of [1280,390])for(const [id,url] of [['home','/'],['shopguide','/shopguide'],['qa','/qa'],['cart','/usces-cart']]){
  const page=await context.newPage();await page.setViewportSize({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+url);await page.waitForTimeout(1500);
  const height=await page.evaluate(()=>document.documentElement.scrollHeight);
  for(let y=0;y<height+900;y+=450){await page.mouse.wheel(0,450);await page.waitForTimeout(180);}
  await page.waitForTimeout(1000);await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(700);
  const file=`scroll-${id}-${width}.png`;await page.screenshot({path:path.join(out,file),fullPage:true});
  const state=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,text:document.body.innerText,hiddenAnimated:[...document.querySelectorAll('.wow')].filter(e=>getComputedStyle(e).visibility==='hidden').length}));
  results.push({id,url,width,file,errors,...state});console.log(`${id} ${width}: errors=${errors.length}; hidden=${state.hiddenAnimated}`);await page.close();
 }
}finally{fs.writeFileSync(path.join(out,'scroll-evidence.json'),JSON.stringify(results,null,2));await browser.close();await client.dispose();}
