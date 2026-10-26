import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {requireContactSubmission,readContactSettings,buildContactFields,beginSubmission,run} from '../builtin/wordpress-profile/contact-submit.mjs';

const config={baseURL:'https://fixture.test',environment:'staging',allowTestWrites:true};
const profile={contactFormId:42,contactPath:'/contact/',testEmail:'Exact+QA@example.test',contactNameField:'your-name',contactEmailField:'your-email',contactMessageField:'your-message',contactConsentField:'agree',submit:true,writes:true};
const env=(p=profile)=>({WPQA_UI_PROFILE:JSON.stringify(p),WPQA_UI_ADMIN_STATE:JSON.stringify({cookies:[],origins:[]})});
const html=`<form><input type="hidden" name="_wpcf7" value="99"></form>
<form><input type="hidden" name="_wpcf7" value="42"><input type="hidden" name="_wpcf7_version" value="6.1">
<input type="hidden" name="_wpcf7_unit_tag" value="wpcf7-f42-p1-o1"><input type="hidden" name="unrelated" value="do-not-copy">
<input type="text" name="your-name" required value="do-not-copy"><input type="email" name="your-email" aria-required="true">
<textarea name="your-message" required>do-not-copy</textarea><span class="wpcf7-acceptance"><input type="checkbox" name="agree" value="1"></span></form>`;

test('all write permissions are required; production always refuses',()=>{
  for(const environment of ['production','preview',undefined])assert.throws(()=>requireContactSubmission({...config,environment},profile),/BLOCKED/);
  for(const value of [false,undefined,'true',1]){
    assert.throws(()=>requireContactSubmission({...config,allowTestWrites:value},profile),/BLOCKED/);
    for(const key of ['submit','writes'])assert.throws(()=>requireContactSubmission(config,{...profile,[key]:value}),/BLOCKED/);
  }
  for(const environment of ['staging','local'])requireContactSubmission({...config,environment},profile);
});

test('settings reject off-origin paths, unsafe fields, missing exact email and unrelated auth',()=>{
  assert.equal(readContactSettings(config,env()).profile.testEmail,profile.testEmail);
  for(const patch of [{contactPath:'https://other.test/contact'},{contactPath:'//other.test/'},{contactPath:'https://user:secret@fixture.test/'},{contactPath:''},{testEmail:' user@example.test'},{testEmail:'a@b.test\r\nBcc: secret'},{testEmail:''},{contactNameField:'_wpcf7'},{contactEmailField:'your-name'},{contactFormId:0},{contactMessageField:'x]'}]){
    assert.throws(()=>readContactSettings(config,env({...profile,...patch})),/BLOCKED/);
  }
  assert.throws(()=>readContactSettings(config,{...env(),WPQA_UI_ADMIN_STATE:JSON.stringify({cookies:[],origins:[{origin:'https://other.test',localStorage:[]}]})}),/BLOCKED/);
});

test('feedback endpoint follows the configured WordPress installation prefix',()=>{
  for(const [adminPath,expected] of [
    ['/wp-admin/','https://fixture.test/wp-json/contact-form-7/v1/contact-forms/42/feedback'],
    ['/wordpress/wp-admin/','https://fixture.test/wordpress/wp-json/contact-form-7/v1/contact-forms/42/feedback'],
    ['/sites/qa/wp-admin/','https://fixture.test/sites/qa/wp-json/contact-form-7/v1/contact-forms/42/feedback']
  ]){
    const settings=readContactSettings(config,env({...profile,adminPath}));
    assert.equal(settings.profile.adminPath,adminPath);
    assert.equal(settings.endpoint.href,expected);
    assert.equal(settings.contact.href,'https://fixture.test/contact/');
  }
  assert.equal(readContactSettings(config,env()).endpoint.href,'https://fixture.test/wp-json/contact-form-7/v1/contact-forms/42/feedback');
});

test('endpoint derivation rejects external, traversal and non-admin paths',()=>{
  for(const adminPath of ['https://other.test/wp-admin/','//other.test/wp-admin/','/wordpress/../wp-admin/','/wordpress/%2e%2e/wp-admin/','/wordpress\\wp-admin/','/wordpress/wp-admin/?x=1','/wordpress/not-admin/']){
    assert.throws(()=>readContactSettings(config,env({...profile,adminPath})),/BLOCKED/);
  }
});

test('form helper selects hidden CF7 ID, copies only allowed hidden fields and uses exact email',()=>{
  const fields=buildContactFields(html,profile,'qa-case-123');
  assert.equal(fields._wpcf7,'42');assert.equal(fields._wpcf7_version,'6.1');assert.equal(fields.agree,'1');
  assert.equal(fields['your-email'],'Exact+QA@example.test');
  assert.match(fields['your-name'],/qa-case-123/);assert.match(fields['your-message'],/qa-case-123/);
  assert.equal(fields.unrelated,undefined);assert.ok(!JSON.stringify(fields).includes('do-not-copy'));
});

