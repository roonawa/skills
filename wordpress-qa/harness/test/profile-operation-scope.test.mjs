import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {ProjectStore} from '../ui/project-store.mjs';
import {registrationConfig} from '../ui/registration.mjs';
import {startUI} from '../ui/server.mjs';

async function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-scope-'));
  let app;
  t.after(async()=>{await app?.close();fs.rmSync(root,{recursive:true,force:true});});
  const storeDir=path.join(root,'projects'),store=new ProjectStore(storeDir);
  const profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:true,submit:true,contactFormId:42,contactPath:'/contact',testEmail:'private@example.test',contactNameField:'your-name',contactEmailField:'your-email',contactMessageField:'your-message'};
  const config=registrationConfig({name:'Saved scope',baseURL:'https://example.test',environment:'staging',profile,discovery:{pages:[{path:'/'}],warnings:[]}});
  const id=store.save({config,profile});
  const dir=store.context(id).configDir;fs.mkdirSync(dir,{recursive:true});
  const external=path.join(root,'external.json');
  fs.writeFileSync(external,JSON.stringify({name:'Legacy scope',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:false}],outputDir:path.join(root,'external-runs')}));
  app=await startUI({storeDir,configPaths:[external],port:0});
  const get=async suffix=>{const response=await fetch(app.url+suffix);assert.equal(response.status,200);return response.json();};
  const boot=await get('/api/bootstrap');
  const post=(suffix,data)=>fetch(app.url+suffix,{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify(data)});
  return {app,id,dir,store,profile,config,get,post,externalId:boot.projects.find(p=>p.id!==id).id};
}

test('profile indication describes saved scope without exposing profile email',async t=>{
  const f=await fixture(t),project=(await f.get(`/api/projects/${f.id}`)).project;
  assert.equal(project.profileScope.mode,'saved-profile');assert.equal(project.profileScope.contactSubmit,true);
  assert.equal(project.profileScope.postLifecycle,true);assert.equal(project.profileScope.scheduled,true);
  assert.equal(project.profileScope.bankOrder,false);
  assert.ok(!JSON.stringify(project).includes(f.profile.testEmail));
  assert.equal((await f.get(`/api/projects/${f.externalId}`)).project.profileScope,null);
  const old=f.store.view(f.id);
  f.store.save({id:f.id,version:old.version,config:{...old.config,environment:'production',allowTestWrites:false},profile:{...f.profile,writes:false,submit:false}});
  assert.equal((await f.get(`/api/projects/${f.id}`)).project.profileScope.contactSubmit,false);
});

test('contact pending status is sanitized, read-only and cannot be released or retried',async t=>{
  const f=await fixture(t),file=path.join(f.dir,'profile-contact-pending.json');
  fs.writeFileSync(file,JSON.stringify({status:'pending',token:'qa-case',email:'secret@example.test',rawBody:'secret-body'}));
  const ops=await f.get(`/api/projects/${f.id}/operations`);
  assert.deepEqual(ops.operations,[]);assert.equal(ops.contactSubmission.status,'pending');
  assert.equal(ops.contactSubmission.token,'qa-case');assert.equal(ops.contactSubmission.blocked,true);
  assert.equal(ops.contactSubmission.readOnly,true);assert.ok(!JSON.stringify(ops).includes('secret'));
  for(const suffix of ['/profile-contact-submit/release','/profile-contact-submit']){
    assert.equal((await f.post(`/api/projects/${f.id}/operations${suffix}`,{confirmed:true,token:'qa-case',configHash:ops.configHash,notes:'retry',mode:'submit'})).status,409);
  }
  assert.equal(JSON.parse(fs.readFileSync(file)).status,'pending');
  fs.writeFileSync(file,JSON.stringify({status:'mail_sent',token:'qa-case'}));
  assert.equal((await f.get(`/api/projects/${f.id}/operations`)).contactSubmission.blocked,false);
  fs.mkdirSync(file+'.lock');
  assert.equal((await f.get(`/api/projects/${f.id}/operations`)).contactSubmission.blocked,true);
  fs.writeFileSync(file,'broken-secret');
  const broken=(await f.get(`/api/projects/${f.id}/operations`)).contactSubmission;
  assert.equal(broken.status,'unreadable');assert.equal(broken.blocked,true);assert.ok(!JSON.stringify(broken).includes('secret'));
});

test('profile UI hides legacy scopes, omits per-run approval, and shows read-only pending',async t=>{
  const f=await fixture(t),browser=await chromium.launch();
  try{
    const page=await browser.newPage();let runPayload;
    await page.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==f.app.url)return route.abort();
      if(url.pathname.endsWith('/runs')&&request.method()==='POST'){
        runPayload=request.postDataJSON();return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Fixture: execution intentionally stopped'})});
      }
      return route.continue();
    });
    await page.goto(f.app.url);
    await page.selectOption('#project-select',f.id);
    await page.waitForFunction(()=>document.querySelector('#profile-operation-scope')?.textContent.includes('問い合わせ送信：有効'));
    assert.equal(await page.locator('#standard-operation-settings').isVisible(),false);
    await page.click('#run-button');
    await page.waitForFunction(()=>document.querySelector('#run-button').disabled===false);
    assert.ok(runPayload);assert.equal(Object.hasOwn(runPayload,'operation'),false);
    fs.writeFileSync(path.join(f.dir,'profile-contact-pending.json'),JSON.stringify({status:'pending',token:'qa-fixture'}));
    await page.click('#operation-tests');
    await page.waitForFunction(()=>document.querySelector('#operation-panel').textContent.includes('qa-fixture'));
    assert.equal(await page.locator('#operation-form').count(),0);assert.equal(await page.locator('#release-operation').count(),0);
    await page.selectOption('#project-select',f.externalId);
    await page.waitForFunction(()=>!document.querySelector('#standard-operation-settings').hidden);
    assert.equal(await page.locator('#profile-operation-scope').isVisible(),false);
    assert.equal(await page.locator('#operation-panel').isVisible(),false);
    runPayload=null;
    await page.click('#run-button');
    await page.waitForFunction(()=>document.querySelector('#run-button').disabled===false);
    assert.equal(runPayload.operation.mode,'preview');assert.equal(runPayload.operation.confirmed,false);
  }finally{await browser.close();}
});
