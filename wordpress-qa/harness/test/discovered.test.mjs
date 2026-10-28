import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {chromium, request} from '@playwright/test';
import {validate, validateRuntime, run} from '../lib/checks/discovered.mjs';

const check = (area, extra={}) => ({id:'discovered-fixture',kind:'discovered-public',suite:area==='crawl'?'seo':'delivery',options:{area,path:'/site/',...extra}});
const search={path:'/site/',actionPath:'/site/',formSelector:'#search',inputSelector:'#search input[name="s"]',submitSelector:'#search button',openSelector:'#open',resultHeadingSelector:'h1',expectedHeading:'Search results'};
const menu={path:'/site/',openSelector:'#toggle',menuSelector:'#menu'};
const form={path:'/site/contact',formId:12,formSelector:'#contact',submitSelector:'#send',responseSelector:'#response',restPath:'/site/wp-json/contact-form-7/v1/contact-forms/12/feedback',fields:[{name:'name',type:'text',required:true},{name:'email',type:'email',required:true}]};
const config={baseURL:'http://localhost',timeoutMs:800};

test('strict nested schemas reject unknown keys, nonpublic paths and mismatched endpoints',()=>{
  for(const c of [check('navigation',{typo:true}),check('navigation',{search:{...search,typo:1}}),check('contact-retry',{forms:[{...form,restPath:'/site/wp-json/contact-form-7/v1/contact-forms/13/feedback'}]}),check('crawl',{path:'/wp-admin/'}),check('crawl',{sitemaps:[{path:'https://outside.test/map.xml'}]}),{...check('crawl'),suite:'delivery'}])assert.throws(()=>validate(c,config));
  validate(check('navigation'),config);
  assert.throws(()=>validateRuntime(check('navigation'),config),/^Error: BLOCKED:/);
  assert.throws(()=>validateRuntime(check('contact-errors',{forms:[]}),config),/BLOCKED:/);
  assert.throws(()=>validateRuntime(check('crawl'),config),/BLOCKED:/);
});

