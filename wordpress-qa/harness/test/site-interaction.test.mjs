import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium,firefox,request} from '@playwright/test';
import {run,validate,permitsCartRequest,kinds} from '../lib/checks/site-interaction.mjs';

const settings={sitePath:'/',mainSelector:'main',paths:['/'],
 search:{openSelector:'#open',inputSelector:'[name=s]',submitSelector:'#search',term:'product',resultSelector:'#result',emptyTerm:'none',specialTerm:'QA<&"',emptyText:'No results',resultHeadingSelector:'h1'},
 menu:{buttonSelector:'#menu',panelSelector:'#panel',stateSelector:'html',stateAttribute:'data-state',openedValue:'open',closedValue:'closed',linkSelector:'#panel a',targetPath:'/contact',targetSelector:'[name=email]'},
 contact:{path:'/contact',formId:31,restPath:'/wp-json/contact-form-7/v1/contact-forms/31/feedback',nameField:'name',emailField:'email',messageField:'message',consentField:'consent',submitSelector:'#send',formSelector:'#contact',responseSelector:'#response',keyboardSelectors:['[name=name]','[name=email]','[name=message]']},
 commerce:{productPath:'/product',cartPath:'/cart',addSelector:'#add',quantitySelector:'[name=quantity]',limitQuantity:2,rejectionText:'limit one',customerSelector:'#customer',updateSelector:'#update',nextSelector:'#next',requiredSelector:'[name=required]',errorText:'Input required',confirmSelector:'#confirm',forbiddenTotalText:'1,232'}};
const check=(operation,s=settings)=>({kind:'site-interaction',options:{operation,settings:s}});
const config={baseURL:'http://localhost',environment:'local',allowTestWrites:true,timeoutMs:2500};

test('registration accepts incomplete conditions; runtime blocks missing configuration and unsafe writes',async()=>{
 assert.deepEqual(kinds,['site-interaction']);
 for(const op of ['all-links','search-product','search-empty','search-special','menu','menu-navigation','contact-validation','server-validation','network-failure','keyboard','firefox','performance','public-discovery','cart-limit','customer-empty']) {
  validate(check(op),config);validate(check(op,{}),config);await assert.rejects(run({check:check(op,{}),config}),/BLOCKED:.*settings/);
 }
 assert.throws(()=>validate(check('unknown'),config),/BLOCKED/);
 for(const op of ['cart-limit','customer-empty','server-validation']) {
  validate(check(op),{...config,environment:'production'});
  await assert.rejects(run({check:check(op),config:{...config,environment:'production'}}),/BLOCKED/);
  await assert.rejects(run({check:check(op),config:{...config,allowTestWrites:false}}),/BLOCKED/);
 }
 await assert.rejects(run({check:check('server-validation',{...settings,contact:{...settings.contact,restPath:'/arbitrary'}}),config}),/explicit CF7/);
 await assert.rejects(run({check:check('server-validation',{...settings,contact:{...settings.contact,restPath:settings.contact.restPath+'?token=secret'}}),config}),/explicit CF7/);
 assert.throws(()=>validate(check('all-links',{paths:['https://example.org']}),config));
 for(const [name,values] of Object.entries({scrollSteps:[-1,31,1.5,'12'],scrollStepPx:[99,1001,450.5,'450']})) for(const value of values) assert.throws(()=>validate(check('contact-validation',{...settings,[name]:value}),config),new RegExp('BLOCKED: settings.'+name));
 for(const [scrollSteps,scrollStepPx] of [[0,100],[30,1000],[12,450]]) validate(check('contact-validation',{...settings,scrollSteps,scrollStepPx}),config);
});
test('cart guard denies purchase, JSON, redirects and non-cart POSTs',()=>{
 const req=(body='quantity=1&add=Add',url='http://localhost/cart',type='application/x-www-form-urlencoded',redirect=null)=>({method:()=> 'POST',url:()=>url,headers:()=>({'content-type':type}),postData:()=>body,redirectedFrom:()=>redirect});
 const intent=(body,stage='add',name='add',value='Add')=>({stage,name,value,fields:[...new URLSearchParams(body)]});
 const update=intent(req().postData());assert(permitsCartRequest(req(),settings,config,update));assert(!permitsCartRequest(req(),settings,config));
 for(const r of [req('purchase=1'),req('PURCHASE.x=1'),req('confirm=1'),req(undefined,'http://other/cart'),req('{}',undefined,'application/json'),req(undefined,undefined,undefined,{})]) assert(!permitsCartRequest(r,settings,config,update));
 for(const [stage,name] of [['customer','customerinfo'],['delivery','deliveryinfo']]) {
  const body=`${name}=Next&confirm=&offer%5Bpayment_name%5D=&order_note=&customer%5Bname1%5D=&itemOrderAcceptable%5B0%5D=1`;
  const permit=intent(body,stage,name,'Next');assert(permitsCartRequest(req(body),settings,config,permit));
  assert(!permitsCartRequest(req(body),settings,config,{...permit,used:true}));
  assert(!permitsCartRequest(req(body),settings,config,{...permit,stage:'add'}));
  for(const extra of ['purchase=','purchase=1','PURCHASE.x=0','checkout=','confirm=1','offer%5Bpayment_name%5D=card','order=submit','deliveryinfo=Unexpected']) {
   const malicious=body+'&'+extra;
   assert(!permitsCartRequest(req(malicious),settings,config,intent(malicious,stage,name,'Next')),extra);
  }
  assert(!permitsCartRequest(req(body+'&injected=value'),settings,config,permit),'payload must match selected form');
 }
 const quantity='upButton=Update&quantity=2';assert(!permitsCartRequest(req(quantity),settings,config,intent(quantity,'quantity','upButton','Update')),'quantity checks never authorize a POST');
});
test('unavailable Firefox is BLOCKED and still attaches diagnostics',async t=>{
 t.mock.method(firefox,'launch',async()=>{throw Error('missing executable');});
 const attached=[];
 await assert.rejects(run({check:check('firefox'),config,attach:async(n,e)=>attached.push(e)}),/BLOCKED: Firefox engine unavailable/);
 assert.equal(attached.length,1);assert.equal(attached[0].outcome,'failed');
});

