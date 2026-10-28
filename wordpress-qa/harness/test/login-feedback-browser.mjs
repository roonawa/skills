import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';

const app=await startUI({port:0,demo:true});
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 let release,request;
 const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/logins',async route=>{
  request=route.request().postDataJSON();await gate;
  await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'接続先を確認してください'})});
 });
 await page.goto(app.url);
 await page.locator('#new-site').click();
 await page.locator('#registration-dialog [name=baseURL]').fill('https://example.test/retemp');
 await page.locator('#registration-login').click();
 await expect(page.locator('#registration-login-state')).toContainText('起動中');
 assert.equal(request.baseURL,'https://example.test');assert.equal(request.loginPath,'/retemp/wp-login.php');assert.equal(request.adminPath,'/retemp/wp-admin/');release();
 await expect(page.locator('#registration-login-state')).toContainText('接続先を確認してください');
 await expect(page.locator('#registration-login')).toBeEnabled();
 assert.equal(await page.locator('#registration-login-state').isVisible(),true);
 console.log('Login progress and failure are visible beside the login button');
} finally {await browser.close();await app.close();}