async function fixture(t) {
  const seen=[]; const state={brokenMenu:false,brokenSearch:false,noError:false,jsError:false,aria:false,extra:false,map:'good',postSearch:false,acceptance:false,brokenValidation:false,customMenu:false,redirect:null,searchStatus:200,stuckPanel:false};
  const server=http.createServer((req,res)=>{
    seen.push({method:req.method,url:req.url,cookie:req.headers.cookie,gate:req.headers['x-public-gate'],authorization:req.headers.authorization});
    const u=new URL(req.url,'http://fixture');
    if(state.redirect&&u.pathname==='/site/'){res.writeHead(302,{location:state.redirect});return res.end();}
    if(req.method!=='GET'){res.writeHead(500);return res.end('write escaped');}
    if(u.pathname==='/robots.txt'){res.setHeader('Content-Type','text/plain');return res.end(state.map==='robots-html'?'<html>gate</html>':'User-agent: *\nDisallow:\n');}
    if(u.pathname==='/site/map.xml'){res.setHeader('Content-Type','application/xml');return res.end(`<sitemapindex><sitemap><loc>http://127.0.0.1:${server.address().port}/site/child.xml</loc></sitemap></sitemapindex>`);}
    if(u.pathname==='/site/child.xml'){
      const loc=state.map==='outside'?'https://outside.test/':`http://127.0.0.1:${server.address().port}${state.map==='admin'?'/site/wp-admin/':state.map==='missing'?'/site/missing':'/site/article'}`;
      return res.end(state.map==='malformed'?'<urlset><url><loc>oops</urlset>':`<urlset><url><loc>${loc}</loc></url></urlset>`);
    }
    if(u.pathname==='/site/missing'){res.writeHead(404);return res.end('missing');}
    res.setHeader('Content-Type','text/html');
    if(u.pathname==='/site/separate')return res.end(`<html data-spmenu="closed"><button id="toggle" onclick="document.documentElement.dataset.spmenu='opened';menu.hidden=false;this.hidden=true">Open</button><nav id="menu" hidden><button id="close" onclick="document.documentElement.dataset.spmenu='closed';menu.hidden=true;toggle.hidden=false">Close</button></nav></html>`);
    if(u.pathname==='/site/contact')return res.end(`<form id="contact" ${state.aria?'novalidate':''}><input name="name" ${state.aria?'aria-required="true"':'required'}><input name="email" type="email" ${state.aria?'aria-required="true"':'required'}>${state.extra?'<input name="upload" type="file" required>':''}${state.acceptance?'<span class="wpcf7-acceptance"><input name="contact-accept" type="checkbox"></span>':''}<button id="send">Send</button><div id="response" hidden></div></form><script>
      contact.addEventListener('submit',async e=>{e.preventDefault();
        if(${state.aria&&!state.brokenValidation}){let invalid=false;for(const f of contact.querySelectorAll('input')){if(!f.value || f.type==='email'&&!f.validity.valid){f.setAttribute('aria-invalid','true');invalid=true;}else f.removeAttribute('aria-invalid');}if(invalid){response.hidden=false;response.textContent='Please correct invalid fields';return;}}
        if(${state.acceptance}&&!contact.elements['contact-accept'].checked)return;
        send.disabled=true;try{await fetch('${form.restPath}',{method:'POST',body:new FormData(contact)});}catch{${state.noError?'':"response.hidden=false;response.textContent='Network error. Please retry';"}}finally{send.disabled=false;}
      });</script>`);
    if(u.searchParams.has('s')){res.statusCode=state.searchStatus;return res.end(`<h1>${state.brokenSearch?'Wrong':'Search results'}</h1>`);}
    res.end(`<html data-spmenu="closed"><button id="open" onclick="search.hidden=false">Search</button><form id="search" hidden method="${state.postSearch?'post':'get'}" action="/site/"><input name="s"><button>Go</button></form><button id="toggle" ${state.customMenu?'':'aria-controls="menu" aria-expanded="false"'} onclick="${state.brokenMenu?'':state.customMenu?"document.documentElement.dataset.spmenu=document.documentElement.dataset.spmenu==='closed'?'opened':'closed';menu.hidden=!menu.hidden":"this.setAttribute('aria-expanded',this.getAttribute('aria-expanded')==='false'?'true':'false');menu.hidden=!menu.hidden"}${state.stuckPanel?';menu.hidden=false':''}">Menu</button><nav id="menu" hidden>Links</nav>${state.jsError?'<script>throw Error("fixture diagnostic")</script>':''}<h1>Article</h1></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  return {seen,state,config:{...config,baseURL:`http://127.0.0.1:${server.address().port}`}};
}

test('navigation submits real GET search, tests heading and menu toggles, records JS separately',async t=>{
  const f=await fixture(t), browser=await chromium.launch();t.after(()=>browser.close());
  const c=check('navigation',{search,menu});f.state.jsError=true;
  const result=await run({check:c,config:f.config,browser});
  assert(result.actual.jsErrors.length);assert(f.seen.some(r=>r.url.includes('s=')));
  assert.equal(f.seen.filter(r=>r.method!=='GET').length,0);
  f.state.brokenMenu=true;await assert.rejects(run({check:c,config:f.config,browser}));
  f.state.brokenMenu=false;f.state.brokenSearch=true;await assert.rejects(run({check:c,config:f.config,browser}),/heading|Search results/i);
  f.state.brokenSearch=false;f.state.postSearch=true;await assert.rejects(run({check:c,config:f.config,browser}),/GET/);
  f.state.postSearch=false;f.state.searchStatus=500;await assert.rejects(run({check:c,config:f.config,browser}),/status/);
});

test('native and CF7 client validation run with every write blocked; retry observes actual network failure',async t=>{
  const f=await fixture(t),browser=await chromium.launch();t.after(()=>browser.close());
  for(const aria of [false,true]){f.state.aria=aria;await run({check:check('contact-errors',{forms:[form]}),config:f.config,browser});}
  f.state.aria=false;
  const result=await run({check:check('contact-retry',{forms:[form]}),config:f.config,browser});
  assert.equal(result.actual.network.feedbackAttempts,2);
  assert.equal(f.seen.filter(r=>r.method!=='GET').length,0);
  f.state.noError=true;await assert.rejects(run({check:check('contact-retry',{forms:[form]}),config:f.config,browser}));
  f.state.noError=false;f.state.extra=true;
  await assert.rejects(run({check:check('contact-retry',{forms:[form]}),config:f.config,browser}),/BLOCKED:.*upload/);
  assert.equal(f.seen.filter(r=>r.method!=='GET').length,0);
});

test('crawl recursively checks public URLs and rejects malformed, outside, admin and broken URLs',async t=>{
  const f=await fixture(t),c=check('crawl',{robots:{path:'/robots.txt'},sitemaps:[{path:'/site/map.xml'}]});
  const result=await run({check:c,config:f.config,requestFactory:request});
  assert(result.actual.urls.includes(f.config.baseURL+'/site/article'));
  for(const mode of ['outside','admin','missing','malformed','robots-html']){f.state.map=mode;await assert.rejects(run({check:c,config:f.config,requestFactory:request}),undefined,mode);}
});

test('public gate headers honored but administrator cookies and authorization never sent',async t=>{
  const f=await fixture(t),name='DISCOVERED_FIXTURE_HEADERS';
  process.env[name]=JSON.stringify({'X-Public-Gate':'fixture',Cookie:'wordpress_logged_in_secret=bad; password_protected_fixture=good',Authorization:'Bearer admin'});
  t.after(()=>delete process.env[name]);
  await run({check:check('crawl',{robots:{path:'/robots.txt'}}),config:{...f.config,headersEnv:name},requestFactory:request});
  assert(f.seen.length);assert(f.seen.every(r=>r.gate==='fixture'&&r.cookie==='password_protected_fixture=good'&&!r.authorization));
});

test('hidden SWELL search has explicit request-only coverage and optional acceptance permits intercepted retry',async t=>{
  const f=await fixture(t),browser=await chromium.launch();t.after(()=>browser.close());
  const {openSelector,...hidden}=search;
  const result=await run({check:check('navigation',{search:hidden}),config:f.config,browser});
  assert.match(result.actual.observations[0].scope,/UI not covered/);
  assert(f.seen.some(r=>r.url==='/site/?s=qa-discovery'));
  f.state.acceptance=true;
  const accepted={...form,fields:[...form.fields,{name:'contact-accept',type:'checkbox',required:false}]};
  await run({check:check('contact-retry',{forms:[accepted]}),config:f.config,browser});
  assert.equal(f.seen.filter(r=>r.method!=='GET').length,0);
});

test('broken client validation fails despite native validity flags on a novalidate form; diagnostics survive failure',async t=>{
  const f=await fixture(t),browser=await chromium.launch();t.after(()=>browser.close());f.state.aria=true;f.state.brokenValidation=true;
  let evidence,screenshot;
  await assert.rejects(run({check:check('contact-errors',{forms:[form]}),config:f.config,browser,attach:async(_,v)=>{if(v.contentType==='application/json')evidence=JSON.parse(v.body);else screenshot=v.body;}}),/validation error missing/);
  assert(screenshot?.length>0,'masked screenshot attached even on failure');
  assert(evidence.network.blockedWrites>0);assert.equal(f.seen.filter(r=>r.method!=='GET').length,0);
});

test('collector-verified SWELL state attributes toggle without inventing an aria contract',async t=>{
  const f=await fixture(t),browser=await chromium.launch();t.after(()=>browser.close());f.state.customMenu=true;
  const m={...menu,stateSelector:'html',stateAttribute:'data-spmenu',openedValue:'opened',closedValue:'closed'};
  await run({check:check('navigation',{menu:m}),config:f.config,browser});
  f.state.brokenMenu=true;await assert.rejects(run({check:check('navigation',{menu:m}),config:f.config,browser}));
  f.state.brokenMenu=false;f.state.stuckPanel=true;await assert.rejects(run({check:check('navigation',{menu:m}),config:f.config,browser}),/panel/);
  assert.throws(()=>validateRuntime(check('navigation',{menu:{...menu,stateSelector:'html'}}),f.config),/BLOCKED:/);
});

test('redirects cannot forward public gate headers to another origin',async t=>{
  const f=await fixture(t),browser=await chromium.launch();t.after(()=>browser.close());let external=0;
  const server=http.createServer((req,res)=>{external++;res.end('<h1>Search results</h1>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  f.state.redirect=`http://127.0.0.1:${server.address().port}/`;
  const name='DISCOVERED_REDIRECT_HEADERS';process.env[name]=JSON.stringify({Cookie:'password_protected_fixture=secret'});t.after(()=>delete process.env[name]);
  await assert.rejects(run({check:check('navigation',{search}),config:{...f.config,headersEnv:name},browser}));
  assert.equal(external,0);
});

test('verified closeSelector closes overlay without forcing the covered opener',async t=>{
  const f=await fixture(t),browser=await chromium.launch();t.after(()=>browser.close());
  const m={...menu,path:'/site/separate',closeSelector:'#close',stateSelector:'html',stateAttribute:'data-spmenu',openedValue:'opened',closedValue:'closed'};
  await run({check:check('navigation',{menu:m}),config:f.config,browser});
});
