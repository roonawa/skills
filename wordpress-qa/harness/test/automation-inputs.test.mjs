import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {validateAutomationInput,automationCoverageIds,automationKinds,automationExamples} from '../ui/public/automation-inputs.js';
import {viewpoints} from '../ui/public/case-generator.js';
import {validateChecks} from '../lib/checks/index.mjs';

const mail={id:'coverage-notification',suite:'delivery',kind:'mail-delivery',options:{source:{url:'http://127.0.0.1:8025'},expected:{to:'qa@example.test',subject:'QA {{token}}',count:1}}};
test('defaults, strict envelope, coverage allowlist and cloned preservation',()=>{
 assert.deepEqual(validateAutomationInput(),{useObservedBaselines:true,additionalChecks:[]});
 assert.deepEqual(automationCoverageIds,viewpoints.map(([,key])=>'coverage-'+key));
 const input={useObservedBaselines:false,additionalChecks:[mail]};
 const result=validateAutomationInput(input);assert.deepEqual(result,input);
 result.additionalChecks[0].options.expected.to='changed';assert.equal(mail.options.expected.to,'qa@example.test');
 for(const value of [null,[],false,{useObservedBaselines:1},{additionalChecks:{}},{module:'custom.js'}])assert.throws(()=>validateAutomationInput(value));
 for(const patch of [{id:'coverage-unknown'},{id:'custom'},{kind:'unconfigured'},{kind:'human-review'},{kind:'custom-module'},{module:'./code.mjs'},{suite:'unknown'},{options:[]},{title:''},{required:1},{timeoutMs:999},{timeoutMs:900001}])assert.throws(()=>validateAutomationInput({additionalChecks:[{...mail,...patch}]}));
 assert.throws(()=>validateAutomationInput({additionalChecks:[mail,mail]}));
 // Kind-specific semantics are deliberately left to server validateConfig.
 assert.doesNotThrow(()=>validateAutomationInput({additionalChecks:[{...mail,options:{}}]}));
});

test('examples use actual registered executors and valid options',async()=>{
 const modules=await Promise.all(['wordpress','read-only','workflows','standard','site-interaction','discovered'].map(name=>import('../lib/checks/'+name+'.mjs')));
 assert.deepEqual([...automationKinds].sort(),modules.flatMap(m=>m.kinds).sort());
 for(const {check} of automationExamples.filter(e=>e.check)){
  validateAutomationInput({additionalChecks:[check]});
  assert.doesNotThrow(()=>validateChecks({baseURL:'https://example.test',environment:'staging',allowTestWrites:true,checks:[structuredClone(check)]}));
 }
});

