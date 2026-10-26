// Run from any directory: node test/registration-browser.mjs
// Uses only isolated loopback servers; saved artifacts stay in a unique .selftest directory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
import {ProjectStore} from '../ui/project-store.mjs';
import {builtinModules,validateProfile} from '../ui/registration.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
fs.mkdirSync(path.join(root,'.selftest'),{recursive:true});
const scratch=fs.mkdtempSync(path.join(root,'.selftest','registration-'));
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
  app=await startUI({storeDir,port:0,loginOptions:{launch:async()=>loginBrowser=await chromium.launch({headless:true})}});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url);
  await page.locator('#new-site').click();
  const dialog=page.locator('#registration-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[name=name]').fill('Local registration acceptance');
  await dialog.locator('[name=baseURL]').fill(origin);
  // Assert the UI restriction, then exercise the local registration path.
  for(const name of ['writes','submitContact','bankOrder'])await dialog.locator(`[name=${name}]`).check();
  await dialog.locator('[name=environment]').selectOption('production');
  for(const name of ['writes','submitContact','bankOrder'])await expect(dialog.locator(`[name=${name}]`)).not.toBeChecked();
  for(const name of ['writes','submitContact','bankOrder'])await expect(dialog.locator(`[name=${name}]`)).toBeDisabled();
  await expect(dialog.locator('#registration-policy')).toContainText('本番環境ではテスト投稿を作成しません');
  await expect(dialog).toContainText('初回の画像基準と、内容・運用方針は確認待ちとして残します');
  await expect(dialog).toContainText(/受信箱[\s\S]*(?:未確認として報告|合格にはしません)/);
  await expect(dialog.locator('#registration-save')).toHaveText('ログインを確認して登録・検査を準備');
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
  assert(!submitted.profile.submit&&!submitted.profile.bankOrder,'switching back to local does not silently restore write/submit/order consent');
  assert.equal(registration.status(),201,await registration.text());
  const saved=await registration.json(),id=saved.id;
  assert.equal(saved.pages,6);
  assert.deepEqual(saved.warnings,[]);
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#project-name')).toContainText('Local registration acceptance');
  const boot=await getJSON('/api/bootstrap');token=boot.token;
  assert.equal(boot.projects.length,1);
  const settings=await getJSON(`/api/projects/${id}/settings`);
  assert.equal(settings.credentials.browser,true);
  assert.equal(settings.config.admin.length,5);
  assert.deepEqual(settings.config.admin.map(a=>a.id).sort(),['home','indexing','language','siteurl','timezone']);
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

  // HTTP adversarial checks use the real server, valid CSRF headers and saved version.
  const malicious=structuredClone(settings.config);
  malicious.journeys[0].module=path.join(scratch,'arbitrary-not-created.mjs');
  const refused=await post(`/api/projects/${id}/settings`,{version:settings.version,config:malicious});
  assert.equal(refused.status,400);
  assert.match((await refused.json()).error,/標準検査/);
  assert.equal(store.record(id).version,record.version,'rejected code does not alter the project');

  const second=await post('/api/logins',{baseURL:origin,environment:'local'});
  assert.equal(second.status,201);const secondLogin=await second.json();
  assert.equal((await post(`/api/logins/${secondLogin.id}/verify`,{})).status,200);
  assert.equal((await getJSON('/api/logins/current')).login.phase,'verified');
  const productionProfile={...record.profile,writes:true};
  assert.throws(()=>validateProfile(productionProfile,'production'),/本番環境ではテスト投稿/);
  const before=requests.length;
  const production=await post('/api/registration',{name:'Must not save',baseURL:origin,environment:'production',loginId:secondLogin.id,profile:productionProfile});
  // Current server masks validation errors as 500; a future 400 is also a rejection.
  assert([400,500].includes(production.status));
  assert.equal(requests.length,before,'production writes rejected before discovery');
  assert.equal((await getJSON('/api/bootstrap')).projects.length,1);
  assert.equal(store.record(id).version,record.version);
  for(const action of ['submit','bankOrder']){
    const unsafeProfile={...record.profile,[action]:true};
    assert.throws(()=>validateProfile(unsafeProfile,'production'),/検証環境/);
    const denied=await post('/api/registration',{name:'Must not save',baseURL:origin,environment:'production',loginId:secondLogin.id,profile:unsafeProfile});
    assert([400,500].includes(denied.status),`server rejects production ${action}`);
    assert.equal(requests.length,before,'unsafe production profile never reaches discovery');
    assert.equal(store.record(id).version,record.version);
  }
  // Control: production without writes reaches the distinct login/environment check.
  const mismatch=await post('/api/registration',{name:'Must not save',baseURL:origin,environment:'production',loginId:secondLogin.id,profile:{...record.profile,writes:false}});
  assert.equal(mismatch.status,400);assert.match((await mismatch.json()).error,/管理者ログイン/);
  assert.equal((await post(`/api/logins/${secondLogin.id}/cancel`,{})).status,200);

  await page.locator('#suite-select').selectOption('admin');
  const launched=page.waitForResponse(r=>r.url()===`${app.url}/api/projects/${id}/runs`&&r.request().method()==='POST');
  await page.locator('#run-button').click();
  const launchResponse=await launched;assert.equal(launchResponse.status(),202,await launchResponse.text());
  // Poll completion, not the transient "running" banner (five checks can finish quickly).
  await expect.poll(async()=> (await getJSON(`/api/projects/${id}`)).lastJob?.state,{timeout:120000,intervals:[250,500,1000]}).toBe('finished');
  const project=await getJSON(`/api/projects/${id}`),job=project.lastJob;
  // An admin-only run leaves the other generated required suites unrun.
  assert.equal(job.exitCode,2,job.log);
  await expect(page.locator('#metric-pass')).toHaveText('5',{timeout:15000});
  const detail=await getJSON(`/api/projects/${id}/runs/${job.runId}`);
  const adminRows=detail.report.rows.filter(r=>r.id.startsWith('admin.'));
  assert.equal(adminRows.length,5);assert(adminRows.every(r=>r.status==='pass'));
  assert.equal(detail.report.runStatus,'finished');
  assert.equal(detail.report.gatePassed,false);
  assert.deepEqual(detail.report.errors,[]);
  assert(detail.report.rows.some(r=>r.required&&!r.selected&&r.status==='not_run'));
  assert(detail.report.rows.filter(r=>r.selected).every(r=>r.id.startsWith('admin.')),'only admin suite executes');
  assert(detail.report.autoReport,'run finish records automatic report generation');
  const report=await fetch(`${app.url}/api/projects/${id}/runs/${job.runId}/files?path=issue-report.html`);
  assert.equal(report.status,200);
  assert.match(report.headers.get('content-type'),/text\/html/);
  const html=await report.text();assert.match(html,/<html[\s>]/i);assert(!html.includes(session));
  assert(!JSON.stringify(detail).includes(session));
  assert(requests.every(r=>r.method==='GET'),'registration and admin suite never mutate WordPress');
  assert.deepEqual(errors,[]);
  console.log('Registration browser acceptance passed: wizard login, query permalink discovery, five admin checks, saved profile/consent, module/production guards, scope claims, automatic report. Artifacts: '+scratch);
}finally{
  try{await browser?.close();}finally{
    try{await app?.close();}finally{
      await loginBrowser?.close().catch(()=>{});
      if(fixture.listening)await new Promise(resolve=>fixture.close(resolve));
    }
  }
}
