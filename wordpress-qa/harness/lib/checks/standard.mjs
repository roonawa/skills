import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {sameOrigin} from '../config.mjs';
import {fetchPage} from '../audit.mjs';
import {envHeaders} from '../mailpit.mjs';

export const kinds=['standard-public'];
const areas={metadata:'seo',navigation:'delivery',forms:'delivery',keyboard:'accessibility',integrations:'delivery',multilingual:'multilingual',performance:'performance',crawl:'seo'};
export function validate(check,config){
 const o=check.options;assert.equal(check.suite,areas[o.area]);assert(Object.keys(o).every(k=>['area','paths'].includes(k)));assert(Array.isArray(o.paths)&&o.paths.length>0&&o.paths.length<=5);for(const p of o.paths)sameOrigin(p,config.baseURL);
}
export function inspectDocument(area,html,url){
 const $=load(html),errors=[],actual={};
 if(area==='metadata'){
  if(!$('title').text().trim())errors.push('title is empty');if(!$('html').attr('lang'))errors.push('html lang is missing');
  actual.descriptionCount=$('meta[name="description" i]').length;if(actual.descriptionCount>1)errors.push('duplicate meta description');
  actual.ogProperties=$('meta[property^="og:"]').map((_,e)=>$(e).attr('property')).get();actual.jsonLdCount=$('script[type="application/ld+json"]').length;
  $('script[type="application/ld+json"]').each((i,e)=>{try{const v=JSON.parse($(e).text());if(!v||typeof v!=='object')throw Error();}catch{errors.push(`JSON-LD ${i+1} is invalid`);}});
  actual.scope='title/lang presence, duplicate description, JSON-LD syntax; content and missing optional SEO tags need editorial expectations';
 }
 if(area==='navigation'){
  const targets=new Set($('[id],a[name]').map((_,e)=>$(e).attr('id')||$(e).attr('name')).get());let count=0;
  $('a[href]').each((_,e)=>{try{const v=new URL($(e).attr('href'),url);if(v.origin===new URL(url).origin&&v.pathname===new URL(url).pathname&&v.search===new URL(url).search&&v.hash&&v.hash!=='#'&&!v.hash.startsWith('#:~:')){count++;if(!targets.has(decodeURIComponent(v.hash.slice(1))))errors.push('fragment target missing: '+v.hash.slice(0,120));}}catch{errors.push('invalid link URL or fragment');}});
  actual.fragmentLinks=count;actual.scope='same-page fragment targets; destination content, search and menu behavior need separate journeys';
 }
 if(area==='integrations'){
  const scripts=$('script[src]').map((_,e)=>$(e).attr('src')).get();actual.detected={analytics:scripts.some(s=>/googletagmanager|google-analytics/.test(s)),recaptcha:scripts.some(s=>/recaptcha/.test(s))};actual.inlineScriptCount=$('script:not([src])').length;
  for(const s of scripts)if(new URL(url).protocol==='https:'&&/^http:/.test(s))errors.push('insecure script URL');
  actual.scope='tag discovery and mixed-content script URLs only; event delivery, consent and bot discrimination are not asserted';
 }
 if(area==='multilingual'){
  const languages=[];$('link[rel="alternate"][hreflang]').each((_,e)=>{const lang=$(e).attr('hreflang'),href=$(e).attr('href');languages.push(lang);if(!/^(?:x-default|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/i.test(lang))errors.push('invalid hreflang');try{const u=new URL(href,url);if(!href||!['https:','http:'].includes(u.protocol))throw Error();}catch{errors.push('invalid alternate URL');}});
  if(new Set(languages.map(l=>l.toLowerCase())).size!==languages.length)errors.push('duplicate hreflang');actual.languages=languages;actual.scope='declared hreflang syntax/duplicates only; absence is not proof that the site is monolingual; translation and switching require review';
 }
 return {errors,actual};
}
export async function run({check,config,browser,requestFactory,attach=async()=>{},signal}){
 validate(check,config);const {area,paths}=check.options,results=[],errors=[];
 const headers=envHeaders(config.headersEnv);
 const client=await requestFactory.newContext({extraHTTPHeaders:headers});let context;
 try{
  for(const pathname of paths){
   if(signal?.aborted)throw Error('BLOCKED: cancelled');
   const url=sameOrigin(pathname,config.baseURL);
   if(['metadata','navigation','integrations','multilingual'].includes(area)){
    const response=await fetchPage(client,url,config.baseURL,config.timeoutMs??15000,true);assert.equal(response.status,200,'public page HTTP error');
    const r=inspectDocument(area,response.body,response.url||url);results.push({path:pathname,...r.actual});errors.push(...r.errors.map(e=>pathname+': '+e));continue;
   }
   if(area==='crawl'){
    const missing=new URL('./__wpqa_missing_'+Date.now()+'__',url).href;
    const response=await fetchPage(client,missing,config.baseURL,config.timeoutMs??15000,true);results.push({path:pathname,missingStatus:response.status});if(response.status!==404)errors.push('unknown URL must return 404');continue;
   }
   context=await browser.newContext({serviceWorkers:'block'});
   // Never submit a form or send credentials to external resources.
   await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());if(req.method()!=='GET'||(req.isNavigationRequest()&&u.origin!==new URL(config.baseURL).origin))return route.abort();
    if(u.origin===new URL(config.baseURL).origin){
     // Fetch one hop so public-gate headers are never inherited by an off-site redirect.
     let response;try{response=await route.fetch({headers:{...req.headers(),...headers},maxRedirects:0});await route.fulfill({response});}catch{await route.abort();}finally{await response?.dispose();}return;
    }return route.continue();
   });
   const page=await context.newPage();page.setDefaultTimeout(config.timeoutMs??15000);
   const response=await page.goto(url,{waitUntil:'load'});assert(response?.ok(),'public page navigation failed');sameOrigin(page.url(),config.baseURL);
   if(area==='forms'){
    const r=await page.evaluate(()=>{
     const controls=[...document.querySelectorAll('form input,form textarea,form select')].filter(e=>e.getClientRects().length&&!e.disabled&&e.type!=='hidden');const failures=[];let required=0,email=0;
     for(const el of controls){if(['submit','button','reset','file','radio','checkbox'].includes(el.type))continue;const value=el.value;
      if(el.required){required++;el.value='';if(el.validity.valid)failures.push('required field accepts empty value');}
      if(el.type==='email'){email++;el.value='invalid-email';if(el.validity.valid)failures.push('email field accepts malformed value');}el.value=value;
     }
     return {forms:document.forms.length,controls:controls.length,required,email,failures};
    });results.push({path:pathname,...r,scope:'declared native required/email constraints only; no submission, server-side validation or custom JS validation'});errors.push(...r.failures.map(e=>pathname+': '+e));
   }
   if(area==='keyboard'){
    const visited=[];for(let n=0;n<20;n++){await page.keyboard.press('Tab');const item=await page.evaluate(()=>{const e=document.activeElement;return {tag:e?.tagName,visible:!!e?.getClientRects().length,body:e===document.body};});if(!item.body&&!item.visible)errors.push(pathname+': keyboard focus is invisible');if(!item.body)visited.push(item.tag);}
    results.push({path:pathname,focusSteps:visited.length,scope:'first 20 Tab steps; no activation, reading order or screen-reader usability judgment'});
   }
   if(area==='performance'){
    const samples=[];for(let n=0;n<3;n++){if(n)await page.reload({waitUntil:'load'});samples.push(await page.evaluate(()=>{const e=performance.getEntriesByType('navigation')[0];return {durationMs:e.duration,domContentLoadedMs:e.domContentLoadedEventEnd,resources:performance.getEntriesByType('resource').length};}));}
    results.push({path:pathname,samples,scope:'reference measurements, first load and two reloads; no performance budget or field CWV judgment'});
   }
   await context.close();context=null;
  }
  const evidence={area,representativePaths:paths,results,errors};await attach('standard-public-evidence',evidence);assert.equal(errors.length,0,errors.join('\n'));return evidence;
 }finally{await context?.close();await client.dispose();}
}