test('registration drafts and submitted automation; settings retention and permission preservation',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  await page.route('http://automation.test/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('.js'))return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../ui/public'+path,import.meta.url),'utf8')});
   return route.fulfill({contentType:'text/html',body:'<button id="new-site">New</button><button id="edit-site">Edit</button>'});
  });
  const setup=()=>page.evaluate(async()=>{
   const {initRegistration}=await import('/registration.js');
   initRegistration({onSaved:async()=>{},api:async(url,options)=>{
    if(url==='/api/logins')return {id:'login'};
    if(url==='/api/logins/current')return {login:{id:'login',phase:'verified'}};
    if(url==='/api/registration'){window.saved=JSON.parse(options.body);return {id:'saved'};}
    return {};
   }});
  });
  await page.goto('http://automation.test/');await setup();await page.click('#new-site');
  await page.locator('[name=name]').fill('Automation');await page.locator('[name=baseURL]').fill('https://example.test');
  await page.locator('[name=automation-useObservedBaselines]').uncheck();
  await page.locator('[name=automation-additionalChecks]').fill(JSON.stringify([mail]));
  await page.reload();await setup();
  assert.equal(await page.locator('[name=automation-useObservedBaselines]').isChecked(),false);
  assert.deepEqual(JSON.parse(await page.locator('[name=automation-additionalChecks]').inputValue()),[mail]);
  await page.locator('[name=automation-additionalChecks]').fill('[bad');await page.click('#registration-save');
  assert.match(await page.locator('#registration-validation').textContent(),/入力内容/);
  assert.equal(await page.locator('[name=automation-additionalChecks]').getAttribute('aria-invalid'),'true');
  await page.locator('[name=automation-additionalChecks]').fill(JSON.stringify([mail]));
  await page.click('#registration-login');await page.click('#registration-save');
  await page.waitForFunction(()=>window.saved||document.querySelector('#registration-error').textContent);
  assert.equal(await page.locator('#registration-error').textContent(),'');
  const saved=await page.evaluate(()=>window.saved);
  assert.deepEqual(saved.profile.automation,{useObservedBaselines:false,additionalChecks:[mail]});
  assert.equal(saved.profile.writes,false);

  await page.goto('http://automation.test/register-again');await setup();await page.click('#new-site');
  for(const name of ['contactFormId','contactPath','contactNameField','contactEmailField','contactMessageField','contactConsentField'])assert.equal(await page.locator(`[name=${name}]`).inputValue(),'');
  await page.locator('[name=name]').fill('Discovered form');await page.locator('[name=baseURL]').fill('https://example.test');
  await page.locator('[name=writes]').check();await page.locator('[name=submitContact]').check();await page.locator('[name=testEmail]').fill('qa@example.test');
  await page.click('#registration-login');await page.click('#registration-save');
  await page.waitForFunction(()=>window.saved||document.querySelector('#registration-error').textContent);
  assert.equal(await page.locator('#registration-error').textContent(),'');
  const pending=await page.evaluate(()=>window.saved.profile);assert.equal(pending.submit,true);assert.equal(pending.writes,true);
  for(const key of ['contactFormId','contactPath','contactNameField','contactEmailField','contactMessageField'])assert.equal(Object.hasOwn(pending,key),false);
  for(const automation of [undefined,{useObservedBaselines:false,additionalChecks:[mail]}]){
   await page.goto('http://automation.test/settings');
   await page.evaluate(async automation=>{
    const {initSettings}=await import('/settings.js');
    initSettings({currentProject:()=> 'managed',onSaved:async()=>{},api:async(url,options)=>{
     if(options?.method==='POST'){window.saved=JSON.parse(options.body);return {id:'managed'};}
     if(url==='/api/logins/current')return {login:null};
     return {managed:true,version:'v1',credentials:{},config:{name:'Existing',baseURL:'https://example.test',environment:'staging',pages:[],admin:[],checks:[],allowTestWrites:false},profile:{timezone:'Asia/Tokyo',language:'ja',sitePath:'/',adminPath:'/wp-admin/',writes:false,performanceMs:4321,...(automation?{automation}:{})}};
    }});
   },automation);
   await page.click('#edit-site');
   assert.equal(await page.locator('[name=automation-useObservedBaselines]').isChecked(),automation?.useObservedBaselines??true);
   await page.click('#editor-save');await page.waitForFunction(()=>window.saved||document.querySelector('#editor-error').textContent);
   assert.equal(await page.locator('#editor-error').textContent(),'');
   const first=await page.evaluate(()=>window.saved);
   assert.deepEqual(first.profile.automation,automation);assert.equal(first.profile.writes,false);assert.equal(first.profile.performanceMs,4321);
   await page.click('#edit-site');
   await page.locator('[name=automation-useObservedBaselines]').uncheck();
   await page.locator('[name=automation-additionalChecks]').fill(JSON.stringify([mail]));
   await page.evaluate(()=>{window.saved=null;});await page.click('#editor-save');
   await page.waitForFunction(()=>window.saved||document.querySelector('#editor-error').textContent);
   assert.equal(await page.locator('#editor-error').textContent(),'');
   const changed=await page.evaluate(()=>window.saved);
   assert.deepEqual(changed.profile.automation,{useObservedBaselines:false,additionalChecks:[mail]});assert.equal(changed.profile.writes,false);
  }
 }finally{await browser.close();}
});



test('settings rediscovery sends only saved version, reloads results and guards unsaved edits',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  await page.route('http://rediscover-ui.test/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('.js'))return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../ui/public'+path,import.meta.url),'utf8')});
   return route.fulfill({contentType:'text/html',body:'<button id="new-site">New</button><button id="edit-site">Edit</button>'});
  });
  await page.goto('http://rediscover-ui.test/');
  await page.evaluate(async()=>{
   const {initSettings}=await import('/settings.js');let version='v1';window.requests=[];
   initSettings({currentProject:()=> 'managed',onSaved:async id=>{window.refreshed=id;},api:async(url,options)=>{
    if(url.endsWith('/rediscover')){window.requests.push(JSON.parse(options.body));version='v2';return {id:'managed',version,pages:2,warnings:['read-only fixture']};}
    if(url==='/api/logins/current')return {login:null};
    return {managed:true,version,credentials:{browser:true},config:{name:version==='v1'?'Original':'Refreshed',baseURL:'https://example.test',environment:'staging',pages:[],admin:[],checks:[],allowTestWrites:false},profile:{timezone:'Asia/Tokyo',language:'ja',indexable:false,sitePath:'/',adminPath:'/wp-admin/',writes:false}};
   }});
  });
  await page.click('#edit-site');await page.click('#rediscover-automation');
  await page.waitForFunction(()=>window.refreshed);
  assert.deepEqual(await page.evaluate(()=>window.requests),[{version:'v1'}]);
  assert.equal(await page.locator('#site-fields [data-key=name]').inputValue(),'Refreshed');
  assert.match(await page.locator('#rediscover-status').textContent(),/再取得して保存しました/);
  assert.equal(await page.locator('#operation-profile-fields [data-key=writes]').isChecked(),false);
  await page.click('#rediscover-automation');assert.deepEqual(await page.evaluate(()=>window.requests),[{version:'v1'},{version:'v2'}]);
  await page.locator('#site-fields [data-key=name]').fill('Unsaved');
  assert.equal(await page.locator('#rediscover-automation').isDisabled(),true);assert.match(await page.locator('#rediscover-status').textContent(),/未保存/);
 }finally{await browser.close();}
});


