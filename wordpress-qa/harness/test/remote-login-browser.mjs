import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
import {createSecretCodec} from '../ui/secret-codec.mjs';
import {hashPassword} from '../ui/shared-access.mjs';

const dir=path.resolve('.selftest','remote-login-'+Date.now());fs.mkdirSync(dir,{recursive:true});
const fixture=http.createServer((req,res)=>{
  if(req.url==='/wp-login.php'&&req.method==='POST'){
    res.writeHead(302,{'Set-Cookie':'wordpress_logged_in_fixture=synthetic-session; Path=/; HttpOnly','Location':'/wp-admin/profile.php'});return res.end();
  }
  if(req.url==='/wp-admin/profile.php'){
    if(!req.headers.cookie?.includes('wordpress_logged_in_fixture=synthetic-session')){res.writeHead(302,{Location:'/wp-login.php'});return res.end();}
    return res.end('<html><div id="wpadminbar">管理画面</div><form id="your-profile">プロフィール</form></html>');
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html><body style="margin:0"><form method="post" action="/wp-login.php"><input aria-label="ユーザー名" style="position:absolute;left:20px;top:20px;width:300px;height:40px"><input type="password" aria-label="パスワード" style="position:absolute;left:20px;top:80px;width:300px;height:40px"><button style="position:absolute;left:20px;top:140px;height:40px">ログイン</button></form></body></html>');
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const target='http://127.0.0.1:'+fixture.address().port;
const origin='https://qa.example.test',codec=createSecretCodec(randomBytes(32));
const app=await startUI({port:0,storeDir:path.join(dir,'projects'),auditFile:path.join(dir,'audit.jsonl'),credentialCodec:codec,shared:{origin,users:['alice','bob'].map(name=>({name,...hashPassword('fixture-password-long')}))}});
let fixtureURL,browser;
const proxy=http.createServer((req,res)=>{
  const headers={...req.headers,host:'qa.example.test'};if(headers.origin===fixtureURL)headers.origin=origin;
  const upstream=http.request(app.url+req.url,{method:req.method,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);
});
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));fixtureURL='http://127.0.0.1:'+proxy.address().port;
async function api(user,url,data,token){
  return fetch(fixtureURL+url,{method:data?'POST':'GET',headers:{Authorization:'Basic '+Buffer.from(user+':fixture-password-long').toString('base64'),...(data?{Origin:fixtureURL,'Content-Type':'application/json','X-QA-Token':token}:{})},...(data?{body:JSON.stringify(data)}:{})});
}
try{
  browser=await chromium.launch();const context=await browser.newContext({httpCredentials:{username:'alice',password:'fixture-password-long'},viewport:{width:1440,height:1100}}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(fixtureURL);
  await page.locator('#new-site').click();const form=page.locator('#site-editor');
  await form.locator('#site-fields [data-key=name]').fill('遠隔ログイン動作確認');
  await form.locator('#site-fields [data-key=environment]').selectOption('local');
  await form.locator('#site-fields [data-key=baseURL]').fill(target);await form.locator('#site-fields [data-key=baseURL]').press('Tab');
  await form.locator('#login-start').click();await expect(form.locator('.remote-login')).toBeVisible({timeout:30000});
  const alice=await(await api('alice','/api/bootstrap')).json(),bob=await(await api('bob','/api/bootstrap')).json();
  const session=(await(await api('alice','/api/logins/current')).json()).login;
  assert.equal((await(await api('bob','/api/logins/current')).json()).login,null);
  for(const action of ['operate','verify','cancel'])assert.equal((await api('bob',`/api/logins/${session.id}/${action}`,{type:'frame'},bob.token)).status,403);
  const config={name:'forbidden',baseURL:target,environment:'local',pages:[],journeys:[],visuals:[],admin:[]};
  assert.equal((await api('bob','/api/projects',{config,auth:{browserLoginId:session.id}},bob.token)).status,403);
  assert.equal((await api('alice',`/api/logins/${session.id}/operate`,{type:'frame'},'bad-token')).status,403);
  // Wait for real pixels then click the scaled canvas and send a pasted password.
  await expect.poll(()=>form.locator('canvas').evaluate(c=>c.getContext('2d').getImageData(5,5,1,1).data[3])).toBe(255);
  const canvas=form.locator('canvas');const r=await canvas.boundingBox();
  await canvas.click({position:{x:50*r.width/1100,y:100*r.height/760}});
  await form.locator('[data-remote-text]').fill('private-fixture-password');await form.locator('[data-send]').click();
  await expect(form.locator('[data-remote-text]')).toHaveValue('');
  await form.locator('[data-enter]').click();
  await expect.poll(async()=>{const response=await api('alice',`/api/logins/${session.id}/verify`,{},alice.token);return response.status;},{timeout:20000}).toBe(200);
  await form.locator('#login-verify').click();await expect(form.locator('#login-status')).toContainText('確認済み');
  await form.locator('#editor-save').click();await expect(form).not.toBeVisible();
  const boot=await(await api('alice','/api/bootstrap')).json(),id=boot.projects[0].id;
  const settings=await(await api('alice',`/api/projects/${id}/settings`)).json();assert.equal(settings.credentials.browser,true);
  const record=JSON.parse(fs.readFileSync(path.join(dir,'projects',id+'.json'),'utf8'));
  assert(!JSON.stringify(record).includes('synthetic-session'));assert(JSON.stringify(JSON.parse(codec(record.sealed,true))).includes('synthetic-session'));
  const audit=fs.readFileSync(path.join(dir,'audit.jsonl'),'utf8');assert(!audit.includes('private-fixture-password'));assert(!audit.includes('synthetic-session'));
  await page.locator('#edit-site').click();await form.locator('#login-start').click();await expect(form.locator('.remote-login')).toBeVisible();
  await page.screenshot({path:path.join(dir,'remote-login-ui.png'),fullPage:true});
  await form.locator('#login-cancel').click();await expect(form.locator('.remote-login')).toBeHidden();
  assert.equal((await(await api('alice','/api/logins/current')).json()).login,null);
  assert.deepEqual(errors,[]);console.log('PASS remote screen/input, owner isolation, CSRF, verify, encrypted persistence, cancellation, audit redaction: '+dir);
}finally{await browser?.close();await app.close();await new Promise(r=>proxy.close(r));await new Promise(r=>fixture.close(r));}
