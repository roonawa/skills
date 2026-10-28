import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {load} from 'cheerio';
import {envHeaders} from '../mailpit.mjs';

export const kinds=['discovered-public'];
const areas=['navigation','contact-errors','contact-retry','crawl'];
const blocked=message=>{throw new Error('BLOCKED: '+message);};
const str=value=>assert(typeof value==='string' && value.trim(),'nonempty string required');
function obj(value,keys){assert(value && typeof value==='object' && !Array.isArray(value),'object required');for(const key of Object.keys(value))assert(keys.includes(key),`unknown option ${key}`);}
function publicURL(value,config,{query=false,root}={}){
  str(value);
  assert(!/\\|%(?:2e|2f|5c)/i.test(value),'ambiguous public URL');
  const u=new URL(value,config.baseURL),base=new URL(config.baseURL);
  assert(/^https?:$/.test(u.protocol)&&u.origin===base.origin&&!u.username&&!u.password,'public URL must have same origin');
  assert(!u.hash&&(query||!u.search),'unexpected URL query or fragment');
  assert(!/\/(?:wp-admin|wp-login\.php|wp-json)(?:\/|$)/i.test(u.pathname),'public page path required');
  if(root)assert(u.pathname===root||u.pathname.startsWith(root.endsWith('/')?root:root+'/'),'URL outside public site path');
  return u;
}
function feedbackURL(f,config){
  str(f.restPath);const u=new URL(f.restPath,config.baseURL);
  assert(u.origin===new URL(config.baseURL).origin&&!u.username&&!u.password&&!u.search&&!u.hash&&!/\\|%(?:2e|2f|5c)/i.test(f.restPath),'invalid feedback URL');
  assert(u.pathname.endsWith(`/wp-json/contact-form-7/v1/contact-forms/${f.formId}/feedback`),'feedback endpoint must match formId');return u.href;
}
export function validate(check,config){
  assert.equal(check.kind,'discovered-public');const o=check.options;
  obj(o,['area','path','search','menu','forms','sitemaps','robots']);assert(areas.includes(o.area),'unsupported area');
  assert.equal(check.suite,o.area==='crawl'?'seo':'delivery','kind/suite mismatch');publicURL(o.path,config);
  if(o.search!==undefined){const s=o.search;obj(s,['path','actionPath','inputSelector','formSelector','submitSelector','openSelector','term','resultHeadingSelector','expectedHeading']);for(const k of ['path','actionPath'])if(s[k]!==undefined)publicURL(s[k],config);for(const k of ['inputSelector','formSelector','submitSelector','openSelector','term','resultHeadingSelector','expectedHeading'])if(s[k]!==undefined)str(s[k]);assert(!s.expectedHeading||s.resultHeadingSelector,'expectedHeading requires resultHeadingSelector');}
  if(o.menu!==undefined){obj(o.menu,['path','openSelector','closeSelector','menuSelector','stateSelector','stateAttribute','openedValue','closedValue']);if(o.menu.path!==undefined)publicURL(o.menu.path,config);for(const k of ['openSelector','closeSelector','menuSelector','stateSelector','stateAttribute','openedValue','closedValue'])if(o.menu[k]!==undefined)str(o.menu[k]);if(o.menu.stateAttribute)assert(/^[\w-]+$/.test(o.menu.stateAttribute),'invalid state attribute');if(o.menu.openedValue!==undefined&&o.menu.closedValue!==undefined)assert.notEqual(o.menu.openedValue,o.menu.closedValue,'menu states must differ');}
  if(o.forms!==undefined){assert(Array.isArray(o.forms)&&o.forms.length<=20,'forms array (max 20) required');for(const f of o.forms){obj(f,['path','formId','formSelector','fields','restPath','submitSelector','responseSelector']);if(f.path!==undefined)publicURL(f.path,config);if(f.formId!==undefined)assert(Number.isSafeInteger(f.formId)&&f.formId>0,'positive formId required');for(const k of ['formSelector','submitSelector','responseSelector'])if(f[k]!==undefined)str(f[k]);if(f.restPath!==undefined)feedbackURL(f,config);if(f.fields!==undefined){assert(Array.isArray(f.fields)&&f.fields.length<=100,'fields array required');const names=new Set();for(const field of f.fields){obj(field,['name','type','required']);assert(/^[\w-]{1,100}$/.test(field.name),'safe field name required');assert(!names.has(field.name),'duplicate field name: rediscover grouped controls');names.add(field.name);assert(['text','email','tel','url','number','date','checkbox','radio','select','textarea','file'].includes(field.type),'unknown field type');assert.equal(typeof field.required,'boolean');}}}}
  if(o.robots!==undefined){obj(o.robots,['path']);if(o.robots.path!==undefined)publicURL(o.robots.path,config);}
  if(o.sitemaps!==undefined){assert(Array.isArray(o.sitemaps)&&o.sitemaps.length<=20,'sitemaps array required');for(const m of o.sitemaps){obj(m,['path']);if(m.path!==undefined)publicURL(m.path,config);}}
  for(const k of ['search','menu','forms','robots','sitemaps'])if(o[k]!==undefined)assert((o.area==='navigation'?['search','menu']:o.area==='crawl'?['robots','sitemaps']:['forms']).includes(k),`${k} does not apply to ${o.area}`);
  return check;
}
export function validateRuntime(check,config){
  validate(check,config);const o=check.options;
  const need=(v,label)=>{if(v===undefined||v===null||v==='')blocked(`Discover ${label} before execution`);};
  if(o.area==='navigation'){
    if(!o.search&&!o.menu)blocked('Discover an unambiguous search form or menu control');
    if(o.search)for(const k of ['path','actionPath','formSelector','inputSelector'])need(o.search[k],'search.'+k);
    if(o.menu)for(const k of ['path','openSelector','menuSelector'])need(o.menu[k],'menu.'+k);
    if(o.menu&&['stateSelector','stateAttribute','openedValue','closedValue'].some(k=>o.menu[k]!==undefined))for(const k of ['stateSelector','stateAttribute','openedValue','closedValue'])need(o.menu[k],'menu.'+k);
  }
  if(o.area.startsWith('contact-')){
    if(!o.forms?.length)blocked('Discover contact forms and their declared fields');
    for(const f of o.forms){for(const k of ['path','formSelector','submitSelector','fields'])need(f[k],'form.'+k);if(!f.fields.length)blocked('Discover contact form fields');
      if(o.area==='contact-errors'&&!f.fields.some(x=>x.required||x.type==='email'))blocked('No declared required or email validation conditions');
      if(o.area==='contact-retry'){for(const k of ['formId','restPath','responseSelector'])need(f[k],'form.'+k);for(const field of f.fields)if(field.required&&!['text','email','tel','url','textarea','checkbox'].includes(field.type))blocked(`Provide a safe fixture for required ${field.name} (${field.type}); automatic retry unavailable`);}
    }
  }
  if(o.area==='crawl'){if(!o.robots&&!o.sitemaps?.length)blocked('Discover robots.txt or sitemap URLs');if(o.robots)need(o.robots.path,'robots.path');for(const m of o.sitemaps??[])need(m.path,'sitemap.path');}
}
function publicHeaders(config){
  const headers={cookie:''};for(const [key,value] of Object.entries(envHeaders(config.headersEnv))){assert(!/[\r\n]/.test(key+value),'invalid public header');const k=key.toLowerCase();if(['authorization','proxy-authorization','x-wp-nonce','host'].includes(k))continue;if(k==='cookie'){const cookies=value.split(';').map(s=>s.trim()).filter(s=>/^password_protected_[\w-]+=[^;]*$/.test(s)&&!s.startsWith('password_protected_cookie_test='));if(cookies.length)headers.cookie=cookies.join('; ');}else headers[k]=value;}return headers;
}
function noGate(body){const $=load(body);if($('#loginform,[name="password_protected_pwd"]').length)blocked('Public gate expired; refresh public gate headers');}
async function get(client,url,timeout){
  const response=await client.get(url,{maxRedirects:0,timeout});try{assert.equal(response.status(),200,`GET ${new URL(url).pathname} status`);assert(Number(response.headers()['content-length']||0)<=2*1024*1024,'response too large');const body=await response.text();assert(Buffer.byteLength(body)<=2*1024*1024,'response too large');noGate(body);return body;}finally{await response.dispose();}
}
// Cheerio deliberately repairs malformed XML. Check nesting first so repaired
// sitemap markup cannot turn a malformed document into a passing observation.
function xmlDocument(body){
  assert(!/<!DOCTYPE|<!ENTITY/i.test(body),'XML declarations with entities are unsupported');
  const stack=[];let roots=0;
  const text=body.replace(/<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->/g,'');
  for(const part of text.split(/(<[^>]*>)/g).filter(Boolean)){
    if(part.startsWith('<')){const m=/^<(\/)?([\w:.-]+)(?:\s+[^<>]*?)?(\/)?\s*>$/.exec(part);assert(m,'malformed sitemap XML');if(m[1])assert.equal(stack.pop(),m[2],'malformed sitemap XML nesting');else{if(!stack.length)roots++;if(!m[3])stack.push(m[2]);}}
    else assert(stack.length||!part.trim(),'text outside sitemap root');
  }
  assert.equal(stack.length,0,'unclosed sitemap XML');assert.equal(roots,1,'one sitemap root required');return load(body,{xmlMode:true});
}
async function crawl(o,config,client,actual,timeout){
  if(o.robots){const body=await get(client,publicURL(o.robots.path,config).href,timeout);assert(!/[<>\x00]/.test(body),'robots must be valid text, not HTML');let agents=0;for(const raw of body.split(/\r?\n/)){const line=raw.split('#')[0].trim();if(!line)continue;const m=/^([\w-]+):\s*(.*)$/.exec(line);assert(m,'invalid robots directive syntax');if(m[1].toLowerCase()==='user-agent'){assert(m[2],'empty robots user-agent');agents++;}if(['allow','disallow'].includes(m[1].toLowerCase()))assert(agents,'robots rule before user-agent');if(m[1].toLowerCase()==='sitemap')publicURL(m[2],config);}assert(agents,'robots user-agent missing');actual.robots={path:o.robots.path,validText:true};}
  const root=publicURL(o.path,config).pathname,queue=(o.sitemaps??[]).map(x=>publicURL(x.path,config,{root}).href),visited=new Set(),urls=new Set();
  while(queue.length){const url=queue.shift();if(visited.has(url))continue;if(visited.size>=20)blocked('Sitemap traversal exceeds 20 documents; split the discovered crawl scope');visited.add(url);const $=xmlDocument(await get(client,url,timeout));const node=$.root().children().first(),name=node[0]?.tagName;assert(['urlset','sitemapindex'].includes(name),'sitemap root must be urlset or sitemapindex');const entries=node.children(name==='urlset'?'url':'sitemap');assert(entries.length,'empty sitemap has no discoverable URLs');for(const entry of entries){const loc=$(entry).children('loc');assert.equal(loc.length,1,'one sitemap loc required');const value=loc.text().trim();assert(/^https?:\/\//.test(value)&&!/[\s\x00-\x1f]/.test(value),'absolute sitemap URL required');const target=publicURL(value,config,{root,query:name==='urlset'}).href;if(name==='sitemapindex')queue.push(target);else urls.add(target);if(queue.length+visited.size>100||urls.size>200)blocked('Crawl exceeds bounded scope (100 queued maps / 200 URLs); split discovery');}}
  for(const url of urls)await get(client,url,timeout);actual.sitemaps=[...visited];actual.urls=[...urls];actual.scope='robots syntax and bounded same-origin public sitemap URL/status checks; no indexing business policy inferred';
}
async function unique(page,selector){const loc=page.locator(selector);assert.equal(await loc.count(),1,`discovered selector must remain unique: ${selector}`);return loc;}
const dummy={text:'QA network test',textarea:'QA network test',email:'qa@example.invalid',tel:'0000000000',url:'https://example.invalid/'};

export async function run({check,config,browser,requestFactory,attach}){
  validateRuntime(check,config);const o=check.options,timeout=config.timeoutMs??15000,headers=publicHeaders(config);
  const actual={area:o.area,jsErrors:[],jsErrorScope:'Uncaught JavaScript errors are separate diagnostics, not check assertions.',scope:'Controlled network: all writes and external resources blocked; no external CAPTCHA, mail delivery or server validation covered.',observations:[],network:{blockedWrites:0,blockedExternal:0,feedbackAttempts:0,forwardedWrites:0}};
  let context,client,page;
  try{
    if(o.area==='crawl'){if(!requestFactory)blocked('Request factory unavailable');client=await requestFactory.newContext({extraHTTPHeaders:headers,storageState:{cookies:[],origins:[]}});await crawl(o,config,client,actual,timeout);return {expectations:o,actual};}
    if(!browser)blocked('Browser unavailable');
    context=await browser.newContext({serviceWorkers:'block',storageState:{cookies:[],origins:[]},viewport:{width:390,height:844}});
    const endpoints=new Set((o.forms??[]).filter(f=>f.restPath).map(f=>feedbackURL(f,config)));
    await context.route('**/*',async route=>{
      const req=route.request();if(!['GET','HEAD'].includes(req.method())){actual.network.blockedWrites++;if(req.method()==='POST'&&endpoints.has(req.url()))actual.network.feedbackAttempts++;return route.abort('failed');}
      // No authentication jar or credential forwarding to third-party resources.
      const u=new URL(req.url());if(u.origin!==new URL(config.baseURL).origin){actual.network.blockedExternal++;return route.abort('blockedbyclient');}
      if(req.isNavigationRequest()){try{publicURL(req.url(),config,{query:true});}catch{return route.abort('blockedbyclient');}}
      const clean=Object.fromEntries(Object.entries(req.headers()).filter(([k])=>!['cookie','authorization','proxy-authorization','x-wp-nonce'].includes(k.toLowerCase())));
      let response;
      try{
        response=await route.fetch({headers:{...clean,...headers},maxRedirects:0,timeout});
        const location=response.headers().location;
        if(response.status()>=300&&response.status()<400&&location){
          const target=new URL(location,req.url());
          if(target.origin!==u.origin||target.username||target.password){actual.network.blockedExternal++;return await route.abort('blockedbyclient');}
          if(req.isNavigationRequest())publicURL(target.href,config,{query:true});
        }
        // Browser sees and reissues each redirect under the same guard. Never
        // let the HTTP fetch follow a hop with gate headers attached.
        await route.fulfill({response,headers:{...response.headers(),'set-cookie':''}});
      }catch{await route.abort('failed');}finally{await response?.dispose();}
    });
    page=await context.newPage();page.setDefaultTimeout(timeout);page.setDefaultNavigationTimeout(timeout);page.on('pageerror',e=>actual.jsErrors.push(e.message));
    const go=async path=>{const response=await page.goto(publicURL(path,config,{query:true}).href,{waitUntil:'load'});assert(response?.ok(),'public page status failed');publicURL(page.url(),config,{query:true});noGate(await page.content());};
    if(o.area==='navigation'){
      if(o.search){const s=o.search;await go(s.path);const form=await unique(page,s.formSelector),input=await unique(page,s.inputSelector);assert(await input.evaluate((el,selector)=>el.form===document.querySelector(selector),s.formSelector),'search input outside discovered form');const contract=await form.evaluate(el=>({method:el.method,action:el.action}));assert.equal(contract.method.toLowerCase(),'get','search must use GET');assert.equal(publicURL(contract.action,config).href,publicURL(s.actionPath,config).href,'search action changed');const term=s.term??'qa-discovery';
        if(!await input.isVisible()&&s.openSelector)await (await unique(page,s.openSelector)).click();
        if(await input.isVisible()){
          await input.fill(term);const navigation=page.waitForNavigation({waitUntil:'load',timeout});
          // Observe the promise immediately: failed clicks must not leave an unhandled timeout.
          navigation.catch(()=>{});
          if(s.submitSelector)await (await unique(page,s.submitSelector)).click();else await input.press('Enter');assert((await navigation)?.ok(),'search result status failed');actual.observations.push({condition:'search',scope:'form GET submission',resultURL:page.url()});
        }else{
          const fields=await form.evaluate(el=>Array.from(new FormData(el),([k,v])=>[k,typeof v==='string'?v:'']));const target=publicURL(contract.action,config);for(const [k,v] of fields)target.searchParams.append(k,v);target.searchParams.set('s',term);await go(target.href);actual.observations.push({condition:'search',scope:'hidden form derived GET request; opening/submission UI not covered',resultURL:page.url()});
        }
        const result=publicURL(page.url(),config,{query:true});assert.equal(result.pathname,publicURL(s.actionPath,config).pathname,'search result action path');assert.equal(result.searchParams.get('s'),term,'search result must retain s');noGate(await page.content());
        if(s.resultHeadingSelector){const heading=await unique(page,s.resultHeadingSelector);await expect(heading).toBeVisible({timeout});if(s.expectedHeading)await expect(heading).toHaveText(s.expectedHeading,{timeout});else assert((await heading.innerText()).trim(),'search heading empty');}
      }
      if(o.menu){
        const m=o.menu;await go(m.path);const control=await unique(page,m.openSelector),panel=await unique(page,m.menuSelector);
        const state=m.stateSelector?await unique(page,m.stateSelector):control,attribute=m.stateAttribute??'aria-expanded',opened=m.openedValue??'true',closed=m.closedValue??'false';
        const initial=await state.getAttribute(attribute);
        if(!m.stateSelector&&!['true','false'].includes(initial))blocked('Menu control has no observed aria-expanded contract; discover its explicit state attribute');
        assert([opened,closed].includes(initial),'menu state differs from discovered contract');
        if(!m.stateSelector){const target=await control.getAttribute('aria-controls');assert(target&&await panel.getAttribute('id')===target,'menu control target differs');}
        for(const value of [initial===closed?opened:closed,initial]){
          const button=value===closed&&m.closeSelector?await unique(page,m.closeSelector):control;
          await button.click();await expect(state).toHaveAttribute(attribute,value,{timeout});
          if(value===opened)await expect(panel).toBeVisible({timeout});
          else if(!m.stateSelector)await expect(panel).toBeHidden({timeout});
          else await expect.poll(async()=>{
            if(!await panel.isVisible())return true;
            return panel.evaluate(el=>{
              for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(style.opacity==='0'||style.visibility==='hidden'||style.display==='none')return true;}
              const r=el.getBoundingClientRect();return r.width===0||r.height===0||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight;
            });
          },{timeout,message:'closed menu panel remains onscreen'}).toBeTruthy();
        }
        actual.observations.push({condition:'menu',stateAttribute:attribute,scope:'verified control toggles declared state both ways; opened panel visible'});
      }
    }else for(const f of o.forms){
      await go(f.path);const form=await unique(page,f.formSelector),submit=await unique(page,f.submitSelector);assert(await submit.evaluate((el,selector)=>el.form===document.querySelector(selector),f.formSelector),'submit outside discovered form');
      const live=await form.evaluate(el=>Array.from(el.elements).filter(x=>x.name&&!x.disabled&&!['hidden','submit','button','reset'].includes(x.type)).map(x=>({name:x.name,type:x.tagName==='TEXTAREA'?'textarea':x.tagName==='SELECT'?'select':x.type,required:x.required||x.getAttribute('aria-required')==='true'||x.classList.contains('wpcf7-validates-as-required'),acceptance:!!x.closest('.wpcf7-acceptance')})));
      for(const field of live)if(field.required&&!f.fields.some(x=>x.name===field.name))blocked(`Rediscover required field ${field.name} (${field.type}) before testing`);
      const fields=[];for(const field of f.fields){const loc=form.locator(`[name=${JSON.stringify(field.name)}]`);assert.equal(await loc.count(),1,`field missing or ambiguous: ${field.name}`);const observed=live.find(x=>x.name===field.name);assert(observed&&observed.type===field.type,`field type changed: ${field.name}`);assert.equal(observed.required,field.required,`required declaration changed: ${field.name}`);fields.push({...field,loc,acceptance:observed.acceptance});}
      const fill=async()=>{for(const field of fields){if(field.type==='checkbox'){if(field.required||field.acceptance||/accept|consent/i.test(field.name))await field.loc.check();}else if(field.required||field.type==='email'){if(!dummy[field.type])blocked(`Provide safe input for required ${field.name} (${field.type})`);await field.loc.fill(dummy[field.type]);if(!await field.loc.evaluate(el=>el.checkValidity()))blocked(`Provide input matching constraints for ${field.name}`);}}};
      if(o.area==='contact-errors'){
        for(const field of fields.filter(x=>x.required||x.type==='email')){
          for(const mode of [...(field.required?['empty']:[]),...(field.type==='email'?['email']:[])]){
            await form.evaluate(el=>el.reset());await fill();if(field.type==='checkbox')await field.loc.uncheck();else if(['text','email','tel','url','textarea'].includes(field.type))await field.loc.fill(mode==='email'?'invalid-email':'');else blocked(`Provide validation fixture for ${field.name} (${field.type})`);
            await submit.click();
            await expect.poll(async()=>await field.loc.evaluate(el=>{if(!el.form.noValidate&&!el.validity.valid&&el.validationMessage)return true;if(el.getAttribute('aria-invalid')!=='true')return false;const visible=n=>!!n&&!!(n.offsetWidth||n.offsetHeight||n.getClientRects().length)&&!!n.textContent.trim();const ids=(el.getAttribute('aria-describedby')||'').split(/\s+/);return ids.some(id=>visible(document.getElementById(id)))||Array.from(el.parentElement.querySelectorAll('.wpcf7-not-valid-tip')).some(visible);}) || (await field.loc.getAttribute('aria-invalid')==='true'&&!!f.responseSelector&&await page.locator(f.responseSelector).isVisible()&&!!(await page.locator(f.responseSelector).innerText()).trim()),{timeout,message:`${field.name} ${mode}: validation error missing`}).toBeTruthy();
            actual.observations.push({condition:'contact-validation',field:field.name,mode,verified:true});
          }
        }
      }else{
        await fill();const output=await unique(page,f.responseSelector),before=await output.innerText();const values=await form.evaluate(el=>Array.from(new FormData(el),([k,v])=>[k,typeof v==='string'?v:'[file]']));const start=actual.network.feedbackAttempts;
        for(let attempt=1;attempt<=2;attempt++){
          await submit.click();await expect.poll(()=>actual.network.feedbackAttempts,{timeout,message:'exact CF7 feedback request not attempted'}).toBe(start+attempt);
          await expect(output).toBeVisible({timeout});await expect.poll(async()=>(await output.innerText()).trim(),{timeout,message:'network failure message missing'}).not.toBe('');if(attempt===1)assert.notEqual((await output.innerText()).trim(),before.trim(),'network failure did not change response');
          assert(!await form.evaluate(el=>el.classList.contains('sent')||el.getAttribute('data-status')==='sent'),'network failure reported as success');await expect(submit).toBeEnabled({timeout});await expect(form).toBeVisible({timeout});assert.deepEqual(await form.evaluate(el=>Array.from(new FormData(el),([k,v])=>[k,typeof v==='string'?v:'[file]'])),values,'form input lost after failure');
        }
        actual.observations.push({condition:'contact-retry',formId:f.formId,attempts:2,scope:'exact CF7 feedback aborted; visible response, retained inputs and usable retry; no delivery attempted'});
      }
    }
    return {expectations:o,actual};
  }finally{
    try{
      if(attach){
        if(page&&!page.isClosed()){
          try{
            // Mask all value-bearing controls, not response text: the screenshot
            // must show missing/error feedback without capturing autofill/PII.
            await attach(`${check.id}-discovered.png`,{body:await page.screenshot({fullPage:true,mask:[page.locator('input,textarea,select,[contenteditable="true"]')],timeout}),contentType:'image/png'});
          }catch{actual.screenshotUnavailable=true;}
        }
        await attach(`${check.id}-discovered.json`,{body:Buffer.from(JSON.stringify(actual)),contentType:'application/json'});
      }
    }finally{await context?.close();await client?.dispose();}
  }
}
