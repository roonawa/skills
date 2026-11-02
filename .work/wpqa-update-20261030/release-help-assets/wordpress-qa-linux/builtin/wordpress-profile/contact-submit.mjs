import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {ensure,sameOrigin,readSettings,requireWrites} from './helpers.mjs';

const hiddenNames=new Set(['_wpcf7','_wpcf7_version','_wpcf7_locale','_wpcf7_unit_tag','_wpcf7_container_post','_wpcf7_posted_data_hash','_wpnonce']);
const note='CF7 response only; inbox delivery was not checked. No Flamingo data was deleted.';
const validToken=token=>ensure(typeof token==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(token),'BLOCKED: invalid case token');

export function requireContactSubmission(config,profile){
  requireWrites(config,profile);
  ensure(profile.submit===true,'BLOCKED: contact submission requires submit=true');
}

function validateProfile(profile){
  ensure(profile&&typeof profile==='object'&&!Array.isArray(profile),'BLOCKED: invalid contact profile');
  ensure(Number.isSafeInteger(profile.contactFormId)&&profile.contactFormId>0,'BLOCKED: invalid contact form ID');
  ensure(typeof profile.testEmail==='string'&&profile.testEmail.length<=254&&/^[^\s@<>\x00-\x1f\x7f]+@[^\s@<>\x00-\x1f\x7f]+\.[^\s@<>\x00-\x1f\x7f]+$/.test(profile.testEmail),'BLOCKED: exact test email required');
  const names=['contactNameField','contactEmailField','contactMessageField'].map(k=>profile[k]);
  if(profile.contactConsentField!==undefined&&profile.contactConsentField!==null&&profile.contactConsentField!=='')names.push(profile.contactConsentField);
  ensure(names.every(n=>typeof n==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(n))&&new Set(names).size===names.length,'BLOCKED: invalid or duplicate contact field names');
}

export function readContactSettings(config,env=process.env){
  let profile;
  try{profile=JSON.parse(env.WPQA_UI_PROFILE);}catch{throw new Error('BLOCKED: invalid contact profile JSON');}
  ensure(profile&&typeof profile==='object'&&!Array.isArray(profile),'BLOCKED: invalid contact profile');
  requireContactSubmission(config,profile);
  validateProfile(profile);
  ensure(typeof profile.contactPath==='string'&&profile.contactPath.trim().length>0,'BLOCKED: contactPath required');
  profile={adminPath:'/wp-admin/',...profile};
  ensure(typeof profile.adminPath==='string'&&/^\/(?:[A-Za-z0-9_-]+\/)*wp-admin\/$/.test(profile.adminPath),'BLOCKED: invalid contact adminPath');
  // Reuse state isolation without changing the other built-in profiles' schema.
  const {state,base}=readSettings(config,{...env,WPQA_UI_PROFILE:JSON.stringify({adminPath:profile.adminPath,contactFormId:profile.contactFormId,writes:profile.writes})});
  const contact=sameOrigin(profile.contactPath,base.href);
  ensure(!contact.hash,'BLOCKED: contactPath must not contain a fragment');
  // Assume the standard REST mount under the configured installation prefix;
  // the contact page's directory does not identify that mount.
  const admin=sameOrigin(profile.adminPath,base.href);
  const endpoint=sameOrigin(`../wp-json/contact-form-7/v1/contact-forms/${profile.contactFormId}/feedback`,admin.href);
  return {profile,state,base,contact,endpoint};
}