test('browser cleanup and attachment failures never replace the original operation error',async t=>{
 const original=new TypeError("Cannot read properties of null (reading 'valid_from')"),calls=[],attachments=[];
 const fail=stage=>async()=>{calls.push(stage);throw Error('PRIVATE cleanup '+stage);};
 const page={setDefaultTimeout(){},goto:async()=>{throw original;},isClosed:()=>false,locator:()=>({}),screenshot:fail('screenshot'),close:fail('page-close')};
 const context={route:async()=>{},newPage:async()=>page,pages:()=>[page],unrouteAll:fail('unroute'),close:fail('context-close')};
 t.mock.method(firefox,'launch',async()=>({newContext:async()=>context,close:fail('browser-close')}));
 for(const attachmentFails of [false,true]) {
  calls.length=0;
  await assert.rejects(run({check:check('firefox'),config,attach:async(name,data)=>{attachments.push(structuredClone(data));if(attachmentFails)throw Error('PRIVATE attachment failure');}}),error=>error===original);
  assert.deepEqual(calls,['screenshot','page-close','unroute','context-close','browser-close']);
  const evidence=attachments.at(-1);assert.equal(evidence.outcome,'failed');assert.equal(evidence.stage,'page navigation');assert.equal(evidence.failure.reason,'firefox failed during page navigation');
  assert.deepEqual(evidence.cleanupErrors.map(e=>e.stage),['page-close','unroute','context-close','browser-close']);
  assert(!JSON.stringify(evidence).includes('PRIVATE'));
 }
});

test('request disposal preserves failed checks and fails otherwise successful checks',async()=>{
 for(const status of [500,200]) {
  const cleanupError=Error('PRIVATE dispose failure'),attachments=[];let disposed=false;
  const requestFactory={newContext:async()=>({get:async()=>({status:()=>status,headers:()=>({}),text:async()=>'<main>Fixture</main>',dispose:async()=>{}}),dispose:async()=>{disposed=true;throw cleanupError;}})};
  await assert.rejects(run({check:check('public-discovery',{paths:['/']}),config,requestFactory,attach:async(n,e)=>attachments.push(structuredClone(e))}),error=>status===200?error===cleanupError:/source page HTTP status/.test(error.message));
  assert(disposed);const evidence=attachments.at(-1);assert.equal(evidence.outcome,'failed');assert.deepEqual(evidence.cleanupErrors.map(e=>e.stage),['request-dispose']);
  if(status===200) assert.equal(evidence.failure.type,'cleanup');else assert.equal(evidence.failure.type,'assertion');
  assert(!JSON.stringify(evidence).includes('PRIVATE'));
 }
});

