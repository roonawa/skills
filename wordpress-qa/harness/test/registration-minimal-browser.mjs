import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
const app=await startUI({port:0,demo:true}),browser=await chromium.launch();
// Visible form controls inside the dialog, named by field name, id or text.
const visibleControls=d=>d.evaluate(dialog=>[...dialog.querySelectorAll('input,select,textarea,button,summary')].filter(el=>el.checkVisibility()).map(el=>el.name||el.id||el.textContent.trim()));
try{
 const page=await browser.newPage();await page.goto(app.url);await page.locator('#registration-dialog').waitFor({state:'attached'});
 await page.locator('#new-site').click();
 const d=page.locator('#registration-dialog'),advanced=d.locator('#registration-advanced-settings'),indexable=d.locator('[name=indexable]');
 await expect(d).toBeVisible();
 assert.deepEqual(await visibleControls(d),['name','baseURL','environment','publicPassword','indexable','registration-login','詳細設定（技術担当向け）','registration-pause','registration-cancel','registration-save']);
 await expect(advanced).not.toHaveAttribute('open','');
 await expect(advanced.locator(':scope>summary')).toHaveText('詳細設定（技術担当向け）');
 await expect(advanced).toContainText('通常は変更不要です。自動取得と結果画面の『次にやること』で設定されます。');
 await advanced.locator(':scope>summary').click();
 for(const n of ['timezone','bankOrder','loginPath','adminPath','testEmail','writes','sensitivePaths','maxPages'])await expect(advanced.locator(`[name=${n}]`)).toBeVisible();
 await expect(advanced).toContainText('共通の操作テスト');await expect(advanced.locator('#registration-advanced')).toBeVisible();await expect(advanced.locator('#registration-preparation')).toBeVisible();
 await advanced.locator(':scope>summary').click();
 // Untouched: the default follows the environment both ways.
 await expect(indexable).not.toBeChecked();
 await d.locator('[name=environment]').selectOption('production');await expect(indexable).toBeChecked();
 await d.locator('[name=environment]').selectOption('staging');await expect(indexable).not.toBeChecked();
 // An untouched draft keeps following the environment after reload.
 await page.reload();await expect(d).toBeVisible();await d.locator('[name=environment]').selectOption('production');await expect(indexable).toBeChecked();
 await d.locator('[name=environment]').selectOption('staging');await expect(indexable).not.toBeChecked();
 // Once the user sets it, environment changes (and a reload) keep the choice.
 await indexable.check();await d.locator('[name=environment]').selectOption('production');await d.locator('[name=environment]').selectOption('local');await expect(indexable).toBeChecked();
 await page.reload();await expect(d).toBeVisible();await d.locator('[name=environment]').selectOption('staging');await expect(indexable).toBeChecked();
 await indexable.uncheck();await d.locator('[name=environment]').selectOption('production');await expect(indexable).not.toBeChecked();
 // Discarding the input restores the untouched default.
 await d.locator('#registration-cancel').click();await page.locator('#new-site').click();await d.locator('[name=environment]').selectOption('production');await expect(indexable).toBeChecked();
 await d.locator('[name=environment]').selectOption('staging');
 // An invalid hidden field opens the section and shows the error.
 await advanced.locator(':scope>summary').click();await advanced.locator('[name=testEmail]').fill('not-an-email');await advanced.locator(':scope>summary').click();
 await expect(advanced.locator('[name=testEmail]')).toBeHidden();
 await d.locator('[name=name]').fill('Minimal');await d.locator('[name=baseURL]').fill('https://example.test');
 await d.locator('#registration-save').click();
 await expect(advanced).toHaveAttribute('open','');
 await expect(d.locator('#registration-field-testEmail')).toBeVisible();await expect(advanced.locator('[name=testEmail]')).toBeFocused();
 await expect(advanced.locator('[name=testEmail]')).toHaveAttribute('aria-invalid','true');
 // Phone width: no horizontal overflow, with the section closed or open.
 await page.setViewportSize({width:390,height:800});
 for(const open of [true,false]){
  await advanced.evaluate((el,open)=>el.open=open,open);
  const sizes=await page.evaluate(()=>{const b=document.querySelector('#registration-dialog .editor-body'),dl=document.querySelector('#registration-dialog');return {page:document.documentElement.scrollWidth,body:[b.scrollWidth,b.clientWidth],dialog:[dl.scrollWidth,dl.clientWidth],right:dl.getBoundingClientRect().right};});
  assert(sizes.page<=390,JSON.stringify(sizes));assert(sizes.body[0]<=sizes.body[1],JSON.stringify(sizes));assert(sizes.dialog[0]<=sizes.dialog[1],JSON.stringify(sizes));assert(sizes.right<=390,JSON.stringify(sizes));
 }
 console.log('PASS registration shows only minimal fields; advanced settings closed, indexable default follows environment until touched, hidden errors open the section, 390px fits');
}finally{await browser.close();await app.close();}
