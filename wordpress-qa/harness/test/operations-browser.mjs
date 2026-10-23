import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
const dir=path.resolve('.selftest/operations-'+Date.now());fs.mkdirSync(dir,{recursive:true});
for(const file of ['common.mjs','bank.mjs','contact.mjs'])fs.copyFileSync(path.resolve('../../debug-evidence/mannendo-staging/operations',file),path.join(dir,file));
let orders=0,messages=0;
const customer=['mailaddress1','mailaddress2','name1','name2','name3','name4','zipcode','address1','address2','address3','tel'].map(k=>`<input name="customer[${k}]">`).join('');
const server=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;const form=new URLSearchParams(body);let html='home';
 if(req.url==='/archives/2481')html='<form method="post" action="/usces-cart"><button name="inCart[2481]">カートへ入れる</button></form>';
 if(req.url==='/usces-cart'){
  html='<form method="post"><input type="submit" name="customerinfo" value="次へ"></form>';
  if(form.has('customerinfo'))html=`<form method="post">${customer}<select name="customer[pref]"><option>長野県</option></select><input type="submit" name="deliveryinfo" value="次へ"></form>`;
  if(form.has('deliveryinfo'))html='<form method="post"><input type="radio" name="offer[payment_name]" value="銀行振込"><textarea name="offer[note]"></textarea><input type="submit" name="confirm" value="確認"></form>';
  if(form.has('confirm'))html=`銀行振込 1,466 ${form.get('offer[note]')}<form method="post"><input type="submit" name="purchase" value="注文"></form>`;
  if(form.has('purchase')){orders++;html='お買い上げありがとうございました。';}
 }
 if(req.url==='/contact'){
  html='<form method="post"><input name="contact-name"><input name="contact-email"><textarea name="contact-message"></textarea><input type="checkbox" name="contact-accept"><input type="submit" value="送信"></form>';
  if(req.method==='POST'){messages++;html='送信完了しました';}
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ja"><body>'+html+'</body></html>');
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const config={name:'Operation fixture',headersEnv:'WPQA_FIXTURE_MISSING_HEADERS',baseURL:origin,environment:'local',allowTestWrites:true,pages:[{id:'home',path:'/',canonical:origin+'/',indexable:true}],visuals:[],journeys:['bank','contact'].map(id=>({id:id+'-operation',module:path.join(dir,id+'.mjs'),submissionLock:id+'-pending.json',title:id,explicitOnly:true,runWithSuite:true,handlesAuthentication:true,required:false,reason:'ローカル模擬送信'})),manual:[],outputDir:path.join(dir,'runs')};
const file=path.join(dir,'site.json');fs.writeFileSync(file,JSON.stringify(config));const app=await startUI({configPaths:[file],port:0});const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(app.url);
 await page.locator('#suite-select').selectOption('journey');await page.locator('#run-button').click();await expect(page.locator('#toast')).toHaveText('実行が完了しました',{timeout:90000});assert.equal(orders,0);assert.equal(messages,0);const standardRuns=fs.readdirSync(path.join(dir,'runs'),{withFileTypes:true}).filter(x=>x.isDirectory());assert.equal(standardRuns.length,1);const standardResult=JSON.parse(fs.readFileSync(path.join(dir,'runs',standardRuns[0].name,'results.json')));assert.deepEqual(standardResult.rows.filter(r=>r.selected).map(r=>r.id).sort(),['journey.bank-operation','journey.contact-operation']);assert.ok(standardResult.rows.filter(r=>r.selected).every(r=>r.status==='pass'));if(await page.locator('#cinema-verdict').isVisible())await page.locator('#cinema-verdict button').click();
 async function run(id,mode){
  await page.locator('#operation-tests').click();await page.locator('#operation-form select[name=operation]').selectOption(id+'-operation');await page.locator('#operation-form select[name=mode]').selectOption(mode);
  await page.locator('#operation-form input[name=confirmed]').check();await page.getByRole('button',{name:'自動操作を開始',exact:true}).click();
  await expect(page.locator('#toast')).toHaveText('実行が完了しました',{timeout:90000});
  const runs=fs.readdirSync(path.join(dir,'runs'),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort();return JSON.parse(fs.readFileSync(path.join(dir,'runs',runs.at(-1),'results.json')));
 }
 const preview=await run('bank','preview');assert.equal(orders,0);assert.equal(preview.rows.find(r=>r.selected).status,'pass');
 if(await page.locator('#cinema-verdict').isVisible())await page.locator('#cinema-verdict button').click();
 const contact=await run('contact','submit');assert.equal(messages,1);assert.equal(contact.rows.find(r=>r.selected).status,'pass');
 if(await page.locator('#cinema-verdict').isVisible())await page.locator('#cinema-verdict button').click();
 const duplicate=await run('contact','submit');assert.equal(messages,1);assert.equal(duplicate.rows.find(r=>r.selected).status,'blocked');
 if(await page.locator('#cinema-verdict').isVisible())await page.locator('#cinema-verdict button').click();
 await page.locator('#operation-tests').click();await page.locator('#operation-form select[name=operation]').selectOption('contact-operation');await page.locator('#operation-resolution').fill('模擬送信1件と完了表示を確認。再テスト可。');await page.locator('#release-operation').click();await expect(page.locator('#toast')).toContainText('前回の確認記録を保存');assert.equal(fs.existsSync(path.join(dir,'contact-pending.json')),false);await page.locator('#close-operations').click();
 const order=await run('bank','submit');assert.equal(orders,1);assert.equal(order.rows.find(r=>r.selected).status,'pass');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,orders,messages,duplicateBlocked:true,dir}));
}finally{await browser.close();await app.close();await new Promise(r=>server.close(r));}




