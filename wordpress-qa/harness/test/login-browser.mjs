import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
import {ProjectStore} from '../ui/project-store.mjs';
const scratch=path.resolve('.selftest','login-'+Date.now());fs.mkdirSync(scratch,{recursive:true});
const fixture=createServer(async(req,res)=>{
 res.setHeader('Content-Type','text/html');
 const logged=req.headers.cookie?.includes('wordpress_logged_in_fixture=fixture-session');
 if(req.url==='/wp-login.php'){
  if(req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;const data=new URLSearchParams(body);
   if(data.get('user')==='qa'&&data.get('pass')==='fixture-password'&&data.get('otp')==='123456'){
    res.setHeader('Set-Cookie','wordpress_logged_in_fixture=fixture-session; Path=/; HttpOnly; SameSite=Lax');res.statusCode=302;res.setHeader('Location','/wp-admin/profile.php');res.end();return;
   }
  }
  res.end('<h1>WordPress fixture login</h1><form method="post"><label>User<input name="user"></label><label>Password<input type="password" name="pass"></label><label>OTP<input name="otp"></label><button>Login</button></form>');return;
 }
 if(req.url==='/wp-admin/profile.php'){
  if(!logged){res.statusCode=302;res.setHeader('Location','/wp-login.php');res.end();return;}
  res.end('<div id="wpadminbar">Admin</div><form id="your-profile">Profile</form>');return;
 }
 if(req.url==='/wp-admin/options-reading.php'){res.end(logged?'<div id="wpadminbar">Admin</div><input id="blog_public" type="checkbox">':'<form>Login</form>');return;}
 res.end('<h1>Fixture</h1>');
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${fixture.address().port}`;
let loginBrowser;
const storeDir=path.join(scratch,'projects');const app=await startUI({storeDir,port:0,loginOptions:{launch:async()=>loginBrowser=await chromium.launch({headless:process.env.WPQA_LOGIN_HEADED!=='1'})}});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(app.url);await page.locator('#new-site').click();await page.locator('#registration-advanced').click();const dialog=page.locator('dialog:has(#site-editor)');
 await dialog.locator('#site-fields [data-key=name]').fill('ログイン検証');await dialog.locator('#site-fields [data-key=baseURL]').fill(origin);await dialog.locator('#site-fields [data-key=environment]').selectOption('local');
 await dialog.locator('#add-admin').click();const row=dialog.locator('[data-kind=admin]');await row.locator('[data-key=id]').fill('indexing');await row.locator('[data-key=source]').selectOption('browser');await row.locator('[data-key=path]').fill('/wp-admin/options-reading.php');await row.locator('[data-key=selector]').fill('#blog_public');await row.locator('[data-key=read]').selectOption('checked');await row.locator('[data-key=expectedType]').selectOption('boolean');await row.locator('[data-key=expected]').fill('false');
 await dialog.locator('#login-start').click();await expect(dialog.locator('#login-verify')).toBeVisible();await expect(dialog.locator('#editor-save')).toBeDisabled();
 await dialog.locator('#login-verify').click();await expect(dialog.locator('#editor-error')).toContainText('ログインを確認できません');
 const wp=loginBrowser.contexts()[0].pages()[0];
 await wp.getByLabel('User').fill('qa');await wp.getByLabel('Password').fill('fixture-password');await wp.getByLabel('OTP').fill('wrong');await wp.getByRole('button',{name:'Login'}).click();
 await dialog.locator('#login-verify').click();await expect(dialog.locator('#editor-error')).toContainText('ログインを確認できません');
 await wp.getByLabel('User').fill('qa');await wp.getByLabel('Password').fill('fixture-password');await wp.getByLabel('OTP').fill('123456');await wp.getByRole('button',{name:'Login'}).click();await wp.locator('#your-profile').waitFor();
 await loginBrowser.contexts()[0].addCookies([{name:'sso',value:'idp-secret',domain:'idp.test',path:'/'}]);
 await dialog.locator('#login-verify').click();await expect(dialog.locator('#login-status')).toContainText('ログイン確認済み');
 await page.screenshot({path:path.join(scratch,'verified-login.png'),fullPage:true});
 await dialog.locator('#editor-save').click();await expect(dialog).not.toBeVisible();
 const boot=await(await fetch(app.url+'/api/bootstrap')).json(),id=boot.projects[0].id;
 const settings=await(await fetch(app.url+'/api/projects/'+id+'/settings')).json();assert.equal(settings.credentials.browser,true);
 const decrypted=new ProjectStore(storeDir).prepare(id).env.WPQA_UI_ADMIN_STATE;
 assert.ok(!decrypted.includes('idp-secret'));assert.ok(!decrypted.includes('fixture-password'));
 assert.equal((await fetch(app.url+'/api/logins',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 const record=fs.readFileSync(path.join(storeDir,id+'.json'),'utf8');for(const secret of ['fixture-password','fixture-session','idp-secret'])assert.ok(!record.includes(secret));
 await page.locator('#suite-select').selectOption('admin');await page.locator('#run-button').click();await page.getByText('実行中',{exact:true}).first().waitFor();await page.getByText('実行が完了しました',{exact:true}).waitFor({timeout:90000});await expect(page.locator('#metric-pass')).toHaveText('1');
 // Cancelled reauthentication must retain the stored credential.
 await page.locator('#edit-site').click();await dialog.locator('#login-start').click();await expect(dialog.locator('#login-cancel')).toBeVisible();
 await page.reload();await page.locator('#edit-site').click();await expect(dialog.locator('#login-status')).toContainText('ログインが進行中');
 await dialog.locator('#login-cancel').click();await expect(dialog.locator('#login-start')).toBeEnabled();await dialog.locator('#editor-save').click();await expect(dialog).not.toBeVisible();
 assert.equal((await(await fetch(app.url+'/api/projects/'+id+'/settings')).json()).credentials.browser,true);
 assert.deepEqual(errors,[]);console.log('Login UI acceptance passed: '+scratch);
}finally{await browser.close();await app.close();await new Promise(r=>fixture.close(r));}
