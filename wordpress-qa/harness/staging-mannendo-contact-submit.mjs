import fs from 'node:fs';
import path from 'node:path';
import {request,chromium} from '@playwright/test';
const origin='https://mannendo-test.rgr.jp';
const out=path.resolve('../../debug-evidence/mannendo-staging/submit-tests');fs.mkdirSync(out,{recursive:true});
const client=await request.newContext({baseURL:origin});
await client.get('/?password-protected=login');
await client.post('/?password-protected=login',{form:{password_protected_pwd:process.env.WPQA_SITE_PASSWORD,password_protected_cookie_test:'1','password-protected':'login',redirect_to:origin+'/'}});
const home=await client.get('/');
if(home.url().includes('password-protected')){console.log('Password protection login rejected');await client.dispose();process.exit(2);}
const browser=await chromium.launch();
const context=await browser.newContext({storageState:await client.storageState()});
const page=await context.newPage();

const marker=path.join(out,'contact-submit-started.json');if(fs.existsSync(marker))throw Error('Existing submission marker; do not resend');
const token='WPQA-CONTACT-'+new Date().toISOString().replace(/[^0-9]/g,'');
const evidence={token,at:new Date().toISOString(),responses:[],errors:[]};
page.on('pageerror',e=>evidence.errors.push(e.message));
page.on('response',async res=>{if(res.url().includes('/contact-forms/')&&res.url().endsWith('/feedback')){try{const b=await res.json();evidence.responses.push({http:res.status(),status:b.status,message:b.message,invalidFields:b.invalid_fields});}catch{}}});
try{
 await page.goto(origin+'/contact');
 for(let y=0;y<5000;y+=450){await page.mouse.wheel(0,450);await page.waitForTimeout(180);}
 await page.locator('[name="contact-name"]').fill('動作確認テスト・対応不要');
 await page.locator('[name="contact-email"]').fill('webinfo@ailesys.co.jp');
 await page.locator('[name="contact-message"]').fill(token+' テストサイトの問い合わせ・通知確認です。営業対応不要。QA検証用のメッセージです。');
 for(let y=0;y<5000;y+=450){await page.mouse.wheel(0,450);await page.waitForTimeout(120);}
 await page.locator('[name="contact-accept"]').check();
 await page.screenshot({path:path.join(out,'contact-before-submit.png'),fullPage:true});
 fs.writeFileSync(marker,JSON.stringify({token,at:new Date().toISOString(),email:'webinfo@ailesys.co.jp'}));
 await page.locator('input[type=submit][value="送信"]').click();
 await page.waitForTimeout(8000);
 evidence.text=await page.locator('body').innerText();evidence.url=page.url();
 await page.screenshot({path:path.join(out,'contact-after-submit.png'),fullPage:true});
 console.log(JSON.stringify(evidence));
}finally{fs.writeFileSync(path.join(out,'contact-submission-evidence.json'),JSON.stringify(evidence,null,2));await browser.close();await client.dispose();}
