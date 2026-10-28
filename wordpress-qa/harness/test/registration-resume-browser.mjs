import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
const app=await startUI({port:0,demo:true}),browser=await chromium.launch();
try{
 const page=await browser.newPage();let login=null,starts=0,attempts=0;
 await page.route('**/api/logins**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/logins/current')return route.fulfill({json:{login}});
  if(url.pathname.endsWith('/verify')){login.phase='verified';return route.fulfill({json:{id:login.id,phase:'verified'}});}
  if(url.pathname.endsWith('/cancel')){login=null;return route.fulfill({json:{ok:true}});}
  starts++;login={id:'fixture-login',projectId:null,role:null,baseURL:'https://example.test',environment:'staging',phase:'waiting'};
  return route.fulfill({json:login});
 });
 await page.route('**/api/registration',route=>{attempts++;return route.fulfill({status:400,json:{error:'一時的な接続エラー'}});});
 await page.goto(app.url);await page.locator('#registration-dialog').waitFor({state:'attached'});await page.locator('#new-site').click();
 const d=page.locator('#registration-dialog');await d.locator('[name=name]').fill('Draft site');await d.locator('[name=baseURL]').fill('https://example.test/sub');
 await d.locator('[name=publicPassword]').fill('do-not-persist');await d.locator('[name=writes]').uncheck();
 await d.locator('#registration-login').click();await expect(d.locator('#registration-login-state')).toContainText('開きました');
 assert(!await page.evaluate(()=>JSON.stringify(sessionStorage).includes('do-not-persist')));
 await page.reload();await expect(d).toBeVisible();
 await expect(d.locator('[name=name]')).toHaveValue('Draft site');await expect(d.locator('[name=publicPassword]')).toHaveValue('');await expect(d.locator('[name=writes]')).not.toBeChecked();
 await expect(d.locator('#registration-login-state')).toContainText('引き継');
 await d.locator('#registration-save').click();await expect(d.locator('#registration-status')).toContainText('一時的');
 await page.reload();await expect(d).toBeVisible();await expect(d.locator('#registration-login-state')).toContainText('確認済み');
 await d.locator('[name=name]').fill('Corrected site');await d.locator('#registration-save').click();await expect(d.locator('#registration-status')).toContainText('一時的');
 assert.equal(starts,1);assert.equal(attempts,2);
 login=null;await page.reload();await expect(d.locator('[name=name]')).toHaveValue('Corrected site');await expect(d.locator('#registration-login-state')).toContainText('期限切れ');
 await d.locator('#registration-pause').click();await page.reload();await expect(d).toBeHidden();await page.locator('#new-site').click();await expect(d.locator('[name=name]')).toHaveValue('Corrected site');
 await d.locator('#registration-cancel').click();await page.reload();await page.locator('#registration-dialog').waitFor({state:'attached'});await page.locator('#new-site').click();await expect(d.locator('[name=name]')).toHaveValue('');
 console.log('Reload restores inputs and waiting/verified login; retry reuses login; expired login retains draft');
}finally{await browser.close();await app.close();}