export function buildContactFields(source,profile,token){
  validateProfile(profile);validToken(token);
  ensure(typeof source==='string'&&Buffer.byteLength(source)<=2*1024*1024,'BLOCKED: contact HTML unavailable or too large');
  const $=load(source);
  const forms=$('form').filter((_,form)=>$(form).find('input[type="hidden"][name="_wpcf7"]').toArray().some(input=>$(input).attr('value')===String(profile.contactFormId)));
  ensure(forms.length===1,'BLOCKED: CF7 form missing or ambiguous');
  const form=forms.first(),fields=Object.create(null);
  const controls=form.find('input,textarea,select,button');
  const named=name=>controls.filter((_,el)=>$(el).attr('name')===name);
  const enabled=el=>!el.is('[disabled]')&&!el.parents('fieldset[disabled]').length;
  for(const name of hiddenNames){
    const input=named(name);
    if(!input.length)continue;
    ensure(input.length===1&&input.is('input[type="hidden"]')&&enabled(input),'BLOCKED: invalid CF7 hidden metadata');
    const value=input.attr('value')??'';
    ensure(value.length<=1024&&!/[\x00-\x1f\x7f]/.test(value),'BLOCKED: invalid CF7 hidden metadata');
    fields[name]=value;
  }
  ensure(fields._wpcf7===String(profile.contactFormId),'BLOCKED: CF7 form ID mismatch');
  const fill=(name,kind,value)=>{
    const input=named(name);
    ensure(input.length===1&&enabled(input),'BLOCKED: configured contact field missing, disabled or ambiguous');
    const type=(input.attr('type')??'text').toLowerCase();
    ensure(kind==='message'?input.is('textarea'):input.is('input')&&type===(kind==='email'?'email':'text'),'BLOCKED: incompatible contact field type');
    for(const [attr,compare] of [['minlength',(n)=>value.length>=n],['maxlength',(n)=>value.length<=n]]){
      const limit=input.attr(attr);
      ensure(limit===undefined||(/^\d+$/.test(limit)&&compare(Number(limit))),'BLOCKED: sample violates contact field length');
    }
    fields[name]=value;
  };
  fill(profile.contactNameField,'name',`QA ${token}`);
  fill(profile.contactEmailField,'email',profile.testEmail);
  fill(profile.contactMessageField,'message',`Staging/local QA test submission. Correlation: ${token}`);
  if(profile.contactConsentField){
    const consent=named(profile.contactConsentField);
    ensure(consent.length===1&&consent.is('input[type="checkbox"]')&&enabled(consent),'BLOCKED: configured consent checkbox missing or ambiguous');
    const value=consent.attr('value')??'on';
    ensure(value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value),'BLOCKED: invalid consent value');
    fields[profile.contactConsentField]=value;
  }
  controls.each((_,el)=>{
    const input=$(el),name=input.attr('name');
    const required=input.is('[required]')||input.attr('aria-required')==='true'||input.hasClass('wpcf7-validates-as-required')||input.closest('.wpcf7-acceptance:not(.optional)').length>0;
    ensure(!required||(name&&Object.hasOwn(fields,name)),'BLOCKED: unconfigured required contact field');
  });
  return fields;
}

function directories(context,config){
  ensure(context?.config?.baseURL===config.baseURL&&context.config.environment===config.environment&&context.config.allowTestWrites===true,'BLOCKED: contact runner context mismatch');
  const configDir=context.configPath?path.dirname(context.configPath):context.configDir;
  ensure(typeof configDir==='string'&&path.isAbsolute(configDir)&&typeof context.runDir==='string'&&path.isAbsolute(context.runDir),'BLOCKED: durable contact directories required');
  if(context.configPath)ensure(path.isAbsolute(context.configPath),'BLOCKED: absolute configPath required');
  if(context.configDir)ensure(fs.realpathSync(context.configDir)===fs.realpathSync(configDir),'BLOCKED: config directory mismatch');
  return {configDir:fs.realpathSync(configDir),runDir:fs.realpathSync(context.runDir)};
}