test('registration role credentials are sent separately, excluded from drafts, and never grant production writes',async()=>{
 const browser=await chromium.launch();
 const state={cookies:[{domain:'example.test',path:'/',name:'member-session',value:'private-role-cookie'}],origins:[]};
 try{
  const page=await browser.newPage();
  await page.route('http://role-registration.test/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('.js'))return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../ui/public'+path,import.meta.url),'utf8')});
   return route.fulfill({contentType:'text/html',body:'<button id="new-site">New</button>'});
  });
  const setup=()=>page.evaluate(async()=>{
   const {initRegistration}=await import('/registration.js');
   initRegistration({onSaved:async()=>{},api:async(url,options)=>{
    if(url==='/api/logins')return {id:'login'};
    if(url==='/api/logins/current')return {login:{id:'login',phase:'verified'}};
    if(url==='/api/registration'){window.saved=JSON.parse(options.body);return {id:'saved'};}
    return {};
   }});
  });
  await page.goto('http://role-registration.test/');await setup();await page.click('#new-site');
  await page.locator('[name=name]').fill('Role registration');await page.locator('[name=baseURL]').fill('https://example.test');
  await page.locator('[name=writes]').check();await page.locator('[name=environment]').selectOption('production');
  await page.locator('[name=roleName]').fill('subscriber');await page.locator('[name=roleUser]').fill('member');await page.locator('[name=rolePassword]').fill('private-role-password');
  const upload=()=>page.locator('[name=roleState]').setInputFiles({name:'member.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(state))});
  await upload();
  const draft=await page.evaluate(()=>sessionStorage.getItem('wpqa.registration.draft.v1'));
  assert(!draft.includes('private-role-password'));assert(!draft.includes('private-role-cookie'));assert(!draft.includes('rolePassword'));assert(!draft.includes('roleState'));
  assert.equal(JSON.parse(draft).values.roleName,'subscriber');assert.equal(JSON.parse(draft).values.roleUser,'member');
  await page.reload();await setup();
  assert.equal(await page.locator('[name=rolePassword]').inputValue(),'');assert.equal(await page.locator('[name=roleState]').evaluate(el=>el.files.length),0);
  assert.equal(await page.locator('[name=roleName]').inputValue(),'subscriber');assert.equal(await page.locator('[name=roleUser]').inputValue(),'member');
  await page.click('#registration-save');assert.equal(await page.locator('[name=rolePassword]').getAttribute('aria-invalid'),'true');
  await page.locator('[name=rolePassword]').fill('private-role-password');
  await page.locator('[name=roleState]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{private-role-cookie')});
  await page.click('#registration-login');await page.click('#registration-save');
  await page.waitForFunction(()=>document.querySelector('#registration-error').textContent);
  assert.match(await page.locator('#registration-error').textContent(),/セッションファイル/);assert(!(await page.locator('#registration-error').textContent()).includes('private-role-cookie'));
  await upload();await page.click('#registration-save');await page.waitForFunction(()=>window.saved);
  const saved=await page.evaluate(()=>window.saved);
  assert.deepEqual(saved.roleCredentials,[{name:'subscriber',rest:{username:'member',password:'private-role-password'},browser:state}]);
  assert.equal(Object.hasOwn(saved.profile,'roleCredentials'),false);assert(!JSON.stringify(saved.profile).includes('private-role-'));
  assert.equal(saved.environment,'production');assert.equal(saved.profile.writes,false);assert.notEqual(saved.profile.submit,true);assert.notEqual(saved.profile.bankOrder,true);
  assert.equal(await page.locator('[name=rolePassword]').inputValue(),'');assert.equal(await page.locator('[name=roleState]').evaluate(el=>el.files.length),0);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('wpqa.registration.draft.v1')),null);
 }finally{await browser.close();}
});