test('missing, duplicate, disabled and incompatible fields fail before submission',()=>{
  for(const source of [html.replace('value="42"','value="41"'),html+html,html.replace('name="your-name" required','name="your-name" disabled'),html.replace('type="email"','type="password"'),html.replace('</textarea>','</textarea><input name="unknown" required>'),html.replace('name="agree"','name="different"'),html.replace('name="your-name" required','name="your-name" required maxlength="2"')]){
    assert.throws(()=>buildContactFields(source,profile,'qa-case-123'),/BLOCKED/);
  }
  assert.throws(()=>buildContactFields(html,{...profile,contactConsentField:undefined},'qa-case-123'),/BLOCKED/);
  assert.throws(()=>buildContactFields(html,profile,'secret\ninvalid'),/BLOCKED/);
  assert.throws(()=>buildContactFields(html.replace('value="42">','value="42"><input type="hidden" name="_wpcf7" value="99">'),profile,'qa-case-123'),/BLOCKED/);
});

test('optional consent can be omitted without copying unrelated default values',()=>{
  const fields=buildContactFields(html.replace('class="wpcf7-acceptance"','class="wpcf7-acceptance optional"'),{...profile,contactConsentField:undefined},'qa-optional');
  assert.equal(fields.agree,undefined);assert.equal(fields.unrelated,undefined);
});

function fixture(t){
  const configDir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-contact-'));
  t.after(()=>fs.rmSync(configDir,{recursive:true,force:true}));
  const runDir=path.join(configDir,'run');fs.mkdirSync(runDir);
  return {config,context:{config,configDir,configPath:path.join(configDir,'site.json'),runDir},token:'qa-case-123'};
}

test('intent exists before transport, contains no email, and unresolved outcome blocks resend',t=>{
  const args=fixture(t),journal=beginSubmission(args);
  const pending=path.join(args.context.configDir,'profile-contact-pending.json');
  assert.equal(JSON.parse(fs.readFileSync(pending)).status,'pending');
  assert.equal(fs.readdirSync(args.context.runDir).length,1);
  assert.ok(!fs.readFileSync(pending,'utf8').includes(profile.testEmail));
  assert.throws(()=>beginSubmission({...args,token:'qa-other'}),/BLOCKED/);
  journal.close();
  assert.throws(()=>beginSubmission({...args,token:'qa-other'}),/pending/);
});

test('mail_sent records confirmation, prevents same token repeat, permits a new token',t=>{
  const args=fixture(t),journal=beginSubmission(args);
  journal.complete('mail_sent');journal.close();
  assert.throws(()=>beginSubmission(args),/already/);
  const next=beginSubmission({...args,token:'qa-next'});next.complete('validation_failed');next.close();
  assert.throws(()=>beginSubmission(args),/already/);
  const record=JSON.parse(fs.readFileSync(path.join(args.context.runDir,fs.readdirSync(args.context.runDir).find(f=>JSON.parse(fs.readFileSync(path.join(args.context.runDir,f))).token===args.token))));
  assert.equal(record.status,'mail_sent');
});

test('only confirmed validation failure clears pending; other statuses retain it',t=>{
  const args=fixture(t),journal=beginSubmission(args);
  for(const status of ['mail_failed','spam','aborted','unknown'])assert.throws(()=>journal.complete(status),/BLOCKED/);
  journal.complete('validation_failed');journal.close();
  assert.equal(fs.existsSync(path.join(args.context.configDir,'profile-contact-pending.json')),false);
  const retry=beginSubmission(args);retry.close();
});

test('malformed prior journal fails closed without replacing it',t=>{
  const args=fixture(t),pending=path.join(args.context.configDir,'profile-contact-pending.json');
  fs.writeFileSync(pending,'incomplete');
  assert.throws(()=>beginSubmission(args),/BLOCKED/);
  assert.equal(fs.readFileSync(pending,'utf8'),'incomplete');
  assert.deepEqual(fs.readdirSync(args.context.runDir),[]);
});

test('runner context must match the authorized site, environment and write permission',t=>{
  const args=fixture(t);
  for(const patch of [{baseURL:'https://other.test'},{environment:'production'},{allowTestWrites:false}]){
    assert.throws(()=>beginSubmission({...args,context:{...args.context,config:{...config,...patch}}}),/BLOCKED/);
  }
  assert.throws(()=>beginSubmission({...args,context:{...args.context,runDir:'relative'}}),/BLOCKED/);
  assert.deepEqual(fs.readdirSync(args.context.runDir),[]);
});

test('run rejects production before browser or network access',async()=>{
  const saved=process.env.WPQA_UI_PROFILE;process.env.WPQA_UI_PROFILE=JSON.stringify(profile);
  try{await assert.rejects(run({config:{...config,environment:'production'},token:'qa-production'}),/BLOCKED/);}
  finally{if(saved===undefined)delete process.env.WPQA_UI_PROFILE;else process.env.WPQA_UI_PROFILE=saved;}
});