test('all-links scans 165 sources with a bounded pool in both phases and attaches every redacted failure',async()=>{
 const paths=Array.from({length:165},(_,i)=>`/source/${i}?token=SECRET`),calls=[],attachments=[];
 let active=0,peak=0,sourcePeak=0,destinationPeak=0,sourceFinished=0,disposed=false;
 const requestFactory={newContext:async options=>{
  assert.deepEqual(options,{extraHTTPHeaders:{}});
  return {dispose:async()=>{assert.equal(active,0);disposed=true;},get:async(url,options)=>{
   assert.equal(options.maxRedirects,0);assert.equal(new URL(url).origin,config.baseURL,'external redirects never requested');
   const path=new URL(url).pathname,isSource=path.startsWith('/source/'),id=Number(path.split('/').at(-1));
   if(!isSource) assert.equal(sourceFinished,165,'destination phase waits for all sources');
   calls.push(path);active++;peak=Math.max(peak,active);if(isSource)sourcePeak=Math.max(sourcePeak,active);else destinationPeak=Math.max(destinationPeak,active);
   try {
    await new Promise(resolve=>setTimeout(resolve,3));
    if((isSource&&id===1)||(!isSource&&id===5)) throw Error('private network detail SECRET');
    const redirect=(isSource&&id===2)||(!isSource&&id===4);
    const status=redirect?302:isSource&&id===0?503:!isSource&&id===3?404:200;
    const body=isSource?`<a href="/destination/${id}?token=SECRET">Target</a><a href="/source/0?token=SECRET">Cached</a><a href="https://external.invalid/private">External</a>`:'OK';
    return {status:()=>status,headers:()=>redirect?{location:'https://external.invalid/?token=SECRET'}:{},text:async()=>body,dispose:async()=>{}};
   }finally{active--;if(isSource)sourceFinished++;}
  }};
 }};
 await assert.rejects(run({check:check('all-links',{paths}),config,requestFactory,attach:async(name,data)=>attachments.push({name,data:structuredClone(data)})}),/source or internal link HTTP errors/);
 assert.equal(peak,3);assert.equal(sourcePeak,3);assert.equal(destinationPeak,3);assert(disposed);
 assert.equal(calls.filter(p=>p.startsWith('/source/')).length,165,'every selected source checked, cached links not fetched again');
 assert.equal(calls.filter(p=>p.startsWith('/destination/')).length,162,'healthy sources scanned despite other source failures');
 assert.equal(attachments[0].name,'all-internal-links','complete scan attached before failure evidence');
 const scan=attachments[0].data;
 assert.equal(scan.sources.length,165);assert.equal(scan.results.length,163);assert.equal(scan.failures.length,7);
 assert.equal(scan.selectedScope,'all-links');assert.equal(scan.selectedPaths.length,165);assert.equal(scan.testedPaths.length,327);
 for(const path of ['/source/0','/source/1','/source/2','/destination/3','/destination/4','/destination/5']) assert(scan.failures.some(f=>f.path===path&&Object.hasOwn(f,'status')&&f.error),path);
 assert(!JSON.stringify(attachments).includes('SECRET'),'queries, raw error messages and external locations are redacted');
 assert.equal(attachments.at(-1).data.outcome,'failed');
});

