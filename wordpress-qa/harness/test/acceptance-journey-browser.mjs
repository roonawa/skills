// Run from any directory: node test/registration-browser.mjs
// Uses only isolated loopback servers; saved artifacts stay in a unique .selftest directory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
import {SystemSettings} from '../ui/system-settings.mjs';
import {ProjectStore} from '../ui/project-store.mjs';
import {builtinModules,validateProfile} from '../ui/registration.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
fs.mkdirSync(path.join(root,'.selftest'),{recursive:true});
const scratch=fs.mkdtempSync(path.join(root,'.selftest','acceptance-journey-'));
const storeDir=path.join(scratch,'projects');
const requests=[],errors=[];
let origin,app,browser,loginBrowser;
const session='registration-fixture-session';
const fixture=createServer((req,res)=>{
  const url=new URL(req.url,origin);
  requests.push({method:req.method,path:url.pathname,page:url.searchParams.get('page')});
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/wp-login.php'){
    // The dedicated login browser signs in automatically, without real credentials.
    res.setHeader('Set-Cookie',`wordpress_logged_in_fixture=${session}; Path=/; HttpOnly; SameSite=Lax`);
    res.end('<h1>Local fixture signed in</h1>');return;
  }
  const logged=req.headers.cookie?.split(';').some(c=>c.trim()===`wordpress_logged_in_fixture=${session}`);
  if(url.pathname.startsWith('/wp-admin/')||url.pathname.startsWith('/wp-json/')){
    if(!logged){res.statusCode=403;res.end('Fixture authentication required');return;}
  }
  const admin='<div id="wpadminbar">Fixture administrator</div>';
  if(url.pathname==='/wp-admin/profile.php'){res.end(admin+'<form id="your-profile">Fixture profile</form>');return;}
  if(url.pathname==='/wp-admin/'){
    res.end(admin+`<script>var wpApiSettings = ${JSON.stringify({root:origin+'/wp-json/',nonce:'fixture'})};</script>`);return;
  }
  if(['/wp-json/wp/v2/posts','/wp-json/wp/v2/pages'].includes(url.pathname)){
    res.setHeader('Content-Type','application/json');
    if(req.method!=='GET'||req.headers['x-wp-nonce']!=='fixture'){res.statusCode=403;res.end('{}');return;}
    const posts=url.pathname.endsWith('/posts'),n=Number(url.searchParams.get('page')||1);
    res.setHeader('X-WP-TotalPages',posts?'2':'1');
    res.end(JSON.stringify(posts?(n===1?[{id:11,link:origin+'/news/first/'},{id:13,link:origin+'/?p=13'}]:[{id:12,link:origin+'/news/second/'},{id:14,link:origin+'/?p=14'},{id:13,link:origin+'/?p=13'}]):[{id:21,link:origin+'/about/'}]));return;
  }
  if(url.pathname==='/wp-admin/options-general.php'){
    res.end(admin+`<input id="siteurl" value="${origin}"><input id="home" value="${origin}"><select id="timezone_string"><option selected>Asia/Tokyo</option></select><select id="WPLANG"><option selected value="ja">日本語</option></select>`);return;
  }
  if(url.pathname==='/wp-admin/options-reading.php'){res.end(admin+'<input id="blog_public" type="checkbox" checked>');return;}
  if(url.pathname==='/wp-admin/plugins.php'){res.end(admin+'<table><tr class="active" data-plugin="fixture/fixture.php"><td class="plugin-title"><strong>Fixture Plugin</strong></td></tr></table>');return;}
  if(['/', '/news/first/','/news/second/','/about/'].includes(url.pathname)){
    res.end(`<html lang="ja"><head><title>Registration fixture</title><link rel="canonical" href="${origin+url.pathname+url.search}"><meta name="robots" content="noindex"></head><body>Local fixture</body></html>`);return;
  }
  res.statusCode=404;res.end('Unknown fixture endpoint');
});

