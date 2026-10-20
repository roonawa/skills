import assert from 'node:assert/strict';
import { resolve, relative, isAbsolute } from 'node:path';
import { realpath, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { waitForMail, envHeaders } from '../mailpit.mjs';
import { networkPolicy, validateNetworkPolicy } from '../network-policy.mjs';

export const kinds = ['browser-flow', 'mail-delivery', 'operation-drill'];
const actions = ['goto','fill','click','check','select','press','setInputFiles','assertVisible','assertText','assertCount','assertURL','assertAttribute','waitForMail'];
const assertions = actions.filter(x=>x.startsWith('assert')).concat('waitForMail');
function object(value, keys, label) {
  assert.ok(value && typeof value==='object' && !Array.isArray(value), `${label} must be an object`);
  for(const key of Object.keys(value)) assert.ok(keys.includes(key), `${label}: unknown field ${key}`);
}
function string(value,label) { assert.ok(typeof value==='string' && value.length>0,`${label} required`); }
function mail(options) {
  object(options,['source','expected'],'mail');
  object(options.source,['url','headersEnv'],'mail source'); string(options.source.url,'mail source url');
  assert.ok(['http:','https:'].includes(new URL(options.source.url).protocol),'mail source must be HTTP');
  object(options.expected,['to','subject','textIncludes','count','timeoutMs','settleMs','attachments'],'mail expected');
  const e=options.expected;
  assert.ok(typeof e.to==='string' || (Array.isArray(e.to) && e.to.length && e.to.every(x=>typeof x==='string')),'mail recipients required');
  for(const key of ['count','timeoutMs','settleMs']) if(e[key]!==undefined) assert.ok(Number.isInteger(e[key]) && e[key]>0,`${key} must be positive integer`);
  assert.ok(`${e.subject??''}${e.textIncludes??''}`.includes('{{token}}'),'mail expectation must correlate {{token}}');
  if(e.attachments!==undefined) {
    object(e.attachments,['count','names'],'attachments');
    assert.ok(Number.isInteger(e.attachments.count)&&e.attachments.count>=0,'attachment count required');
    if(e.attachments.names!==undefined) assert.ok(Array.isArray(e.attachments.names)&&e.attachments.names.every(x=>typeof x==='string'),'attachment names must be strings');
  }
}
function probe(p) {
  object(p,['url','status','bodyIncludes'],'probe'); string(p.url,'probe url'); string(p.bodyIncludes,'probe bodyIncludes');
  assert.ok(Number.isInteger(p.status) && p.status>=100 && p.status<=599,'probe status required');
}
export function validate(check,config) {
  assert.ok(kinds.includes(check.kind),'unsupported workflow kind');
  const o=check.options;
  if(check.kind==='browser-flow') {
    assert.ok(['delivery','commerce','membership','multilingual'].includes(check.suite),'invalid browser-flow suite');
    object(o,['steps','roleEnv','sandbox','allowedResourceOrigins','allowedNavigationOrigins','allowedInteractionOrigins'],'browser-flow options');
    validateNetworkPolicy(o);
    if(o.roleEnv!==undefined) assert.match(o.roleEnv,/^[A-Z_][A-Z0-9_]*$/,'roleEnv must name an environment variable');
    if(check.suite==='commerce') assert.equal(o.sandbox,true,'commerce requires sandbox=true');
    assert.ok(Array.isArray(o.steps) && o.steps.length>0 && o.steps.length<=200,'steps required (maximum 200)');
    for(const s of o.steps) {
      object(s,['action','selector','value','url','count','name','source','expected','mimeType'],'step');
      assert.ok(actions.includes(s.action),'unknown step action');
      if(s.action==='waitForMail') mail({source:s.source,expected:s.expected});
      else if(s.action==='goto' || s.action==='assertURL') string(s.url,'step url');
      else string(s.selector,'step selector');
      if(['fill','select','press','assertText','assertAttribute'].includes(s.action)) assert.equal(typeof s.value,'string','step value required');
      if(s.action==='assertAttribute') string(s.name,'attribute name');
      if(s.action==='setInputFiles') {
        string(s.name,'file name');assert.ok(!/[\\/]/.test(s.name),'file name must be a basename');
        string(s.mimeType,'mimeType');assert.equal(typeof s.value,'string','file text required');assert.ok(s.value.length<=1000000,'file too large');
      }
      if(s.action==='assertCount') assert.ok(Number.isInteger(s.count)&&s.count>=0,'count required');
    }
    assert.ok(assertions.includes(o.steps.at(-1).action),'flow must end with explicit expectation');
  } else if(check.kind==='mail-delivery') { assert.equal(check.suite,'delivery'); mail(o); }
  else {
    assert.ok(['operations','scheduled'].includes(check.suite),'invalid operation suite');
    object(o,['adapter','operation','before','after'],'operation options');
    string(o.adapter,'adapter'); assert.ok(['update','restore','cron'].includes(o.operation),'operation must be update, restore or cron');
    assert.equal(check.suite==='scheduled',o.operation==='cron','cron requires scheduled suite');
    probe(o.before); probe(o.after);
    assert.equal(o.before.url,o.after.url,'before and after must probe the same resource');
    assert.notEqual(o.before.bodyIncludes,o.after.bodyIncludes,'before and after state markers must differ');
    assert.ok(o.after.bodyIncludes.includes('{{token}}'),'after probe must include current {{token}}');
  }
}
function writes(config) {
  if(!['local','test','staging','development','pt','st'].includes(config.environment??config.env) || config.allowTestWrites!==true)
    throw new Error('BLOCKED: workflow writes require nonproduction environment and allowTestWrites=true');
}
function substitute(value,token) {
  if(typeof value==='string') return value.replaceAll('{{token}}',token);
  if(Array.isArray(value)) return value.map(v=>substitute(v,token));
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,substitute(v,token)]));
  return value;
}
function siteURL(url,config) {
  const result=new URL(url,config.baseURL);
  assert.equal(result.origin,new URL(config.baseURL).origin,'workflow URL must remain on configured origin');
  return result.href;
}
async function mailRun(o,token) {
  const result=await waitForMail(o.source,{...o.expected,token});
  if(o.expected.attachments) for(const item of result) {
    const response=await fetch(new URL(`/api/v1/message/${encodeURIComponent(item.id)}`,o.source.url),{headers:envHeaders(o.source.headersEnv),redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok) throw new Error('BLOCKED: attachment API unavailable');
    const message=await response.json();
    if(!Array.isArray(message.Attachments)) throw new Error('BLOCKED: attachment metadata unavailable');
    assert.equal(message.Attachments.length,o.expected.attachments.count,'attachment count differs');
    if(o.expected.attachments.names) assert.deepEqual(message.Attachments.map(a=>a.FileName).sort(),[...o.expected.attachments.names].sort(),'attachment names differ');
  }
  return {count:result.length,correlated:true};
}
export async function run({check,config,requestFactory,browser,token,configDir,runDir,attach,record,signal}) {
  const events=[];
  async function emit(event) { events.push(event); if(record) await record(event); }
  function aborted() { signal?.throwIfAborted(); }
  try {
  aborted();
  validate(check,config);
  assert.match(token,/^[a-zA-Z0-9-]{8,128}$/,'unique run token required');
  const o=substitute(check.options,token);
  if(check.kind==='mail-delivery') return mailRun(o,token);
  if(check.kind==='browser-flow') {
    const policy=networkPolicy(config.baseURL??'http://localhost',o);
    if(o.allowedNavigationOrigins?.length || o.allowedInteractionOrigins?.length) {
      writes(config); assert.equal(o.sandbox,true,'external navigation and interaction require sandbox=true');
    }
    if(check.suite==='commerce' || o.steps.some(s=>['click','check','select','press','fill','setInputFiles'].includes(s.action))) writes(config);
    if(!browser) throw new Error('BLOCKED: browser unavailable');
    let storageState;
    if(o.roleEnv) {
      const state=process.env[o.roleEnv];
      if(!state) throw new Error(`BLOCKED: role environment ${o.roleEnv} missing`);
      try {
        storageState=JSON.parse(state.trim().startsWith('{')?state:await readFile(resolve(configDir??process.cwd(),state),'utf8'));
      } catch {throw new Error('BLOCKED: role storage state must be valid JSON or a readable JSON file');}
      const base=new URL(config.baseURL);
      if(!storageState||!Array.isArray(storageState.cookies)||!Array.isArray(storageState.origins)||
        storageState.cookies.some(c=>typeof c.domain!=='string'||c.domain.replace(/^\./,'')!==base.hostname||typeof c.name!=='string'||typeof c.value!=='string'||typeof c.path!=='string')||
        storageState.origins.some(origin=>origin.origin!==base.origin||!Array.isArray(origin.localStorage)))
        throw new Error('BLOCKED: role storage state must be restricted to configured site origin');
    }
    const context=await browser.newContext({baseURL:config.baseURL,storageState,serviceWorkers:'block',acceptDownloads:false});
    try {
      await context.route('**/*',route=>policy.route(route));
      const page=await context.newPage(); page.setDefaultTimeout(config.timeoutMs??15000);
      const {expect}=await import('@playwright/test');
      const summary=[];
      for(const [index,s] of o.steps.entries()) {
        aborted();
        await emit({kind:'step',phase:'before',index,action:s.action});
        let passed=false,actual,expected;
        const locator=s.selector? page.locator(s.selector):null;
        try {
        switch(s.action) {
          case 'goto': assert.ok(policy.navigation(s.url),'workflow navigation origin denied'); await page.goto(new URL(s.url,config.baseURL).href); break;
          case 'fill': await locator.fill(s.value); break;
          case 'click': await locator.click(); break;
          case 'check': await locator.check(); break;
          case 'select': await locator.selectOption(s.value); break;
          case 'press': await locator.press(s.value); break;
          case 'setInputFiles': await locator.setInputFiles({name:s.name,mimeType:s.mimeType,buffer:Buffer.from(s.value,'utf8')}); break;
          case 'assertVisible': await expect(locator).toBeVisible(); break;
          case 'assertText': await expect(locator).toHaveText(s.value); break;
          case 'assertCount': await expect(locator).toHaveCount(s.count); break;
          case 'assertURL': assert.ok(policy.navigation(s.url),'workflow navigation origin denied'); await expect(page).toHaveURL(new URL(s.url,config.baseURL).href); break;
          case 'assertAttribute': await expect(locator).toHaveAttribute(s.name,s.value); break;
          case 'waitForMail': await mailRun(s,token); break;
        }
        summary.push({action:s.action,passed:true});
        passed=true;
        } finally {
          if(s.action==='assertCount') {expected={count:s.count}; actual={count:await locator.count().catch(()=>null)};}
          else if(s.action==='assertVisible') {expected={visible:true};actual={visible:await locator.isVisible().catch(()=>false)};}
          else if(s.action.startsWith('assert')) { expected={matches:true}; actual={matches:passed}; }
          await emit({kind:'step',phase:'after',index,action:s.action,passed,...(expected?{expected,actual}:{})});
        }
      }
      return {steps:summary,roleConfigured:!!o.roleEnv};
    } finally { await context.close(); }
  }
  writes(config);
  const modulePath=config.trustedAdapters?.[o.adapter];
  if(typeof modulePath!=='string') throw new Error('BLOCKED: trusted operation adapter not configured');
  async function observe(p,absent) {
    aborted();
    const index=events.filter(e=>e.kind==='probe'&&e.phase==='before').length;
    await emit({kind:'probe',phase:'before',index,expected:{status:p.status,markerPresent:true}});
    let passed=false,actual={};
    try {
    const response=await fetch(siteURL(p.url,config),{redirect:'error',signal:AbortSignal.timeout(config.timeoutMs??15000),headers:{'Cache-Control':'no-cache'}});
    actual.status=response.status;
    assert.equal(response.status,p.status,'operation probe HTTP status differs');
    const body=await response.text(); actual.markerPresent=body.includes(p.bodyIncludes); assert.ok(actual.markerPresent,'operation probe state marker missing');
    if(absent) assert.ok(!body.includes(absent),'operation target marker already exists before execution');
    passed=true; return {status:response.status,sha256:createHash('sha256').update(body).digest('hex')};
    } finally {await emit({kind:'probe',phase:'after',index,passed,actual});}
  }
  const before=await observe(o.before,o.after.bodyIncludes);
  const adapter=await import(pathToFileURL(resolve(configDir??process.cwd(),modulePath)).href);
  if(typeof adapter.execute!=='function') throw new Error('BLOCKED: adapter execute export missing');
  aborted();
  const result=await adapter.execute({operation:o.operation,token,baseURL:config.baseURL,runDir,signal});
  assert.equal(result?.performed,true,'adapter did not perform operation'); assert.equal(result.operation,o.operation);
  assert.ok(Array.isArray(result.evidence)&&result.evidence.length>0,'adapter must provide evidence file paths');
  const root=await realpath(runDir),evidence=[];
  for(const file of result.evidence) {
    string(file,'evidence path'); const path=await realpath(resolve(root,file)),rel=relative(root,path);
    assert.ok(rel && !rel.startsWith('..')&&!isAbsolute(rel),'evidence must stay within run directory');
    const bytes=await readFile(path); assert.ok(bytes.length>0,'evidence must not be empty');
    assert.ok(bytes.toString('utf8').includes(token),'evidence must contain current run token');
    evidence.push({file:rel,sha256:createHash('sha256').update(bytes).digest('hex')});
    await emit({kind:'artifact',phase:'after',file:rel,sha256:evidence.at(-1).sha256});
  }
  const after=await observe(o.after);
  assert.notEqual(before.sha256,after.sha256,'operation did not change independently observed state');
  const summary={operation:o.operation,before,after,evidence};
  if(attach) await attach('operation-verification',summary);
  return summary;
  } catch(error) { error.qaEvidence=events; throw error; }
}