function readRecord(file){
  try{
    const stat=fs.lstatSync(file);
    ensure(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=8192,'BLOCKED: invalid contact journal');
    return JSON.parse(fs.readFileSync(file,'utf8'));
  }catch(error){if(error.code==='ENOENT')return null;throw new Error('BLOCKED: unreadable contact journal; review pending submission');}
}
function writeRecord(file,record){
  if(fs.existsSync(file))ensure(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink(),'BLOCKED: invalid contact journal');
  const fd=fs.openSync(file,'w',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(record,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}

// The directory mutex protects read/replace transitions. A crash leaves a stale
// mutex or pending record for manual resolution, never an automatic POST retry.
export function beginSubmission({config,context,token}){
  validToken(token);
  const {configDir,runDir}=directories(context,config);
  const pending=path.join(configDir,'profile-contact-pending.json');
  const mutex=pending+'.lock';
  try{fs.mkdirSync(mutex);}catch{throw new Error('BLOCKED: contact submission pending or locked');}
  let closed=false;
  const close=()=>{if(!closed){fs.rmdirSync(mutex);closed=true;}};
  try{
    const previous=readRecord(pending);
    ensure(!previous||previous.status==='mail_sent','BLOCKED: unresolved contact submission pending');
    ensure(!previous||previous.token!==token,'BLOCKED: contact token already submitted');
    const recordFile=path.join(runDir,`profile-contact-submit-${createHash('sha256').update(token).digest('hex')}.json`);
    const old=readRecord(recordFile);
    ensure(!old||old.status==='validation_failed','BLOCKED: contact token already submitted or pending');
    const record={token,status:'pending',recordedAt:new Date().toISOString(),inboxVerified:false};
    // Both durable records must exist before the caller is allowed to POST.
    writeRecord(pending,record);writeRecord(recordFile,record);
    return {close,complete(status){
      ensure(!closed&&record.status==='pending'&&['mail_sent','validation_failed'].includes(status),'BLOCKED: contact response is not safely resolved');
      const resolved={...record,status,resolvedAt:new Date().toISOString()};
      writeRecord(recordFile,resolved);
      if(status==='validation_failed')fs.unlinkSync(pending);
      else writeRecord(pending,resolved);
      record.status=status;
    }};
  }catch(error){close();throw error;}
}

export async function run(args){
  const {config,token,expect,attach=async()=>{},testInfo}=args;
  const {profile,state,base,contact,endpoint}=readContactSettings(config);
  validToken(token);
  let runnerContext;
  try{runnerContext=JSON.parse(fs.readFileSync(process.env.WPQA_CONTEXT,'utf8'));directories(runnerContext,config);}
  catch{throw new Error('BLOCKED: valid WPQA_CONTEXT with durable contact directories required');}
  testInfo?.setTimeout(120000);
  let browser,context,journal;
  let status='not_submitted',httpStatus;
  let failed=false;
  try{
    const {chromium}=await import('@playwright/test');
    browser=await chromium.launch();
    context=await browser.newContext({storageState:state,javaScriptEnabled:false,serviceWorkers:'block'});
    // No pages, scripts, inherited request fixture, redirects or transport retries.
    const options={maxRedirects:0,maxRetries:0,timeout:config.timeoutMs||15000};
    const page=await context.request.get(sameOrigin(contact.href,base.href).href,options);
    let source;
    try{
      ensure(page.status()===200,'BLOCKED: contact page unavailable');
      source=await page.text();
    }finally{await page.dispose();}
    const fields=buildContactFields(source,profile,token);
    requireContactSubmission(config,profile);
    journal=beginSubmission({config,context:runnerContext,token});
    status='pending';
    const response=await context.request.post(endpoint.href,{...options,multipart:fields});
    try{
      httpStatus=response.status();
      // Never retain raw messages, invalid_fields, mail addresses or response bodies.
      const data=await response.json();
      if(httpStatus===200&&Number(data?.contact_form_id)===profile.contactFormId&&['mail_sent','validation_failed'].includes(data?.status)){
        journal.complete(data.status);status=data.status;
      }
      if(expect){expect(httpStatus,'CF7 feedback HTTP status').toBe(200);expect(status,'CF7 feedback result (inbox not checked)').toBe('mail_sent');}
      ensure(httpStatus===200&&status==='mail_sent','BLOCKED: contact submission not confirmed');
    }finally{await response.dispose();}
  }catch{failed=true;}
  finally{
    try{journal?.close();}catch{failed=true;}
    try{await context?.close();}catch{failed=true;}
    try{await browser?.close();}catch{failed=true;}
  }
  try{await attach('contact-submit',{token,status,...(httpStatus!==undefined?{httpStatus}:{}),inboxVerified:false,note});}
  catch{failed=true;}
  if(failed)throw new Error('BLOCKED: contact submission not confirmed or evidence unavailable; inspect sanitized status and pending journal before retrying');
  return {token,status,inboxVerified:false};
}
