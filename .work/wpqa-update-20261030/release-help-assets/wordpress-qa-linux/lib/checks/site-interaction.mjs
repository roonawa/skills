import assert from 'node:assert/strict';
import {expect, firefox} from '@playwright/test';
import {load} from 'cheerio';
import {sameOrigin} from '../config.mjs';
import {fetchPage, internalLinks} from '../audit.mjs';
import {envHeaders} from '../mailpit.mjs';

export const kinds = ['site-interaction'];
const operations = ['all-links','search-product','search-empty','search-special','menu','menu-navigation','contact-validation','server-validation','network-failure','keyboard','firefox','performance','public-discovery','cart-limit','customer-empty'];
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const blocked = message => { throw Error('BLOCKED: '+message); };
const gateSelector='form.password-protected-form, input[name="password_protected_pwd"]';
const gateError=()=>Object.assign(Error('BLOCKED: site gate expired; refresh site-gate credentials'),{code:'SITE_GATE_EXPIRED'});
const configuredPath=value=>value!==undefined&&!(typeof value==='string'&&!value.trim());
const cartOperation = op => ['cart-limit','customer-empty'].includes(op);
function sessionHeaders(requestHeaders, gateHeaders, cookies) {
 const normalize=headers=>Object.fromEntries(Object.entries(headers).map(([key,value])=>[key.toLowerCase(),value]));
 const request=normalize(requestHeaders),gate=normalize(gateHeaders),merged=new Map();
 // Gate cookies bootstrap access; request cookies and the current URL-scoped
 // browser jar override stale values, including freshly rotated Welcart sessions.
 for(const value of [gate.cookie,request.cookie]) for(const part of (value??'').split(';')) {
  const index=part.indexOf('=');if(index<1) continue;
  merged.set(part.slice(0,index).trim(),part.slice(index+1).trim());
 }
 for(const cookie of [...cookies].sort((a,b)=>a.path.length-b.path.length)) merged.set(cookie.name,cookie.value);
 return {...request,...gate,cookie:[...merged].map(([name,value])=>`${name}=${value}`).join('; ')};
}
async function pool3(items, visit, signal) {
 let next=0;
 await Promise.all(Array.from({length:Math.min(3,items.length)},async()=>{
  while(next<items.length&&!signal?.aborted) {const index=next++;await visit(items[index],index);}
 }));
}
function writesAllowed(config) {
 if (!['local','staging'].includes(config.environment) || config.allowTestWrites !== true) blocked('site-interaction writes require local/staging environment and allowTestWrites=true');
}
export function validate(check, config) {
 const o=check.options;
 if(!object(o)||!operations.includes(o.operation)) blocked('options.operation must be a supported site-interaction operation');
 if(Object.keys(o).some(k=>!['operation','settings'].includes(k))) blocked('options accepts only operation and settings');
 if(!object(o.settings)) blocked('options.settings must be an object');
 const s=o.settings;
 for(const group of ['search','menu','contact','commerce']) if(s[group]!==undefined&&!object(s[group])) blocked('settings.'+group+' must be an object');
 if(s.paths!==undefined&&!Array.isArray(s.paths)) blocked('settings.paths must be an array');
 if(s.scrollSteps!==undefined&&(!Number.isInteger(s.scrollSteps)||s.scrollSteps<0||s.scrollSteps>30)) blocked('settings.scrollSteps must be an integer from 0 to 30');
 if(s.scrollStepPx!==undefined&&(!Number.isInteger(s.scrollStepPx)||s.scrollStepPx<100||s.scrollStepPx>1000)) blocked('settings.scrollStepPx must be an integer from 100 to 1000');
 for(const p of [s.sitePath,s.contact?.path,s.contact?.restPath,s.menu?.targetPath,s.commerce?.productPath,s.commerce?.cartPath,...(s.paths??[])].filter(configuredPath)) sameOrigin(p,config.baseURL);
 // Incomplete conditions can be saved; execution reports the missing fields.
}
export function validateRuntime(check, config) {
 const o = check.options;
 if (!object(o) || !operations.includes(o.operation)) blocked('options.operation must be a supported site-interaction operation');
 if (Object.keys(o).some(k=>!['operation','settings'].includes(k))) blocked('options accepts only operation and settings');
 if (!object(o.settings)) blocked('options.settings must be an object');
 const s=o.settings, op=o.operation, required=[];
 const need=(...fields)=>required.push(...fields);
 if (['all-links','public-discovery','firefox','performance'].includes(op)) {
  if (!Array.isArray(s.paths)||!s.paths.length||s.paths.some(p=>typeof p!=='string'||!p.trim())) blocked('settings.paths must be a nonempty array of paths');
 }
 if (!['all-links','public-discovery','server-validation','firefox','performance'].includes(op)) need('mainSelector');
 if (op.startsWith('search-')) {
  need('sitePath','search.openSelector','search.inputSelector','search.submitSelector','search.resultHeadingSelector');
  need(op==='search-product'?'search.term':op==='search-empty'?'search.emptyTerm':'search.specialTerm');
  need(op==='search-product'?'search.resultSelector':'search.emptyText');
 }
 if (op.startsWith('menu')) {
  need('sitePath','menu.buttonSelector','menu.panelSelector','menu.stateSelector','menu.stateAttribute','menu.openedValue','menu.closedValue','menu.linkSelector');
  if (op==='menu-navigation') need('menu.targetPath','menu.targetSelector');
 }
 if (['contact-validation','server-validation','network-failure','keyboard'].includes(op)) need('contact.path');
 if (['contact-validation','network-failure'].includes(op)) need('contact.emailField','contact.consentField','contact.submitSelector');
 if (['server-validation','network-failure'].includes(op)) need('contact.formId','contact.restPath','contact.nameField','contact.emailField','contact.messageField','contact.consentField','contact.formSelector');
 if (op==='network-failure') need('contact.responseSelector');
 if (op==='keyboard' && (!Array.isArray(s.contact?.keyboardSelectors)||s.contact.keyboardSelectors.length<3||s.contact.keyboardSelectors.some(v=>typeof v!=='string'||!v.trim()))) blocked('settings.contact.keyboardSelectors requires at least three selectors');
 if (cartOperation(op)) {
  need('commerce.productPath','commerce.cartPath','commerce.addSelector','commerce.customerSelector');
  if(op==='cart-limit') need('commerce.updateSelector','commerce.quantitySelector','commerce.limitQuantity','commerce.rejectionText','commerce.forbiddenTotalText');
  else need('commerce.nextSelector','commerce.requiredSelector','commerce.errorText','commerce.confirmSelector');
 }
 const missing=required.filter(key=>{const v=key.split('.').reduce((v,k)=>v?.[k],s);return !(typeof v==='string'||(['contact.formId','commerce.limitQuantity'].includes(key)&&typeof v==='number'))||!String(v).trim();});
 if(missing.length) blocked('missing settings: '+missing.join(', '));
 for(const group of ['search','menu','contact','commerce']) if(s[group]!==undefined&&!object(s[group])) blocked('settings.'+group+' must be an object');
 if(s.paths!==undefined&&!Array.isArray(s.paths)) blocked('settings.paths must be an array');
 if(op==='cart-limit'&&(!Number.isInteger(Number(s.commerce.limitQuantity))||Number(s.commerce.limitQuantity)<2)) blocked('settings.commerce.limitQuantity must be an integer of at least 2');
 for(const p of [s.sitePath,s.contact?.path,s.contact?.restPath,s.menu?.targetPath,s.commerce?.productPath,s.commerce?.cartPath,...(s.paths??[])].filter(configuredPath)) sameOrigin(p,config.baseURL);
 if(['server-validation','network-failure'].includes(op)) {
  const u=new URL(s.contact.restPath,config.baseURL);
  if(!/^\d+$/.test(String(s.contact.formId))||!u.pathname.endsWith(`/wp-json/contact-form-7/v1/contact-forms/${s.contact.formId}/feedback`)||u.search||u.hash) blocked('settings.contact.restPath must be the explicit CF7 feedback endpoint matching contact.formId');
 }
 if(cartOperation(op)||op==='server-validation') writesAllowed(config);
}

