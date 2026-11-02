import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
import {createSecretCodec} from '../ui/secret-codec.mjs';
import {hashPassword} from '../ui/shared-access.mjs';

// Loopback-only transport fixture models TLS termination; it does not verify TLS/Caddy.
const dir=path.resolve('.selftest','shared-pilot-'+Date.now());fs.mkdirSync(dir,{recursive:true});
const origin='https://qa.example.test';
const app=await startUI({port:0,storeDir:path.join(dir,'projects'),credentialCodec:createSecretCodec(randomBytes(32)),systemOptions:{admins:['tester']},aiOptions:{fetcher:async(url,options)=>new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({cases:[{pageIndex:0,targetIndex:-1,kind:'layout',viewport:'mobile',reason:'スマホの横はみ出し'}],questions:[],reviews:JSON.parse(JSON.parse(options.body).messages[0].content).reviewTargets.map(x=>({...x,reason:'構造確認'}))})}]}))},shared:{origin,users:[{name:'tester',...hashPassword('long-fixture-password-1234')}]}});
let fixtureURL,browser;
const proxy=http.createServer((req,res)=>{
 const headers={...req.headers,host:'qa.example.test'};
 if(headers.origin===fixtureURL)headers.origin=origin;
 const upstream=http.request(app.url+req.url,{method:req.method,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);
});
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));fixtureURL='http://127.0.0.1:'+proxy.address().port;
try{
 browser=await chromium.launch();const context=await browser.newContext({httpCredentials:{username:'tester',password:'long-fixture-password-1234'},viewport:{width:1440,height:1000}}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(fixtureURL);
 await expect(page.locator('#shared-pilot-notice')).toBeVisible();
 await page.locator('.site-actions button').last().click();
 const system=page.locator('dialog').filter({has:page.getByRole('heading',{name:'AI・接続先の設定',exact:true})});
 await system.locator('[name=key]').fill('sk-ant-fixture-only');await system.locator('[name=approved]').check();await system.locator('[name=enabled]').check();await page.route('**/api/system/settings',async route=>{if(route.request().method()!=='GET')throw Error('旧版に設定を送信してはいけません');const response=await route.fetch();const data=await response.json();delete data.evidenceApproved;await route.fulfill({response,json:data});});await system.locator('[data-save]').click();await expect(system.locator('[data-state]')).toContainText('画面とサーバーの版が一致していません');await expect(system.locator('[name=key]')).toHaveValue('sk-ant-fixture-only');await page.unroute('**/api/system/settings');await system.locator('[data-save]').click();await expect(system.locator('[data-state]')).toContainText('保存しました');await expect(system.locator('[name=key]')).toHaveValue('');await system.locator('[data-close]').click();await page.locator('#new-site').click();
 const form=page.locator('#site-editor');await expect(form).toBeVisible();await expect(form.locator('#login-start')).toBeVisible();
 await expect(form.locator('#auth-state')).toBeAttached();
 await form.locator('#site-fields [data-key=name]').fill('社内試用テスト');await form.locator('#site-fields [data-key=baseURL]').fill('https://example.test');await form.locator('#site-fields [data-key=baseURL]').press('Tab');
 await form.locator('#auth-password').fill('input-must-survive');
 await form.locator('[data-propose]').click();await expect(form.locator('[data-status]')).toContainText('候補1件');await form.locator('[data-choice]').check();await form.locator('[data-apply]').click();await expect(form.locator('[data-status]')).toContainText('反映しました');await expect(form.locator('#auth-password')).toHaveValue('input-must-survive');await form.locator('#auth-password').fill('');
 await form.locator('#editor-save').click();await expect(form).not.toBeVisible();await expect(page.locator('#project-name')).toContainText('社内試用テスト');
 await page.reload();await expect(page.locator('#project-name')).toContainText('社内試用テスト');
 await page.locator('#edit-site').click();await expect(page.locator('[data-c=id][value=ai-layout-0-mobile]')).toHaveCount(1);await page.locator('#editor-cancel').click();
 if(errors.length)throw Error(errors.join('\n'));
 await page.screenshot({path:path.join(dir,'shared-pilot-ui.png'),fullPage:true});
 console.log('PASS AI settings, synthetic API proposal, apply, input preservation, save and reload. '+dir);
}finally{await browser?.close();await new Promise(r=>proxy.close(r));await app.close();}
