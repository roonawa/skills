import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectHTML,checkPolicy,fetchPage,internalLinks } from '../lib/audit.mjs';
import { waitForMail,envHeaders } from '../lib/mailpit.mjs';
import { scopedHeaders } from '../lib/headers.mjs';
import {checkCancellation} from '../lib/cancellation.mjs';
import {captureMarkedScreenshots} from '../lib/marked-screenshots.mjs';

const ctx=JSON.parse(fs.readFileSync(process.env.WPQA_CONTEXT,'utf8'));
const c=ctx.config;
const test=base.extend({page:async({context},use)=>{
  const configured=ctx.operation?.handlesAuthentication?{}:envHeaders(c.headersEnv);
  if(Object.keys(configured).length) await context.route('**/*',async route=>{
    const req=route.request(),headers=scopedHeaders(req.headers(),configured,req.url(),c.baseURL);
    if(new URL(req.url()).origin!==c.baseURL) return route.continue({headers});
    // Do not let custom authentication headers follow a cross-origin redirect.
    const response=await route.fetch({headers,maxRedirects:0,timeout:c.timeoutMs});
    const location=response.headers().location;
    if(location && new URL(location,req.url()).origin!==c.baseURL) {await response.dispose();return route.abort('blockedbyclient');}
    await route.fulfill({response});await response.dispose();
  });
  const page=await context.newPage();await use(page);await page.close();
}});
const enabled=id=>ctx.report.rows.some(r=>r.id===id&&r.selected);
test.beforeEach(()=>checkCancellation(ctx.runDir));
const title=id=>`${id} | ${ctx.report.rows.find(r=>r.id===id).title}`;
async function evidence(info,name,data) {
  const file=info.outputPath(`${name}.json`);fs.writeFileSync(file,JSON.stringify(data,null,2));
  await info.attach(name,{path:file,contentType:'application/json'});
}
for(const p of c.pages) {
  if(enabled(`page.${p.id}`)) test(title(`page.${p.id}`),async({request},info)=>{
    const res=await fetchPage(request,p.path,c.baseURL,c.timeoutMs);
    const errors=inspectHTML(res.body,res.headers,p,res.url);
    if(res.status!==200) errors.unshift(`HTTP ${res.status} != 200`);
    if(!res.headers['content-type']?.includes('text/html')) errors.unshift('Expected text/html');
    await evidence(info,'audit',{url:res.url,status:res.status,expected:p,errors});expect(errors).toEqual([]);
  });
  if(enabled(`links.${p.id}`)) test(title(`links.${p.id}`),async({request},info)=>{
    const res=await fetchPage(request,p.path,c.baseURL,c.timeoutMs);expect(res.status).toBe(200);
    const results=[];
    for(const link of internalLinks(res.body,res.url)) {
      const target=await fetchPage(request,link,c.baseURL,c.timeoutMs);results.push({url:link,status:target.status});
    }
    await evidence(info,'links',results);expect(results.filter(r=>r.status<200||r.status>=400)).toEqual([]);
  });
}
for(const p of c.policies) if(enabled(`policy.${p.id}`)) test(title(`policy.${p.id}`),async({request},info)=>{
  const res=await fetchPage(request,p.path,c.baseURL,c.timeoutMs,false);
  const errors=checkPolicy(res,p,c.baseURL);
  await evidence(info,'policy',{path:p.path,status:res.status,errors});expect(errors).toEqual([]);
});
for(const j of c.journeys) if(enabled(`journey.${j.id}`)) test(title(`journey.${j.id}`),async({page,request},info)=>{
  const module=await import(pathToFileURL(path.resolve(ctx.configDir,j.module)).href);
  if(typeof module.run!=='function') throw new Error('BLOCKED: journey module must export run');
  const token=`qa-${ctx.report.runId}-${j.id}`;
  const args={page,request,expect,config:c,token,testInfo:info,
    checkCancellation:()=>checkCancellation(ctx.runDir),
    mail:expected=>waitForMail(c.mailpit,{timeoutMs:c.timeoutMs,...expected,token}),
    attach:(name,data)=>evidence(info,name,data)};
  try { if(module.setup) await module.setup(args); await module.run(args); }
  finally { if(module.cleanup) await module.cleanup(args); }
});