const cartSubmitters={add:/^(?:add|inCart(?:\[[^\]]+\])*)$/i,customer:/^(?:customerinfo|customer)$/i,delivery:/^(?:deliveryinfo|next)$/i};
const canonicalFields=entries=>JSON.stringify([...entries].map(([key,value])=>[key,String(value).replace(/\r?\n/g,'\r\n')]).sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1])));
// A one-use permit binds an ordinary form POST to the selected safe submitter
// and its exact successful controls, never to arbitrary background requests.
export function permitsCartRequest(req, settings, config, intent) {
 if(!['local','staging'].includes(config.environment)||config.allowTestWrites!==true||req.method()!=='POST'||req.redirectedFrom?.()) return false;
 if(req.url()!==new URL(settings.commerce.cartPath,config.baseURL).href) return false;
 if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers()['content-type']??'')) return false;
 if(!intent||intent.used||!cartSubmitters[intent.stage]?.test(intent.name)||!Array.isArray(intent.fields)) return false;
 const data=new URLSearchParams(req.postData()??'');
 if(data.getAll(intent.name).length!==1||data.get(intent.name)!==intent.value||canonicalFields(data)!==canonicalFields(intent.fields)) return false;
 for(const [key,value] of data) {
  // PHP may interpret even an empty purchase key as an action.
  if(/purchase|checkout/i.test(key)) return false;
  // Observed Welcart stock metadata, not an order command. Keep the exact
  // indexed name and boolean value, still bound to the captured form payload.
  if(/^itemOrderAcceptable\[\d+\]$/.test(key)&&/^[01]$/.test(value)) continue;
  if(/confirm|payment|order/i.test(key)&&(!['customer','delivery'].includes(intent.stage)||value!=='')) return false;
  if(Object.values(cartSubmitters).some(pattern=>pattern.test(key))&&key!==intent.name) return false;
 }
 return true;
}