test('gate Cookie preserves rotated cart sessions across fulfilled responses and redirects',async()=>{
 const hits=[],externalHits=[],sessions=[];
 const external=createServer((req,res)=>{externalHits.push(req.headers);res.end('asset');});await new Promise(r=>external.listen(0,'127.0.0.1',r));
 const externalURL=`http://127.0.0.1:${external.address().port}`;
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const cookies=Object.fromEntries((req.headers.cookie??'').split(';').filter(Boolean).map(part=>{const i=part.indexOf('=');return [part.slice(0,i).trim(),part.slice(i+1)];}));
  hits.push({path:req.url,method:req.method,cookies,body});
  res.setHeader('content-type','text/html');
  if(cookies.site_gate!=='gate-secret'){res.end('<input name="password_protected_pwd">');return;}
  if(req.url==='/product') {
   res.setHeader('set-cookie','welcart_session=seed; Path=/; HttpOnly; SameSite=Lax');
   res.end(`<main><form action="/cart" method="post"><button id="add" name="add" value="1">Add</button></form></main>`);return;
  }
  if(req.url==='/asset-redirect'){res.writeHead(302,{location:externalURL});res.end();return;}
  const step=new URLSearchParams(body);
  if(req.url==='/cart'&&req.method==='POST') {
   const command=step.has('add')?'add':step.has('customerinfo')?'customer':'next';
   const expected={add:'seed',customer:'added',next:'customer'}[command];
   if(cookies.welcart_session!==expected){res.statusCode=409;res.end('<main>Empty cart: session lost</main>');return;}
   const next={add:'added',customer:'customer',next:'rejected'}[command];
   res.setHeader('set-cookie',`welcart_session=${next}; Path=/; HttpOnly; SameSite=Lax`);
   res.writeHead(303,{location:'/cart?state='+next});res.end();return;
  }
  const state=new URL(req.url,'http://fixture').searchParams.get('state');
  if(req.method==='GET'&&state&&cookies.welcart_session===state) {
   const content=state==='added'?'<button id="customer" name="customerinfo" value="1">Customer</button>':state==='customer'?'<button id="next" name="deliveryinfo" value="1">Next</button>':'<input name="required"><span>Input required</span>';
   const placeholders=state==='rejected'?'':'<input type="hidden" name="itemOrderAcceptable[0]" value="1"><input type="hidden" name="confirm" value=""><input type="hidden" name="offer[payment_name]" value=""><input type="hidden" name="order_note" value="">';
   res.end(`<main><form action="/cart" method="post">${placeholders}${content}</form></main><script>fetch('${externalURL}').catch(()=>{});fetch('/asset-redirect').catch(()=>{});let ready=false;document.querySelector('form').addEventListener('submit',async e=>{if(ready)return;e.preventDefault();const form=e.target,submitter=e.submitter;await Promise.allSettled([fetch('/cart',{method:'POST',body:new URLSearchParams(new FormData(form,submitter))}),fetch('/cart',{method:'POST',body:new URLSearchParams({purchase:'1'})})]);ready=true;form.requestSubmit(submitter);});</script>`);return;
  }
  res.statusCode=409;res.end('<main>Redirect session lost</main>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const baseURL=`http://127.0.0.1:${server.address().port}`;
 process.env.WPQA_CART_COOKIE_FIXTURE=JSON.stringify({Cookie:'site_gate=gate-secret; welcart_session=stale','Authorization':'Bearer gate-secret'});
 let browser;
 try {
  for(const engine of [chromium,firefox]) {
   browser=await engine.launch();
   const wrappedBrowser={newContext:async options=>{
    const context=await browser.newContext(options),close=context.close.bind(context);
    context.close=async()=>{sessions.push(await context.cookies(baseURL));await close();};return context;
   }};
   const result=await run({check:check('customer-empty'),config:{...config,baseURL,timeoutMs:15000,headersEnv:'WPQA_CART_COOKIE_FIXTURE'},browser:wrappedBrowser});
   assert.equal(result.outcome,'passed');
   assert.deepEqual(result.network.forwardedCartStages,['add','customer','delivery']);
   assert.equal(result.network.blockedWrites,4,'both competing POSTs are intercepted at each customer/delivery stage before navigation');
   assert(sessions.at(-1).some(c=>c.name==='welcart_session'&&c.value==='rejected'&&c.httpOnly),'route.fetch/fulfill Set-Cookie updates browser cookie jar');
   await browser.close();browser=null;
  }
  assert.equal(hits.filter(h=>h.method==='POST').length,6);
  assert(hits.filter(h=>h.method==='POST'&&!h.body.includes('add=')).every(h=>new URLSearchParams(h.body).get('confirm')===''),'empty metadata is retained on exact stage submissions');
  assert(hits.filter(h=>h.method==='POST').every(h=>h.cookies.welcart_session!=='stale'));
  assert(externalHits.length>0);assert(externalHits.every(h=>!h.cookie&&!h.authorization),'gate and cart cookies never sent externally');
 }finally{delete process.env.WPQA_CART_COOKIE_FIXTURE;await browser?.close();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>external.close(r))]);}
});

