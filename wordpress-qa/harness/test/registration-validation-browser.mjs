import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
const app=await startUI({port:0,demo:true});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.goto(app.url);
 await page.locator('#new-site').click();
 const dialog=page.locator('#registration-dialog');
 await dialog.locator('#registration-save').click();
 await expect(dialog.locator('[name=name]')).toHaveAttribute('aria-invalid','true');
 await expect(dialog.locator('[name=baseURL]')).toHaveAttribute('aria-invalid','true');
 await expect(dialog.locator('[name=name]')).toBeFocused();
 await dialog.locator('[name=name]').fill('Fixture');
 await expect(dialog.locator('[name=name]')).not.toHaveAttribute('aria-invalid','true');
 await dialog.locator('[name=baseURL]').fill('https://example.test');
 await dialog.locator('[name=bankOrder]').check();
 await dialog.locator('[name=contactFormId]').fill('12');
 await dialog.locator('#registration-save').click();
 for(const n of ['testEmail','productPath','expectedTotal'])await expect(dialog.locator(`[name=${n}]`)).toHaveAttribute('aria-invalid','true');
 await expect(dialog.locator('#registration-field-testEmail')).toContainText('入力');
 await dialog.locator('[name=bankOrder]').uncheck();
 await dialog.locator('[name=contactFormId]').fill('');
 await dialog.locator('#registration-save').click();
 await expect(dialog.locator('[name=productPath]')).not.toHaveAttribute('aria-invalid','true');
 await expect(dialog.locator('#registration-status')).toContainText('ログイン');
 console.log('Registration validation: required, conditional, correction, focus and authentication feedback passed');
}finally{await browser.close();await app.close();}