export async function run({check,config,browser,requestFactory,attach=async()=>{},signal}) {
 let client,context,ownedBrowser,page,gateDetected=false,effectiveNavigation,operationFailed=false,cartIntent;
 const evidence={operation:check.options?.operation,stage:'configuration',steps:[],observations:[],network:{blockedWrites:0,feedbackAttempts:0,forwardedWrites:0},outcome:'failed'};
 try {
  validate(check,config);validateRuntime(check,config);
  const {operation:op,settings:s}=check.options, headers=envHeaders(config.headersEnv), timeout=config.timeoutMs??15000;
  evidence.stage='setup';
  const origin=new URL(config.baseURL).origin;
  const checkCancelled=()=>{if(signal?.aborted) blocked('cancelled');};
  const safePath=value=>new URL(value,config.baseURL).pathname;
  evidence.selectedScope=op;
  evidence.selectedPaths=(['all-links','public-discovery','firefox','performance'].includes(op)?s.paths:op.startsWith('search-')||op.startsWith('menu')?[s.sitePath]:cartOperation(op)?[s.commerce.productPath,s.commerce.cartPath]:[s.contact?.path]).filter(configuredPath).map(safePath);
  evidence.testedPaths=[];
  const recordPath=path=>{const value=safePath(path);if(!evidence.testedPaths.includes(value)) evidence.testedPaths.push(value);};
  const get=async (path,track=true)=>{
   checkCancelled();recordPath(path);if(track){evidence.stage='guarded HTTP GET';evidence.path=safePath(path);}
   const response=await fetchPage(client,path,config.baseURL,timeout,true);
   if(track) evidence.effectivePath=safePath(response.url);
   recordPath(response.url);
   if(load(response.body)(gateSelector).length) throw Object.assign(gateError(),{status:response.status,effectivePath:safePath(response.url)});
   return response;
  };
  if(['all-links','public-discovery','server-validation'].includes(op)) {
   client=await requestFactory.newContext({extraHTTPHeaders:headers});
   if(op==='server-validation') {
    const c=s.contact, r=await get(c.path);assert.equal(r.status,200,'contact HTTP status');
    const $=load(r.body),form={};assert.equal($(c.formSelector).length,1,'contact form must be unique');
    $(c.formSelector).find('input[type=hidden]').each((_,el)=>{const name=$(el).attr('name');if(name)form[name]=$(el).attr('value')??'';});
    assert.equal(form._wpcf7,String(c.formId),'CF7 form id');
    Object.assign(form,{[c.nameField]:'',[c.emailField]:'invalid-address',[c.messageField]:'',[c.consentField]:'1'});
    let response;
    try {
     checkCancelled();evidence.stage='CF7 invalid submission';response=await client.post(sameOrigin(c.restPath,config.baseURL),{multipart:form,maxRedirects:0,timeout});evidence.network.forwardedWrites++;
     const text=await response.text();if(load(text)(gateSelector).length) throw gateError();
     assert.equal(response.status(),200,'CF7 validation HTTP status');const body=JSON.parse(text);
     const fields=(body.invalid_fields??[]).map(f=>f.field);
     evidence.observations.push({status:body.status,invalidExpectedFields:[c.nameField,c.emailField,c.messageField].filter(f=>fields.includes(f))});
     assert.equal(body.status,'validation_failed');for(const field of [c.nameField,c.emailField,c.messageField]) assert(fields.includes(field),'CF7 must reject required field '+field);
    } finally {await response?.dispose();}
   } else if(op==='all-links') {
    evidence.scope='All configured source pages and their discovered same-origin links; three concurrent guarded GETs per phase';
    const links=new Set(),cache=new Map(),sources=[],results=[];
    const failure=error=>({status:error.status??null,...(error.effectivePath?{effectivePath:error.effectivePath}:{}),error:error.code==='SITE_GATE_EXPIRED'?'site gate expired':'guarded GET failed'});
    evidence.stage='all-links source scan';
    await pool3(s.paths,async(path,index)=>{
     const row={path:safePath(path),status:null};sources[index]=row;
     try {
      const r=await get(path,false);Object.assign(row,{status:r.status,effectivePath:safePath(r.url)});
      if(r.status!==200) row.error='source page HTTP error';
      else for(const link of internalLinks(r.body,r.url)) links.add(link);
     }catch(error){Object.assign(row,failure(error));}
     cache.set(sameOrigin(path,config.baseURL),row);
    },signal);
    evidence.stage='all-links destination scan';
    await pool3([...links],async(link,index)=>{
     const row={path:safePath(link),status:null};results[index]=row;
     if(cache.has(link)){Object.assign(row,cache.get(link),{cached:true});return;}
     try {const r=await get(link,false);Object.assign(row,{status:r.status,effectivePath:safePath(r.url)});if(r.status<200||r.status>=400) row.error='internal link HTTP error';}
     catch(error){Object.assign(row,failure(error));}
    },signal);
    const failures=[...sources.map(row=>({...row,phase:'source'})),...results.map(row=>({...row,phase:'destination'}))].filter(row=>row.error);
    evidence.observations.push(...sources,{linkCount:links.size,results});evidence.failures=failures;
    // Publish the complete scan before raising any verdict, including expired gates.
    await attach('all-internal-links',{scope:evidence.scope,selectedScope:op,selectedPaths:evidence.selectedPaths,testedPaths:evidence.testedPaths,concurrency:3,sources,results,failures});
    if(failures.length){evidence.path=failures[0].path;evidence.effectivePath=failures[0].effectivePath;}
    checkCancelled();
    const gate=failures.find(row=>row.error==='site gate expired');if(gate){evidence.path=gate.path;throw gateError();}
    assert.equal(failures.length,0,'source or internal link HTTP errors; see all-internal-links attachment');
    assert(links.size>0,'no internal links discovered');
   } else {
    evidence.scope='Public discovery on configured paths only; content specifications and feature applicability are not assessed';
    for(const path of s.paths) {
     const r=await get(path);evidence.observations.push({path:safePath(path),status:r.status});assert.equal(r.status,200,'source page HTTP status');
     const $=load(r.body);
     {
      const pathOnly=value=>{try{const u=new URL(value,r.url);return u.origin===origin?u.pathname:u.origin+u.pathname;}catch{return null;}};
      const metadata=value=>String(value??'').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]').replace(/https?:\/\/[^\s"<>]+/g,v=>pathOnly(v)??'[URL]').slice(0,1000);
      evidence.observations.at(-1).discovery={title:metadata($('title').text().trim()),description:metadata($('meta[name=description]').attr('content')),lang:$('html').attr('lang'),
       hreflang:$('link[hreflang]').map((_,el)=>({lang:$(el).attr('hreflang'),path:pathOnly($(el).attr('href'))})).get(),
       inputs:$('form.wpcf7-form input,form.wpcf7-form textarea').map((_,el)=>({name:$(el).attr('name'),type:$(el).attr('type'),maxlength:$(el).attr('maxlength'),required:$(el).attr('aria-required')??$(el).attr('required')})).get(),
       membershipLinks:$('a[href]').map((_,el)=>$(el).attr('href')).get().filter(v=>/member|login|register/i.test(v)).map(pathOnly),
       integrationScripts:$('script[src]').map((_,el)=>$(el).attr('src')).get().filter(v=>/gtm|googletagmanager|analytics|recaptcha|turnstile/i.test(v)).map(pathOnly),
       mainTextLength:$('main').text().trim().length,imagesWithoutAlt:$('main img:not([alt])').length};
     }
    }
   }
  } else {
   if(op==='firefox') {try{ownedBrowser=await firefox.launch();}catch{blocked('Firefox engine unavailable');}}
   context=await (ownedBrowser??browser).newContext({serviceWorkers:'block',viewport:{width:1280,height:900}});
   await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(signal?.aborted) return route.abort();
    if(req.method()!=='GET') {
     if(s.contact?.restPath && req.url()===new URL(s.contact.restPath,config.baseURL).href) evidence.network.feedbackAttempts++;
     if(!(cartOperation(op)&&req.isNavigationRequest()&&req.frame()===page?.mainFrame()&&permitsCartRequest(req,s,config,cartIntent))) {
      evidence.network.blockedWrites++;
      if(cartOperation(op)) (evidence.network.blockedCartStages??=[]).push(cartIntent?.stage??'no active cart step');
      return route.abort('failed');
     }
     cartIntent.used=true;(evidence.network.forwardedCartStages??=[]).push(cartIntent.stage);
     evidence.network.forwardedWrites++;
    }
    const requestHeaders=await req.allHeaders();
    const publicHeaders={...Object.fromEntries(Object.entries(requestHeaders).filter(([key])=>!['authorization','proxy-authorization','cookie',...Object.keys(headers).map(k=>k.toLowerCase())].includes(key.toLowerCase()))),cookie:''};
    if(u.origin!==origin) {
     if(req.isNavigationRequest()) return route.abort();
     return route.continue({headers:publicHeaders});
    }
    let response;
    try {
     // Firefox can follow a fulfilled redirect without routing the next hop.
     // Resolve redirects here, never handing a redirect response to the browser.
     let url=req.url(),method=req.method();const seen=new Set();
     for(let hop=0;hop<6;hop++) {
      if(seen.has(url)) throw Error('redirect loop');seen.add(url);
      // Re-read the jar for every hop: route.fetch applies Set-Cookie from the
      // preceding response before a manually resolved redirect is fetched.
      const hopHeaders=new URL(url).origin===origin?sessionHeaders(url===req.url()?requestHeaders:publicHeaders,headers,await context.cookies(url)):publicHeaders;
      response=await route.fetch({url,method,...(method==='GET'&&req.method()!=='GET'?{postData:''}:{}),headers:hopHeaders,maxRedirects:0,timeout});
      if(![301,302,303,307,308].includes(response.status())) {
       if(req.isNavigationRequest()&&page&&req.frame()===page.mainFrame()) {
        effectiveNavigation={requested:req.url(),url};
        evidence.path=safePath(req.url());evidence.effectivePath=safePath(url);
        recordPath(req.url());recordPath(url);
        (evidence.navigations??=[]).push({requestedPath:safePath(req.url()),effectivePath:safePath(url),status:response.status()});
        if(load(await response.text())(gateSelector).length) gateDetected=true;
       }
       await route.fulfill({response});return;
      }
      const location=response.headers().location;if(!location) throw Error('redirect missing Location');
      const nextURL=new URL(location,url);
      if(!['http:','https:'].includes(nextURL.protocol)||nextURL.username||nextURL.password) throw Error('unsafe redirect');
      const next=req.isNavigationRequest()?sameOrigin(nextURL.href,config.baseURL):nextURL.href;
      // Never replay a write at a redirected endpoint, even on the same origin.
      if(method!=='GET'&&[307,308].includes(response.status())) throw Error('write redirect denied');
      method='GET';url=next;await response.dispose();response=null;
     }
     throw Error('too many redirects');
    } catch {await route.abort().catch(()=>{});} finally {await response?.dispose().catch(()=>{});}
   });
   page=await context.newPage();page.setDefaultTimeout(timeout);
   const effectiveURL=()=>effectiveNavigation?.requested===page.url()?effectiveNavigation.url:page.url();
   const checkGate=async()=>{if(gateDetected||await page.locator(gateSelector).count()){gateDetected=true;throw gateError();}};
   const visible=selector=>expect(page.locator(selector).first()).toBeVisible({timeout});
   const go=async path=>{
    checkCancelled();evidence.path=safePath(path);evidence.stage='page navigation';
    const r=await page.goto(sameOrigin(path,config.baseURL),{waitUntil:'load'});await checkGate();assert(r?.ok(),'page HTTP error');sameOrigin(effectiveURL(),config.baseURL);await visible(s.mainSelector||'body');
    if(['contact-validation','network-failure'].includes(op)) {
     const setup={steps:s.scrollSteps??0,stepPx:s.scrollStepPx??450,animationWaitMs:120,completedSteps:0};evidence.setupScroll=setup;
     evidence.stage='contact setup scroll';
     for(let n=0;n<setup.steps;n++){checkCancelled();await page.mouse.wheel(0,setup.stepPx);await page.waitForTimeout(setup.animationWaitMs);setup.completedSteps++;}
     await checkGate();
    }
    evidence.stage=op+' assertions';
   };
   const field=name=>page.locator('[name='+JSON.stringify(name)+']');
   const cartClick=async(selector,stage)=>{
    const control=page.locator(selector);
    if(stage==='quantity') {
     // This check expects client-side rejection (e.g. upButton/upCart()).
     // Named submitters and unnamed buttons may click, but neither gets a POST permit.
     cartIntent=undefined;await control.click();return;
    }
    const form=await control.evaluate(button=>{
     const form=button.form;if(!form||!['submit'].includes(button.type)||!button.name) return null;
     const fields=[...new FormData(form,button)];if(fields.some(([,value])=>typeof value!=='string')) return null;
     return {action:button.hasAttribute('formaction')?button.formAction:form.action,method:button.getAttribute('formmethod')||form.method,enctype:button.getAttribute('formenctype')||form.enctype,name:button.name,value:button.value,fields};
    });
    if(!form||form.action!==sameOrigin(s.commerce.cartPath,config.baseURL)||form.method.toLowerCase()!=='post'||form.enctype!=='application/x-www-form-urlencoded'||!cartSubmitters[stage]?.test(form.name)) blocked('commerce '+stage+' requires an explicit safe cart form submitter');
    const intent={...form,stage,used:false};cartIntent=intent;
    try{
     await control.click();
     // A submit handler can finish asynchronous work before the actual POST.
     await expect.poll(()=>intent.used,{timeout}).toBe(true);
    }finally{cartIntent=undefined;}
   };
   if(op.startsWith('search-')) {
    await go(s.sitePath);const q=s.search,term=op==='search-product'?q.term:op==='search-empty'?q.emptyTerm:q.specialTerm;
    await page.locator(q.openSelector).click();await page.locator(q.inputSelector).fill(term);await page.locator(q.submitSelector).click();
    await checkGate();await expect.poll(()=>new URL(effectiveURL()).searchParams.get('s'),{timeout}).toBe(term);await visible(s.mainSelector);
    await expect(page.locator(q.resultHeadingSelector)).toContainText(term,{timeout});
    if(op==='search-product') await visible(q.resultSelector);else await expect(page.locator(s.mainSelector)).toContainText(q.emptyText,{timeout});
   } else if(op.startsWith('menu')) {
    const m=s.menu;await page.setViewportSize({width:390,height:844});await go(s.sitePath);
    await expect(page.locator(m.stateSelector)).toHaveAttribute(m.stateAttribute,m.closedValue,{timeout});await page.locator(m.buttonSelector).click();
    await expect(page.locator(m.stateSelector)).toHaveAttribute(m.stateAttribute,m.openedValue,{timeout});await visible(m.panelSelector);await expect(page.locator(m.linkSelector).first()).toBeInViewport({timeout});
    if(op==='menu-navigation') {
     await page.locator(m.linkSelector).first().click();await checkGate();
     const destination=value=>{const u=new URL(value,config.baseURL);return {origin:u.origin,path:u.pathname.replace(/\/$/,''),query:u.search};};
     await expect.poll(()=>destination(effectiveURL()),{timeout}).toEqual(destination(m.targetPath));
     await visible(s.mainSelector);await expect(page.locator(m.targetSelector)).toBeAttached({timeout});
    }
    else {await page.locator(m.buttonSelector).click();await expect(page.locator(m.stateSelector)).toHaveAttribute(m.stateAttribute,m.closedValue,{timeout});}
   } else if(['contact-validation','network-failure','keyboard'].includes(op)) {
    const c=s.contact;await go(c.path);
    if(op==='keyboard') {
     const selectors=c.keyboardSelectors;await page.locator(selectors[0]).click();
     for(const selector of selectors.slice(1)) {await page.keyboard.press('Tab');await expect(page.locator(selector)).toBeFocused({timeout});}
     await page.keyboard.press('Shift+Tab');await expect(page.locator(selectors.at(-2))).toBeFocused({timeout});
    } else if(op==='contact-validation') {
     const submit=page.locator(c.submitSelector);await expect(submit).toBeDisabled({timeout});await field(c.consentField).check();await expect(submit).toBeEnabled({timeout});await field(c.consentField).uncheck();await expect(submit).toBeDisabled({timeout});await field(c.emailField).fill('not-an-email');assert(await field(c.emailField).evaluate(e=>e.validity.typeMismatch),'invalid email must be rejected');
    } else {
     await field(c.nameField).fill('QA blocked network test');await field(c.emailField).fill('qa@example.invalid');await field(c.messageField).fill('QA blocked network test');await field(c.consentField).check();await page.locator(c.submitSelector).click();
     await expect.poll(()=>evidence.network.feedbackAttempts,{timeout}).toBeGreaterThan(0);
     const form=page.locator(c.formSelector);await expect(form).not.toHaveAttribute('data-status','submitting',{timeout});
     assert.notEqual(await form.getAttribute('data-status'),'sent');assert(!/thankspage/i.test(effectiveURL()),'unexpected success navigation');await expect(page.locator(c.submitSelector)).toBeEnabled({timeout});
     assert.equal(evidence.network.forwardedWrites,0);evidence.observations.push({formStatus:await form.getAttribute('data-status'),responsePresent:!!(await page.locator(c.responseSelector).textContent())});
    }
   } else if(cartOperation(op)) {
    const c=s.commerce;await go(c.productPath);await cartClick(c.addSelector,'add');await visible(c.customerSelector);
    if(op==='cart-limit') {
     let rejected=false;page.on('dialog',async d=>{rejected ||= d.message().includes(c.rejectionText);await d.accept();});
     await page.locator(c.quantitySelector).fill(String(c.limitQuantity));await cartClick(c.updateSelector,'quantity');await expect.poll(()=>rejected,{timeout}).toBe(true);await expect(page.locator('body')).not.toContainText(c.forbiddenTotalText,{timeout});
    } else {
     await cartClick(c.customerSelector,'customer');await cartClick(c.nextSelector,'delivery');await visible(c.requiredSelector);await expect(page.locator('body')).toContainText(c.errorText,{timeout});await expect(page.locator(c.confirmSelector)).toHaveCount(0,{timeout});
    }
   } else {
    for(const path of s.paths) {await go(path);
     if(op==='firefox') {assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');evidence.observations.push({noOverflow:true});}
     else {await page.waitForFunction(()=>performance.getEntriesByType('navigation')[0]?.loadEventEnd>0);evidence.observations.push(await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return {durationMs:n.duration,domContentLoadedMs:n.domContentLoadedEventEnd,resourceCount:performance.getEntriesByType('resource').length};}));}
    }
    evidence.scope=op==='performance'?'Single routed load per path; reference measurements only, no performance budget or CWV verdict':'Desktop Firefox representative layout only';
   }
  }
  if(gateDetected) throw gateError();
  evidence.steps.push('operation assertions completed');evidence.stage='complete';evidence.outcome='passed';return evidence;
 } catch(error) {
  operationFailed=true;
  if(gateDetected) error=gateError();
  // Avoid Playwright call logs, actual DOM text and response bodies in evidence.
  evidence.failure={type:error?.name==='AssertionError'||error?.matcherResult?'assertion':String(error?.message??'').startsWith('BLOCKED:')?'blocked':'runtime',reason:`${evidence.operation??'site-interaction'} failed during ${evidence.stage}`};
  if(error.code==='SITE_GATE_EXPIRED') evidence.failure.reason='site gate expired; refresh site-gate credentials';
  if(/^[a-zA-Z]+$/.test(error?.matcherResult?.name??'')) evidence.failure.assertion=error.matcherResult.name;
  throw error;
 } finally {
  if(evidence.outcome!=='passed'&&page) {
   try {
    if(!page.isClosed()){await attach('site-interaction-failure-screen',{body:await page.screenshot({fullPage:true,timeout:3000,mask:[page.locator('input,textarea,select,[contenteditable],.wpcf7-response-output')]}),contentType:'image/png'});evidence.screenshot='attached';}
   }catch{evidence.screenshot='unavailable';}
  }
  let cleanupFailed=false,firstCleanupError;
  const cleanup=async(stage,action)=>{
   try{await action();}catch(error){
    if(!cleanupFailed) firstCleanupError=error;cleanupFailed=true;
    // Cleanup diagnostics must not contain raw transport errors or credentials.
    (evidence.cleanupErrors??=[]).push({stage,reason:'cleanup unavailable or resource already closed'});
   }
  };
  // Attempt every resource independently, even if the browser crashed or a
  // previous cleanup failed. Keep guards installed until pages stop running.
  if(context){
   await cleanup('pages',async()=>{await Promise.all(context.pages().map(p=>cleanup('page-close',()=>p.close())));});
   await cleanup('unroute',()=>context.unrouteAll({behavior:'ignoreErrors'}));
   await cleanup('context-close',()=>context.close());
  }
  if(ownedBrowser) await cleanup('browser-close',()=>ownedBrowser.close());
  if(client) await cleanup('request-dispose',()=>client.dispose());
  if(cleanupFailed&&!operationFailed){evidence.outcome='failed';evidence.failure={type:'cleanup',reason:'operation assertions completed but resource cleanup failed'};}
  // Attach after cleanup so its diagnostics accompany the original failure.
  await cleanup('evidence-attachment',()=>attach('site-interaction-evidence',evidence));
  if(cleanupFailed&&!operationFailed) throw firstCleanupError;
 }
}