test('real browser and HTTP fixtures preserve assertions and isolate writes/auth',async()=>{
 const hits=[],externalHits=[];
 const external=createServer((req,res)=>{externalHits.push(req.headers);res.end('external');});await new Promise(r=>external.listen(0,'127.0.0.1',r));
 const externalURL=`http://127.0.0.1:${external.address().port}`;
 const html=(url)=>`<!doctype html><html lang="en" data-state="closed"><title>Fixture</title><link hreflang="ja" href="/ja?token=SECRET"><body><main>
 <a href="/member?token=SECRET">Member</a><script src="/analytics.js?token=SECRET"></script>
 <h1 id="heading">Fixture</h1><a href="/contact">Contact</a><a id="result" href="/product">Product</a>
 <button id="open">Search</button><form><input name="s"><button id="search">Search</button></form><div id="empty"></div>
 <button id="menu" onclick="document.documentElement.dataset.state=document.documentElement.dataset.state==='open'?'closed':'open';document.querySelector('#panel').hidden=document.documentElement.dataset.state!=='open'">Menu</button><div id="panel" hidden><a href="${url==='/menu-redirect'?'/contact-hop':url==='/menu-misdirect'?'/wrong-hop':url==='/menu-gated'?'/gate-input':'/contact'}">Contact</a></div>
 <form id="contact" class="wpcf7-form"><input type="hidden" name="_wpcf7" value="31"><input name="name" maxlength="100" aria-required="true"><input name="email" type="email"><textarea name="message"></textarea><input name="consent" type="checkbox"><button id="send" disabled>Send</button><div id="response"></div></form>
 <form method="post" action="/cart"><button id="add" name="add" value="1">Add</button></form>
 <form method="post" action="/cart"><input name="quantity" value="1"><input type="hidden" name="itemOrderAcceptable[0]" value="1"><input id="update" type="submit" name="upButton" value="Update"><input id="unnamed-update" type="button" value="Update"><button id="customer" name="customer" value="1">Customer</button><button id="next" name="next" value="1">Next</button><input name="required"><span>Input required</span></form>
 </main><script>
 const term=new URL(location.href).searchParams.get('s');if(term!==null){document.querySelector('h1').textContent=term;document.querySelector('#empty').textContent=term==='product'?'':'No results';}
 document.querySelector('[name=consent]').onchange=e=>document.querySelector('#send').disabled=!e.target.checked;
 document.querySelector('#contact').onsubmit=async e=>{e.preventDefault();e.target.dataset.status='submitting';try{await fetch('${settings.contact.restPath}',{method:'POST',body:'test'});e.target.dataset.status='sent';}catch{if(location.pathname!=='/stuck')e.target.dataset.status='failed';document.querySelector('#response').textContent='Retry';}};
 for(const selector of ['#update','#unnamed-update'])document.querySelector(selector).onclick=e=>{if(document.querySelector('[name=quantity]').value==='2'){e.preventDefault();fetch('/cart',{method:'POST',body:new URLSearchParams({upButton:'Update',quantity:'2'})}).catch(()=>{});alert('limit one');}};
 fetch('/forbidden',{method:'POST',body:'must not forward'}).catch(()=>{});
 fetch('/forbidden',{method:'PATCH',body:'must not forward'}).catch(()=>{});
 fetch('/cart',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'purchase=1'}).catch(()=>{});
 fetch('/escape').catch(()=>{});
 if(location.pathname==='/lazy-contact') {document.querySelector('#contact').style.visibility='hidden';let wheels=0;addEventListener('wheel',()=>{if(++wheels>=3)document.querySelector('#contact').style.visibility='visible';});}
 </script></body></html>`;
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  hits.push({method:req.method,url:req.url,gate:req.headers['x-site-gate'],cookie:req.headers.cookie,body});
  if(req.url==='/escape'){res.writeHead(302,{location:externalURL});res.end();return;}
  if(req.url==='/contact-hop'||req.url==='/wrong-hop'){res.writeHead(302,{location:req.url==='/contact-hop'?'/contact-final?view=1':'/unexpected'});res.end();return;}
  if(req.url==='/gate-input'||req.url==='/gate-form') {res.setHeader('content-type','text/html');res.end(req.url==='/gate-input'?'<main><input name="password_protected_pwd"></main>':'<form class="password-protected-form"></form>');return;}
  if(req.url==='/gated-link') {res.setHeader('content-type','text/html');res.end('<a href="/gate-input">Gated destination</a>');return;}
  if(req.url.endsWith(settings.contact.restPath)){res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'validation_failed',invalid_fields:['name','email','message'].map(field=>({field,message:'PRIVATE SERVER MESSAGE'}))}));return;}
  if(req.url.startsWith('/analytics.js')){res.setHeader('content-type','application/javascript');res.end('/* analytics fixture */');return;}
  if(req.url==='/broken'){res.statusCode=404;res.end('missing');return;}
  res.setHeader('content-type','text/html');res.end(html(req.url));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const baseURL=`http://127.0.0.1:${server.address().port}`;
 process.env.WPQA_INTERACTION_FIXTURE_HEADERS=JSON.stringify({'X-Site-Gate':'fixture-secret'});
 let browser;
 try {
  browser=await chromium.launch();const attachments=[];
  const adminContext=await browser.newContext();await adminContext.addCookies([{name:'admin_session',value:'must-not-inherit',url:baseURL}]);
  const args={config:{...config,baseURL,headersEnv:'WPQA_INTERACTION_FIXTURE_HEADERS'},browser,requestFactory:request,attach:async(name,data)=>attachments.push(structuredClone(data))};
  for(const op of ['all-links','public-discovery','server-validation','search-product','search-empty','search-special','menu','menu-navigation','contact-validation','network-failure','keyboard','performance','cart-limit','customer-empty','firefox']) {
   const result=await run({...args,check:check(op)});assert.equal(result.outcome,'passed',op);
   if(op==='public-discovery'){const d=result.observations[0].discovery;assert.equal(d.hreflang[0].path,'/ja');assert(d.inputs.some(i=>i.name==='name'&&i.maxlength==='100'&&i.required==='true'));assert.deepEqual(d.membershipLinks,['/member']);assert.deepEqual(d.integrationScripts,['/analytics.js']);assert(!JSON.stringify(result).includes('SECRET'));}
   if(op==='network-failure'){assert(result.network.feedbackAttempts>0);assert.equal(result.network.forwardedWrites,0);}
  }
  assert.deepEqual(hits.filter(h=>h.gate!=='fixture-secret').map(h=>({method:h.method,path:new URL(h.url,baseURL).pathname})),[],'gate headers reach same origin');
  assert(hits.every(h=>!h.cookie?.includes('admin_session')),'contexts do not inherit admin session');await adminContext.close();
  assert(externalHits.length>0,'external GET dependencies allowed');assert(externalHits.every(h=>!h['x-site-gate']&&!h.authorization&&!h.cookie),'no gate credentials leaked to external redirect');
  assert(!hits.some(h=>h.url==='/forbidden'),'background writes dropped');
  const writes=hits.filter(h=>h.method!=='GET');assert(writes.length>0);assert(writes.every(h=>h.url==='/cart'||h.url===settings.contact.restPath));
  assert(!writes.some(h=>h.body.includes('purchase=')),'purchase POSTs never forwarded');
  assert.equal(writes.filter(h=>h.url===settings.contact.restPath).length,1,'only explicit validation reached CF7');
  assert(!JSON.stringify(attachments).includes('PRIVATE SERVER MESSAGE'));
  await run({...args,check:check('server-validation',{...settings,contact:{...settings.contact,path:'/retemp/contact',restPath:'/retemp'+settings.contact.restPath}})});
  await run({...args,check:check('performance',{paths:['/']})});
  for(const updateSelector of ['#update','#unnamed-update']) {const result=await run({...args,check:check('cart-limit',{...settings,commerce:{...settings.commerce,updateSelector}})});assert.deepEqual(result.network.forwardedCartStages,['add'],'quantity control has no POST permit');}
  assert(!hits.some(h=>h.method==='POST'&&h.body.includes('upButton=')),'quantity POST never reached fixture');
  const lazySettings={...settings,contact:{...settings.contact,path:'/lazy-contact'}};
  await assert.rejects(run({...args,check:check('contact-validation',lazySettings)}),'lazy consent is not interactable without setup scrolling');
  for(const operation of ['contact-validation','network-failure']) {
   const result=await run({...args,check:check(operation,{...lazySettings,scrollSteps:3,scrollStepPx:450})});
   assert.deepEqual(result.setupScroll,{steps:3,stepPx:450,animationWaitMs:120,completedSteps:3});
  }
  for(const operation of ['menu','keyboard']) {const result=await run({...args,check:check(operation,{...settings,scrollSteps:12,scrollStepPx:450})});assert.equal(result.setupScroll,undefined,'scroll setup is limited to the two contact operations');}
  // Blank optional paths are valid, but required paths and path arrays are not.
  await run({...args,check:check('performance',{paths:['/?safe=query'],sitePath:'',contact:{path:' ',restPath:''},menu:{targetPath:''},commerce:{productPath:'',cartPath:' '}})});
  await assert.rejects(run({...args,check:check('performance',{paths:[' ']})}),/BLOCKED: settings.paths/);
  await assert.rejects(run({...args,check:check('menu',{...settings,sitePath:''})}),/BLOCKED: missing settings: sitePath/);
  for(const path of ['/gate-input','/gate-form']) {
   for(const op of ['public-discovery','all-links','performance','firefox']) {
    await assert.rejects(run({...args,check:check(op,{paths:[path]})}),/BLOCKED: site gate expired/);
    assert.equal(attachments.at(-1).failure.type,'blocked');assert.equal(attachments.at(-1).failure.reason,'site gate expired; refresh site-gate credentials');
   }
   const writesBefore=hits.filter(h=>h.method!=='GET').length;
   await assert.rejects(run({...args,check:check('server-validation',{...settings,contact:{...settings.contact,path}})}),/BLOCKED: site gate expired/);
   assert.equal(hits.filter(h=>h.method!=='GET').length,writesBefore,'gate prevents validation POST');
  }
  await assert.rejects(run({...args,check:check('all-links',{paths:['/gated-link']})}),/BLOCKED: site gate expired/);
  assert.equal(attachments.at(-1).path,'/gate-input');
  const redirected=await run({...args,check:check('menu-navigation',{...settings,sitePath:'/menu-redirect',menu:{...settings.menu,targetPath:'/contact-final?view=1'}})});
  assert.equal(redirected.effectivePath,'/contact-final');assert.deepEqual(redirected.navigations.at(-1),{requestedPath:'/contact-hop',effectivePath:'/contact-final',status:200});
  await assert.rejects(run({...args,check:check('menu-navigation',{...settings,sitePath:'/menu-misdirect',menu:{...settings.menu,targetPath:'/wrong-hop'}})}));
  assert.equal(attachments.at(-1).effectivePath,'/unexpected','redirect must not pass by matching original URL');
  await assert.rejects(run({...args,check:check('menu-navigation',{...settings,sitePath:'/menu-gated',menu:{...settings.menu,targetPath:'/gate-input'}})}),/BLOCKED: site gate expired/);
  await assert.rejects(run({...args,check:check('search-product',{...settings,search:{...settings.search,resultSelector:'#missing'}})}));
  assert.equal(attachments.at(-1).outcome,'failed','failure attaches diagnostics');
  assert.equal(attachments.at(-1).screenshot,'attached');assert.equal(attachments.at(-1).failure.reason,'search-product failed during search-product assertions');
  await assert.rejects(run({...args,check:check('network-failure',{...settings,contact:{...settings.contact,path:'/stuck'}})}));
  assert.equal(attachments.at(-1).network.forwardedWrites,0);assert.equal(attachments.at(-1).outcome,'failed');
  await assert.rejects(run({...args,check:check('public-discovery',{paths:['/broken']})}),/source page HTTP/);
  const externalBefore=externalHits.length;
  await assert.rejects(run({...args,check:check('all-links',{paths:['/escape']})}));
  await assert.rejects(run({...args,check:check('performance',{paths:['/escape']})}));
  assert.equal(externalHits.length,externalBefore,'API and navigation redirects remain blocked');
  await assert.rejects(run({...args,check:check('menu',{} )}),/BLOCKED/);assert.equal(attachments.at(-1).outcome,'failed');
 } finally {delete process.env.WPQA_INTERACTION_FIXTURE_HEADERS;await browser?.close();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>external.close(r))]);}
});
