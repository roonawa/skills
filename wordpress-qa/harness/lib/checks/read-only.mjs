import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { sameOrigin } from '../config.mjs';
import { fetchPage } from '../audit.mjs';

export const kinds = ['redirect','seo-page','seo-robots','seo-sitemap','performance-navigation','compatibility-screen','keyboard-sequence'];
const schema = {
  redirect:['path','status','location'], 'seo-page':['path','canonical','meta','jsonLd'],
  'seo-robots':['path','rules'], 'seo-sitemap':['path','requiredUrls','excludedUrls'],
  'performance-navigation':['path','samples','cache','budgets'],
  'compatibility-screen':['path','engine','viewport','visible','text','noOverflow'],
  'keyboard-sequence':['path','steps']
};
function obj(v, keys) { assert(v && typeof v==='object' && !Array.isArray(v),'object required'); for(const k of Object.keys(v)) assert(keys.includes(k),`unknown option ${k}`); }
function str(v) { assert(typeof v==='string' && v.trim(),'nonempty string required'); }
function arr(v, fn, nonempty=true) { assert(Array.isArray(v) && (!nonempty || v.length),'array required'); v.forEach(fn); }
function number(v,min,max) { assert(Number.isFinite(v) && v>=min && v<=max,'number out of range'); }
function absolute(v) { str(v); const u=new URL(v); assert(['http:','https:'].includes(u.protocol) && !u.username && !u.password,'HTTP URL required'); }
export function validate(check,config) {
  assert(kinds.includes(check.kind),'unsupported kind'); const o=check.options;
  obj(o,schema[check.kind]); str(o.path); sameOrigin(o.path,config.baseURL);
  const suite=check.kind.startsWith('seo-') || check.kind==='redirect' ? 'seo' : check.kind==='performance-navigation' ? 'performance' : check.kind==='compatibility-screen' ? 'compatibility':'accessibility';
  assert.equal(check.suite,suite,'kind/suite mismatch');
  if(check.kind==='redirect') { assert([301,302,303,307,308].includes(o.status)); str(o.location); absolute(new URL(o.location,config.baseURL).href); }
  if(check.kind==='seo-page') {
    assert(o.canonical || o.meta || o.jsonLd,'SEO expectations required');
    if(o.canonical!==undefined) absolute(o.canonical);
    if(o.meta!==undefined) { obj(o.meta,Object.keys(o.meta)); assert(Object.keys(o.meta).length); Object.entries(o.meta).forEach(([k,v])=>{str(k);str(v);}); }
    if(o.jsonLd!==undefined) arr(o.jsonLd,x=>{obj(x,['type','properties']);str(x.type);if(x.properties!==undefined){obj(x.properties,Object.keys(x.properties));assert(Object.keys(x.properties).length);}});
  }
  if(check.kind==='seo-robots') arr(o.rules,x=>{obj(x,['userAgent','directive','value']);str(x.userAgent);assert(['allow','disallow'].includes(x.directive));assert.equal(typeof x.value,'string');});
  if(check.kind==='seo-sitemap') {arr(o.requiredUrls,absolute,false);arr(o.excludedUrls,absolute,false);assert(o.requiredUrls.length+o.excludedUrls.length);assert(!o.requiredUrls.some(x=>o.excludedUrls.includes(x)));}
  if(check.kind==='performance-navigation') {number(o.samples,1,15);assert(Number.isInteger(o.samples));assert(['cold','warm'].includes(o.cache));obj(o.budgets,['durationMs','resourceCount','transferBytes']);assert(Object.keys(o.budgets).length);Object.values(o.budgets).forEach(v=>number(v,0,1e12));}
  if(check.kind==='compatibility-screen') {assert(['chromium','firefox','webkit'].includes(o.engine));obj(o.viewport,['width','height']);for(const v of Object.values(o.viewport)){number(v,100,8000);assert(Number.isInteger(v));}assert(o.viewport.width && o.viewport.height);if(o.visible!==undefined)arr(o.visible,str);if(o.text!==undefined)arr(o.text,x=>{obj(x,['selector','value']);str(x.selector);str(x.value);});assert(o.visible?.length || o.text?.length,'meaningful content expectation required');if(o.noOverflow!==undefined)assert.equal(typeof o.noOverflow,'boolean');}
  if(check.kind==='keyboard-sequence') arr(o.steps,x=>{obj(x,['key','focus','visible']);assert(['Tab','Shift+Tab','Enter','Escape','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(x.key));assert(x.focus || x.visible,'keyboard expectation required');if(x.focus)str(x.focus);if(x.visible)str(x.visible);});
  return check;
}
export function inspect(check,response) {
  const o=check.options, $=load(response.body); const actual={status:response.status};
  if(check.kind==='redirect') {assert.equal(response.status,o.status);assert(response.headers.location,'Location missing');actual.location=new URL(response.headers.location,response.url).href;assert.equal(actual.location,new URL(o.location,response.url).href);return actual;}
  assert.equal(response.status,200);
  if(check.kind==='seo-page') {
    if(o.canonical){const links=$('link[rel="canonical" i]');assert.equal(links.length,1,'one canonical required');assert(links.attr('href'),'canonical href missing');actual.canonical=new URL(links.attr('href'),response.url).href;assert.equal(actual.canonical,o.canonical);}
    actual.meta={};for(const [key,value] of Object.entries(o.meta??{})){const nodes=$('meta').filter((_,el)=>$(el).attr('property')===key || $(el).attr('name')===key);assert.equal(nodes.length,1,`one ${key} required`);actual.meta[key]=nodes.attr('content');assert.equal(actual.meta[key],value,`meta ${key}`);}
    const docs=[];function collect(v){if(Array.isArray(v))v.forEach(collect);else if(v && typeof v==='object'){docs.push(v);if(v['@graph'])collect(v['@graph']);}}
    if(o.jsonLd){$('script[type="application/ld+json"]').each((_,el)=>collect(JSON.parse($(el).text())));actual.jsonLd=o.jsonLd.map(e=>{const matches=docs.filter(d=>[d['@type']].flat().includes(e.type));assert(matches.some(d=>Object.entries(e.properties??{}).every(([k,v])=>{try{assert.deepEqual(d[k],v);return true;}catch{return false;}})),`JSON-LD ${e.type} properties differ`);return {type:e.type,matched:true};});}
  }
  if(check.kind==='seo-sitemap'){const xml=load(response.body,{xmlMode:true});assert(xml('urlset').length===1,'urlset sitemap required (index needs explicit child checks)');actual.urls=xml('urlset > url > loc').map((_,el)=>xml(el).text().trim()).get();o.requiredUrls.forEach(u=>assert(actual.urls.includes(u),`sitemap missing ${u}`));o.excludedUrls.forEach(u=>assert(!actual.urls.includes(u),`sitemap unexpectedly lists ${u}`));}
  if(check.kind==='seo-robots'){let agents=[],hasRules=false;actual.rules=[];for(const line of response.body.split(/\r?\n/)){const clean=line.split('#')[0].trim();const match=/^([^:]+):\s*(.*)$/.exec(clean);if(!match)continue;const key=match[1].trim().toLowerCase(),value=match[2].trim();if(key==='user-agent'){if(hasRules){agents=[];hasRules=false;}agents.push(value.toLowerCase());}else if(['allow','disallow'].includes(key)){hasRules=true;agents.forEach(userAgent=>actual.rules.push({userAgent,directive:key,value}));}}for(const r of o.rules)assert(actual.rules.some(a=>a.userAgent===r.userAgent.toLowerCase()&&a.directive===r.directive&&a.value===r.value),`robots rule missing: ${JSON.stringify(r)}`);}
  return actual;
}
const median = values => {const a=[...values].sort((a,b)=>a-b);const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
export async function run({check,config,requestFactory,browser,attach}) {
  validate(check,config);const o=check.options,url=sameOrigin(o.path,config.baseURL);
  if(check.suite==='seo') {if(!requestFactory)throw new Error('BLOCKED: request factory unavailable');const request=await requestFactory.newContext();try{return {expectations:o,actual:inspect(check,await fetchPage(request,url,config.baseURL,config.timeoutMs??15000,false))};}finally{await request.dispose();}}
  let ownBrowser=false, context;
  if(check.kind==='compatibility-screen'){try{const pw=await import('@playwright/test');browser=await pw[o.engine].launch();ownBrowser=true;}catch{throw new Error(`BLOCKED: ${o.engine} browser unavailable; install its Playwright engine`);}}
  if(!browser)throw new Error('BLOCKED: browser unavailable');
  try {
    const create=async()=>{context=await browser.newContext({viewport:o.viewport??{width:1280,height:800},serviceWorkers:'block'});const page=await context.newPage();page.setDefaultTimeout(config.timeoutMs??15000);return page;};
    let page=await create();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let navigationViolation;
    // Routing disables HTTP cache, so apply the guard only to non-measurement checks.
    if(check.kind!=='performance-navigation')await context.route('**/*',async route=>{
      if(!route.request().isNavigationRequest())return route.continue();
      try {
        sameOrigin(route.request().url(),config.baseURL);
        const response=await route.fetch({maxRedirects:0});
        const location=response.headers().location;
        if(response.status()>=300&&response.status()<400&&location)sameOrigin(new URL(location,route.request().url()).href,config.baseURL);
        await route.fulfill({response});
      } catch(error) {navigationViolation=`Navigation must have same origin: ${error.message}`;await route.abort();}
    });
    if(check.kind==='performance-navigation') {
      const samples=[];if(o.cache==='warm')await page.goto(url,{waitUntil:'load'});
      for(let i=0;i<o.samples;i++){if(i && o.cache==='cold'){await context.close();page=await create();}const response=await page.goto(url,{waitUntil:'load'});assert(response?.ok(),'performance navigation failed');sameOrigin(page.url(),config.baseURL);await page.waitForFunction(()=>performance.getEntriesByType('navigation')[0]?.loadEventEnd>0);const sample=await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0],r=performance.getEntriesByType('resource');return {durationMs:n.duration,resourceCount:r.length,transferBytes:n.transferSize+r.reduce((s,v)=>s+v.transferSize,0),opaqueResourceCount:r.filter(v=>new URL(v.name).origin!==location.origin && v.responseStart===0).length};});if(o.budgets.transferBytes!==undefined && sample.opaqueResourceCount)throw new Error('BLOCKED: cross-origin resource timing hides transfer sizes; configure Timing-Allow-Origin to assess byte budget');samples.push(sample);}
      const medians=Object.fromEntries(['durationMs','resourceCount','transferBytes'].map(k=>[k,median(samples.map(s=>s[k]))]));for(const [k,max] of Object.entries(o.budgets))assert(medians[k]<=max,`${k} median ${medians[k]} exceeds ${max}`);return {expectations:o,actual:{samples,medians,scope:'load event; browser-reported transfer sizes (cross-origin sizes may be hidden); Navigation Timing, not Lighthouse or field CWV'}};
    }
    let response;try{response=await page.goto(url,{waitUntil:'load'});}catch(error){assert(!navigationViolation,navigationViolation);throw error;}assert(!navigationViolation,navigationViolation);sameOrigin(page.url(),config.baseURL);assert(response && response.ok(),'page navigation failed');
    if(check.kind==='keyboard-sequence'){for(const step of o.steps){await page.keyboard.press(step.key);assert(!navigationViolation,navigationViolation);sameOrigin(page.url(),config.baseURL);if(step.focus)assert(await page.locator(step.focus).evaluate(el=>el===document.activeElement),`focus differs: ${step.focus}`);if(step.visible)assert(await page.locator(step.visible).isVisible(),`not visible: ${step.visible}`);}assert(!navigationViolation,navigationViolation);sameOrigin(page.url(),config.baseURL);}
    else {for(const s of o.visible??[])assert(await page.locator(s).isVisible(),`not visible: ${s}`);for(const t of o.text??[])assert.equal((await page.locator(t.selector).innerText()).trim(),t.value);if(o.noOverflow??true)assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');}
    assert(!navigationViolation,navigationViolation);sameOrigin(page.url(),config.baseURL);assert.deepEqual(errors,[],'uncaught JavaScript errors');if(attach)await attach(`${check.id}.png`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
    return {expectations:o,actual:{url:page.url(),steps:o.steps?.length,engine:o.engine,jsErrors:errors,verified:true}};
  } finally {await context?.close();if(ownBrowser)await browser.close();}
}
