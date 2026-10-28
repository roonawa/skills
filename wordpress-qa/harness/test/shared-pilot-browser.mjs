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
const app=await startUI({port:0,storeDir:path.join(dir,'projects'),credentialCodec:createSecretCodec(randomBytes(32)),shared:{origin,users:[{name:'tester',...hashPassword('long-fixture-password-1234')}]}});
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
 await expect(page.locator('#shared-pilot-notice')).toBeVisible();await page.locator('#new-site').click();
 const form=page.locator('#site-editor');await expect(form).toBeVisible();await expect(form.locator('#login-start')).toBeHidden();
 await expect(form.locator('#login-status')).toContainText('共有版');await expect(form.locator('#auth-state')).toBeAttached();
 await form.locator('#site-fields [data-key=name]').fill('社内試用テスト');await form.locator('#site-fields [data-key=baseURL]').fill('https://example.test');await form.locator('#site-fields [data-key=baseURL]').press('Tab');
 await form.locator('#editor-save').click();await expect(form).not.toBeVisible();await expect(page.locator('#project-name')).toContainText('社内試用テスト');
 await page.reload();await expect(page.locator('#project-name')).toContainText('社内試用テスト');
 if(errors.length)throw Error(errors.join('\n'));
 await page.screenshot({path:path.join(dir,'shared-pilot-ui.png'),fullPage:true});
 console.log('Shared UI auth, registration, disabled remote-window login, generated cases and reload passed. '+dir);
}finally{await browser?.close();await new Promise(r=>proxy.close(r));await app.close();}