async function ready(page,v,info) {
  const jsErrors=[];page.on('pageerror',e=>jsErrors.push({message:e.message,stack:e.stack}));
  const p=c.pages.find(p=>p.id===v.pageId);
  await page.setViewportSize({width:v.width,height:v.height});
  const response=await page.goto(p.path);expect(response?.status()).toBe(200);
  await expect(page.locator(v.ready)).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  // Trigger lazy images, then restore the viewport before comparing.
  for(const img of await page.locator('img').all()) {
    if(await img.isVisible()) {await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);}
  }
  await page.evaluate(()=>window.scrollTo(0,0));
  const fontErrors=await page.evaluate(()=>[...document.fonts].filter(f=>f.status==='error').map(f=>f.family));
  await evidence(info,'readiness',{jsErrors,fontErrors});expect(fontErrors).toEqual([]);
  return jsErrors;
}
for(const v of c.visuals) {
  if(enabled(`javascript.${v.id}`)) test(title(`javascript.${v.id}`),async({page},info)=>{
    const jsErrors=await ready(page,v,info);
    await evidence(info,'javascript',{observation:'Navigation, readiness and visible-image scrolling; not a full interaction journey',jsErrors});
    expect(jsErrors).toEqual([]);
  });
  if(enabled(`layout.${v.id}`)) test(title(`layout.${v.id}`),async({page},info)=>{
    await ready(page,v,info);
    const width=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:window.innerWidth}));
    await evidence(info,'layout',width);expect(width.content).toBeLessThanOrEqual(width.viewport+1);
  });
  if(enabled(`axe.${v.id}`)) test(title(`axe.${v.id}`),async({page},info)=>{
    await ready(page,v,info);const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    await evidence(info,'axe',result);
    if(result.violations.length){
      const shots=await captureMarkedScreenshots(page,result.violations,async(name,body)=>{
        const file=info.outputPath(`${name}.png`);fs.writeFileSync(file,body);
        await info.attach(name,{path:file,contentType:'image/png'});
      });
      await evidence(info,'marked-screenshots',{shots});
    }
    expect(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  });
  if(enabled(`snapshot.${v.id}`)) test(title(`snapshot.${v.id}`),async({page,browser},info)=>{
    await ready(page,v,info);
    const id=`snapshot.${v.id}`;
    const fingerprint=createHash('sha256').update(JSON.stringify({platform:process.platform,browser:browser.version(),visual:v,path:c.pages.find(p=>p.id===v.pageId).path})).digest('hex');
    const baseline=info.snapshotPath(`${id}.png`), metaFile=path.join(ctx.baselineDir,`${id}.json`);
    const masks=v.mask.map(s=>page.locator(s));
    for(const mask of masks) await expect(mask.first()).toBeVisible();
    const candidate=path.join(ctx.runDir,'candidates',`${id}.png`);fs.mkdirSync(path.dirname(candidate),{recursive:true});
    await page.screenshot({path:candidate,fullPage:true,animations:'disabled',mask:masks});
    fs.writeFileSync(path.join(ctx.runDir,'candidates',`${id}.json`),JSON.stringify({id,fingerprint,configHash:ctx.configHash,browser:browser.version(),platform:process.platform,visual:v},null,2));
    await info.attach('baseline-candidate',{path:candidate,contentType:'image/png'});
    if(!fs.existsSync(baseline)||!fs.existsSync(metaFile)||JSON.parse(fs.readFileSync(metaFile,'utf8')).fingerprint!==fingerprint) {
      info.annotations.push({type:'qa-review',description:'基準画像が未承認、または実行環境が変更。候補画像をレビューしてください。'});test.skip();
    }
    await expect(page).toHaveScreenshot(`${id}.png`,{fullPage:true,animations:'disabled',mask:masks,maxDiffPixels:v.maxDiffPixels});
  });
}
