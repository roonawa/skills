import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
const scratch=path.resolve('.selftest','settings-'+Date.now());fs.mkdirSync(scratch,{recursive:true});
const fixture=createServer((req,res)=>{
  if(req.url==='/wp-json/wp/v2/settings'){
    res.setHeader('Content-Type','application/json');
    if(req.headers.authorization!=='Basic '+Buffer.from('qa:fixture-password').toString('base64')){res.statusCode=403;res.end('{}');return;}
    res.end(JSON.stringify({timezone:'Asia/Tokyo',secret:'never-record-this'}));return;
  }
  res.setHeader('Content-Type','text/html');
  if(req.url==='/wp-admin/options-reading.php'){
    res.end(req.headers.cookie?.includes('session=fixture-session')?'<div id="wpadminbar">Admin</div><input id="blog_public" type="checkbox">':'<form>Login</form>');return;
  }
  res.end('<h1>Fixture</h1>');
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${fixture.address().port}`;
const stateFile=path.join(scratch,'session.json');fs.writeFileSync(stateFile,JSON.stringify({cookies:[{name:'session',value:'fixture-session',domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]}));
const storeDir=path.join(scratch,'projects');let app=await startUI({storeDir,port:0});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(app.url);await page.getByRole('button',{name:'＋ サイトを登録'}).click();
 await page.locator('#registration-advanced').click();const dialog=page.locator('dialog:has(#site-editor)'),site=dialog.locator('#site-fields');
 await site.locator('[data-key=name]').fill('登録テストサイト');await site.locator('[data-key=baseURL]').fill(origin);await site.locator('[data-key=environment]').selectOption('local');
 await dialog.locator('#add-admin').click();
 let row=dialog.locator('[data-kind=admin]').nth(0);await row.locator('[data-key=id]').fill('timezone');await row.locator('[data-key=title]').fill('タイムゾーン');await row.locator('[data-key=expected]').fill('Asia/Tokyo');
 await dialog.locator('#add-admin').click();row=dialog.locator('[data-kind=admin]').nth(1);
 await row.locator('[data-key=id]').fill('indexing');await row.locator('[data-key=source]').selectOption('browser');await row.locator('[data-key=path]').fill('/wp-admin/options-reading.php');await row.locator('[data-key=selector]').fill('#blog_public');await row.locator('[data-key=read]').selectOption('checked');await row.locator('[data-key=expectedType]').selectOption('boolean');await row.locator('[data-key=expected]').fill('false');
 await dialog.locator('#auth-user').fill('qa');await dialog.locator('#auth-password').fill('fixture-password');await dialog.locator('#auth-state').setInputFiles(stateFile);
 await page.screenshot({path:path.join(scratch,'registration.png'),fullPage:true});
 await dialog.locator('#editor-save').click();await expect(dialog).not.toBeVisible({timeout:15000});await expect(page.locator('#project-name')).toContainText('登録テストサイト');
 const boot=await(await fetch(app.url+'/api/bootstrap')).json();const id=boot.projects[0].id;
 const savedSettings=await(await fetch(app.url+'/api/projects/'+id+'/settings')).json();
 assert.equal(savedSettings.config.checks.filter(x=>x.id.startsWith('coverage-')).length,31);
 assert.equal(savedSettings.config.visuals.length,2);
 assert.ok(savedSettings.config.checks.some(x=>x.id==='coverage-order-cleanup'&&x.required));
 assert.equal((await fetch(app.url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 const run=async()=>{await page.locator('#suite-select').selectOption('admin');await page.locator('#run-button').click();await page.getByText('実行中',{exact:true}).first().waitFor();await page.getByText('実行が完了しました',{exact:true}).waitFor({timeout:90000});};
 await run();await expect(page.locator('#metric-pass')).toHaveText('2');
 await page.locator('#edit-site').click();await expect(dialog.locator('#auth-password')).toHaveValue('');await expect(dialog.locator('#rest-state')).toContainText('登録済み');
 await dialog.locator('[data-kind=admin]').first().locator('[data-key=expected]').fill('UTC');await dialog.locator('#editor-save').click();await expect(dialog).not.toBeVisible();
 await run();await expect(page.locator('#metric-fail')).toHaveText('1');
 await page.locator('[data-group="admin.timezone"]').click();
  await page.getByRole('button',{name:'admin.timezone',exact:false}).click();await expect(page.locator('#detail')).toContainText('UTC');
 await page.screenshot({path:path.join(scratch,'registered-results.png'),fullPage:true});
 const record=fs.readFileSync(path.join(storeDir,id+'.json'),'utf8');for(const secret of ['fixture-password','fixture-session'])assert.ok(!record.includes(secret));
 const state=await(await fetch(app.url+'/api/projects/'+id)).json();const detail=await(await fetch(app.url+'/api/projects/'+id+'/runs/'+state.runs[0].runId)).json();
 assert.ok(!JSON.stringify(detail).includes('fixture-password'));assert.ok(!JSON.stringify(detail).includes('fixture-session'));
 await app.close();app=await startUI({storeDir,port:0});await page.goto(app.url);await expect(page.locator('#project-name')).toContainText('登録テストサイト');
 await page.locator('#edit-site').click();await expect(dialog.locator('#rest-state')).toContainText('登録済み');await dialog.locator('#clear-rest').check();await dialog.locator('#clear-browser').check();await dialog.locator('#editor-save').click();await expect(dialog).not.toBeVisible();
 await page.locator('#edit-site').click();await expect(dialog.locator('#rest-state')).toHaveText('未登録');await expect(dialog.locator('#browser-state')).toHaveText('未登録');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(scratch,'settings-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('Settings UI acceptance passed: '+scratch);
}finally{await browser.close();await app.close();await new Promise(r=>fixture.close(r));}