async function getJSON(route){
  const response=await fetch(app.url+route);
  assert.equal(response.status,200,route);
  return response.json();
}
let token;
async function post(route,data){
  return fetch(app.url+route,{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json','X-QA-Token':token},body:JSON.stringify(data)});
}

try{
  await new Promise((resolve,reject)=>{fixture.once('error',reject);fixture.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${fixture.address().port}`;
  app=await startUI({storeDir,port:0,loginOptions:{launch:async()=>loginBrowser=await chromium.launch({headless:true})},aiOptions:{fetcher:async(_url,opts)=>{const input=JSON.parse(JSON.parse(opts.body).messages[0].content);return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items:input.map(x=>({index:x.index,title:`確認事項${x.index+1}`,summary:`確認事項${x.index+1}の結果です。`,impact:`確認事項${x.index+1}について判断してください。`,steps:[`確認事項${x.index+1}の設定と証拠を確認する`],location:'対象の設定画面',urgency:'normal',note:''}))})}]}));}}});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url);
  await page.locator('#new-site').click();
  const dialog=page.locator('#registration-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[name=name]').fill('Local registration acceptance');
  await dialog.locator('[name=baseURL]').fill(origin);
  await dialog.locator('#registration-advanced-settings>summary').click();
  // Assert the UI restriction, then exercise the local registration path.
  for(const name of ['writes','submitContact','bankOrder'])await dialog.locator(`[name=${name}]`).check();
  await dialog.locator('[name=environment]').selectOption('production');
  for(const name of ['writes','submitContact','bankOrder'])await expect(dialog.locator(`[name=${name}]`)).not.toBeChecked();
  for(const name of ['writes','submitContact','bankOrder'])await expect(dialog.locator(`[name=${name}]`)).toBeDisabled();
  await expect(dialog.locator('#registration-policy')).toContainText('本番環境ではテスト投稿を作成しません');
  await expect(dialog).toContainText('初回の画像基準と、内容・運用方針は直接確認として残します');
  await expect(dialog).toContainText(/受信箱[\s\S]*(?:未確認として報告|合格にはしません)/);
  await expect(dialog.locator('#registration-save')).toHaveText('ログインを確認して登録・検査を準備');
  // production unchecks sensitivePaths but keeps it enabled (the operator may opt in); staging/local check it again.
  await expect(dialog.locator('[name=sensitivePaths]')).not.toBeChecked();
  await expect(dialog.locator('[name=sensitivePaths]')).toBeEnabled();
  await dialog.locator('[name=environment]').selectOption('staging');
  await expect(dialog.locator('[name=sensitivePaths]')).toBeChecked();
  await dialog.locator('[name=environment]').selectOption('production');
  await expect(dialog.locator('[name=sensitivePaths]')).not.toBeChecked();
  await dialog.locator('[name=environment]').selectOption('local');
  for(const name of ['writes','submitContact','bankOrder'])await expect(dialog.locator(`[name=${name}]`)).toBeEnabled();
  for(const name of ['writes','submitContact','bankOrder'])await expect(dialog.locator(`[name=${name}]`)).not.toBeChecked();
  await dialog.locator('[name=writes]').uncheck();
  const opened=page.waitForResponse(r=>r.url()===app.url+'/api/logins'&&r.request().method()==='POST');
  await dialog.locator('#registration-login').click();
  const loginResponse=await opened;
  assert.equal(loginResponse.status(),201);
  const login=await loginResponse.json();
  await expect(dialog.locator('#registration-login-state')).toContainText('専用ブラウザー');
  assert.equal(loginBrowser.contexts().length,1,'login uses a separate browser context');
  assert((await loginBrowser.contexts()[0].cookies(origin)).some(c=>c.name==='wordpress_logged_in_fixture'));
  const verified=page.waitForResponse(r=>r.url()===`${app.url}/api/logins/${login.id}/verify`);
  const registered=page.waitForResponse(r=>r.url()===app.url+'/api/registration');
  await dialog.locator('#registration-save').click();
  assert.equal((await verified).status(),200);
  const registration=await registered;
  const submitted=registration.request().postDataJSON();
  assert.equal(submitted.environment,'local');
  assert.equal(submitted.profile.writes,false);
  assert.equal(submitted.profile.sensitivePaths,true,'local registration sends the checked sensitivePaths');
  assert(!submitted.profile.submit&&!submitted.profile.bankOrder,'switching back to local does not silently restore write/submit/order consent');
  assert.equal(registration.status(),201,await registration.text());
  const saved=await registration.json(),id=saved.id;
  assert.equal(saved.pages,6);
  // Since automation discovery warnings are surfaced at registration: the fixed baseline notice plus this fixture's missing admin pages and menu.
  assert.deepEqual(saved.warnings,['管理画面から取得した現在値は変更を検出する基準です。お客さんとの取り決めに合っているかは案件担当が確認してください。','Some discovery sources were unavailable; missing conditions were not inferred.','No unambiguous public menu control and target were verified; selectors were not guessed.']);
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#project-name')).toContainText('Local registration acceptance');
  const boot=await getJSON('/api/bootstrap');token=boot.token;
  assert.equal(boot.projects.length,1);
  const settings=await getJSON(`/api/projects/${id}/settings`);
  assert.equal(settings.config.allowSensitivePaths,true);
  assert.equal(settings.credentials.browser,true);
  // Five profile settings plus the observed-baseline check for the fixture's one active plugin.
  assert.deepEqual(settings.config.admin.map(a=>a.id).sort(),['home','indexing','language','observed-plugins-plugin-fixture','siteurl','timezone']);
  assert.equal(settings.config.admin.length,6);
  assert(settings.config.admin.every(a=>a.source==='browser'&&a.storageStateEnv==='WPQA_UI_ADMIN_STATE'));
  assert.deepEqual(settings.config.pages.map(p=>p.path).sort(),['/','/?p=13','/?p=14','/about/','/news/first/','/news/second/']);
  for(const query of ['/?p=13','/?p=14']){
    const matches=settings.config.pages.filter(p=>p.path===query);
    assert.equal(matches.length,1,'query permalinks are distinct from home and duplicate links are deduplicated');
    assert.equal(matches[0].canonical,origin+query,'canonical retains the query');
  }
  assert.equal(settings.config.allowTestWrites,false);
  assert.equal(settings.config.journeys.length,1);
  assert.equal(settings.config.journeys[0].id,'profile-inventory');
  assert.equal(settings.config.journeys[0].module,builtinModules.inventory);
  assert.equal(settings.config.journeys[0].handlesAuthentication,true);
  assert(requests.some(r=>r.path==='/wp-json/wp/v2/posts'&&r.page==='2'),'registration follows pagination');
  assert(requests.some(r=>r.path==='/wp-admin/plugins.php'),'registration inspects plugins');
  const store=new ProjectStore(storeDir),record=store.record(id);
  assert.equal(record.profile.timezone,'Asia/Tokyo');
  assert.equal(record.profile.language,'ja');
  assert.equal(record.profile.indexable,false);
  assert.equal(record.profile.writes,false);
  assert.equal(record.profile.adminPath,'/wp-admin/');
  assert.deepEqual(JSON.parse(store.prepare(id).env.WPQA_UI_PROFILE),record.profile);
  assert(!fs.readFileSync(store.file(id),'utf8').includes(session),'saved cookie is encrypted');
  assert(!(await getJSON('/api/logins/current')).login,'successful registration consumes login');

  const steps=[];
  steps.push('登録・ログイン・認証保存');
  await page.locator('#suite-select').selectOption('standard');
  await page.locator('#run-button').click();
  await expect.poll(async()=> (await getJSON(`/api/projects/${id}`)).lastJob?.state,{timeout:120000}).toBe('finished');
  const full=(await getJSON(`/api/projects/${id}`)).lastJob.runId;
  await expect(page.locator('#metadata')).toContainText(full,{timeout:15000});
  const fullResult=(await getJSON(`/api/projects/${id}/runs/${full}`)).report;
  assert.equal(fullResult.runStatus,'finished');assert.deepEqual(fullResult.errors,[]);
  steps.push('共通自動検査');
  await page.locator('#findings-body .findings-caution details').first().locator('summary').click();
  const detailButton=page.locator('#findings-body .findings-caution details').first().locator('[data-row]').first();
  await detailButton.click();await expect(page.locator('#detail')).toContainText('期待と実際');
  await expect(page.locator('#findings')).toBeVisible();
  await page.locator('#execute-case').click();
  await expect.poll(async()=>{const p=await getJSON(`/api/projects/${id}`);return p.lastJob?.state==='finished'&&p.lastJob.runId!==full;},{timeout:120000}).toBe(true);
  await expect(page.locator('#scope-note')).toContainText('1項目のみ');
  await page.locator('#scope-back').click();await expect(page.locator('#metadata')).toContainText(full);
  steps.push('詳細・部分再検査・元の結果への復帰');
  new SystemSettings({directory:path.join(storeDir,'system'),codec:store.codec}).save({apiKey:'sk-ant-synthetic-fixture-only',enabled:true,approved:true,evidenceApproved:true,dailyLimit:20});
  await page.reload();await page.locator(`[data-run="${full}"]`).click();
  await page.locator('#editor-report-panel summary').click();await expect(page.locator('#editor-report-generate')).toBeEnabled();
  await page.locator('#editor-report-generate').click();
  await expect(page.locator('#editor-report-status')).toContainText('作成しました',{timeout:60000});
  const popupWait=page.waitForEvent('popup');await page.locator('#editor-report-open').click();const reportPage=await popupWait;
  await expect(reportPage.locator('h1')).toContainText('サイト診断');
  await reportPage.locator('a[href*="editor-report-basis.html#"]').first().click();
  await expect(reportPage.locator('h1')).toContainText('根拠');
  await expect(reportPage.locator('body')).toContainText('判定理由');
  assert.equal(new URL(reportPage.url()).hash.length>1,true);
  await reportPage.close();steps.push('報告書作成・根拠への移動');
  await page.locator('#handoff-panel summary').click();await page.locator('#handoff-make').click();
  await expect(page.locator('#handoff-body')).not.toHaveValue('');
  await expect(page.locator('#handoff-panel')).toContainText('依頼元のC-HUBタスク');
  steps.push('引き継ぎ文面作成・共有案内');
  const runReport=(await getJSON(`/api/projects/${id}/runs/${full}`)).report;
  const manual=runReport.rows.find(r=>r.manualReview&&!r.preparationRequired);assert(manual);
  await page.locator('#search').fill(manual.title);
  await page.locator(`#test-rows [data-group="${manual.id}"]`).click();
  await page.locator(`#test-rows [data-row="${manual.id}"]`).click();
  await expect(page.locator('.manual-guidance')).toContainText('記録');
  await page.locator('#start-confirmation').click();
  await page.locator('#confirmation-form input').fill('受入確認担当');
  await page.getByRole('button',{name:'途中保存',exact:true}).click();await expect(page.locator('#toast')).toContainText('途中結果');
  await page.locator('#start-confirmation').click();await expect(page.locator('#confirmation-form input')).toHaveValue('受入確認担当');
  for(const select of await page.locator('#confirmation-form [data-step] select').all())await select.selectOption('pass');
  for(const field of await page.locator('#confirmation-form [data-step] textarea').all())await field.fill('ローカル模擬サイトの取り決めと画面を確認。証拠: acceptance screenshot');
  await page.getByRole('button',{name:'確認を完了',exact:true}).click();await expect(page.locator('#toast')).toContainText('確認結果を保存');
  const reviewed=(await getJSON(`/api/projects/${id}/runs/${full}`)).report.rows.find(r=>r.id===manual.id);assert.equal(reviewed.status,'pass');
  steps.push('直接確認・途中保存・完了');
  assert(requests.every(r=>r.method==='GET'),'target site must receive no writes');assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(scratch,'final.png'),fullPage:true});
  fs.writeFileSync(path.join(scratch,'acceptance.json'),JSON.stringify({steps,fullRunId:full,requests:requests.length,targetWrites:0,pageErrors:errors},null,2));
  console.log(JSON.stringify({ok:true,steps,scratch}));
}finally{
  try{await browser?.close();}finally{
    try{await app?.close();}finally{
      await loginBrowser?.close().catch(()=>{});
      if(fixture.listening)await new Promise(resolve=>fixture.close(resolve));
    }
  }
}
