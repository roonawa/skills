import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validate,run} from '../lib/checks/workflows.mjs';
import {chromium} from '@playwright/test';
import {ProjectStore} from '../ui/project-store.mjs';

test('external assets and sandbox navigation allow only explicit origins without role cookies',async()=>{
  const received=[],siteCookies=[];
  const foreign=http.createServer((req,res)=>{
    received.push({url:req.url,cookie:req.headers.cookie,authorization:req.headers.authorization});
    res.setHeader('Content-Type',req.url==='/asset.js'?'application/javascript':'text/html');
    if(req.url==='/start') {res.setHeader('Set-Cookie',['payment=own-session; Path=/; HttpOnly','poison=bad; Domain=127.0.0.1; Path=/']);res.end('<main>start</main>');return;}
    if(req.url==='/finish') {res.end(req.headers.cookie==='payment=own-session'?'<main>session verified</main>':'<main>session missing</main>');return;}
    res.end(req.url==='/asset.js'?"document.querySelector('main').textContent='loaded'":'<main>payment sandbox</main>');
  });
  await new Promise(r=>foreign.listen(0,'127.0.0.1',r));
  const external=`http://127.0.0.1:${foreign.address().port}`;
  const site=http.createServer((req,res)=>{
    siteCookies.push(req.headers.cookie??'');
    res.setHeader('Content-Type','text/html');
    res.end(`<main>blocked</main><script src="${external}/asset.js"></script>`);
  });
  await new Promise(r=>site.listen(0,'127.0.0.1',r));
  const baseURL=`http://127.0.0.1:${site.address().port}`;
  let browser;
  const variable='WPQA_NETWORK_TEST_STATE',previous=process.env[variable];
  try {
    browser=await chromium.launch({headless:true});
    process.env[variable]=JSON.stringify({cookies:[{name:'session',value:'private-site-secret',domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]});
    const config={baseURL,environment:'local',allowTestWrites:true,timeoutMs:1000};
    const check={kind:'browser-flow',suite:'delivery',options:{roleEnv:variable,steps:[{action:'goto',url:'/'},{action:'assertText',selector:'main',value:'blocked'}]}};
    await run({check,config,browser,token:'network-token-123'});
    assert.equal(received.length,0);
    check.options.allowedResourceOrigins=[external];check.options.steps[1].value='loaded';
    await run({check,config,browser,token:'network-token-123'});
    assert.ok(received.some(r=>r.url==='/asset.js'));
    assert.ok(received.every(r=>!r.cookie&&!r.authorization));
    check.options.allowedNavigationOrigins=[external];
    check.options.steps=[{action:'goto',url:external},{action:'assertText',selector:'main',value:'payment sandbox'}];
    await assert.rejects(run({check,config,browser,token:'network-token-123'}),/sandbox/);
    check.options.sandbox=true;
    await run({check,config,browser,token:'network-token-123'});
    assert.ok(received.every(r=>!r.cookie&&!r.authorization));
    check.options.steps=[{action:'goto',url:external+'/start'},{action:'goto',url:external+'/finish'},{action:'assertText',selector:'main',value:'session verified'},{action:'goto',url:'/'},{action:'assertText',selector:'main',value:'loaded'}];
    await run({check,config,browser,token:'network-token-123'});
    assert.ok(received.some(r=>r.url==='/finish'&&r.cookie==='payment=own-session'));
    assert.ok(received.every(r=>!r.cookie?.includes('private-site-secret')&&!r.cookie?.includes('poison')&&!r.authorization));
    assert.ok(received.filter(r=>r.url==='/asset.js').every(r=>!r.cookie));
    assert.ok(siteCookies.every(cookie=>cookie.includes('session=private-site-secret')&&!cookie.includes('payment=')&&!cookie.includes('poison=')));
    await assert.rejects(run({check,config:{...config,environment:'production'},browser,token:'network-token-123'}),/BLOCKED/);
  } finally {
    if(previous===undefined)delete process.env[variable];else process.env[variable]=previous;
    await browser?.close();
    await Promise.all([new Promise(r=>site.close(r)),new Promise(r=>foreign.close(r))]);
  }
});

test('browser flows require meaningful final assertion and sandbox commerce',()=> {
  assert.throws(()=>validate({kind:'browser-flow',suite:'delivery',options:{steps:[{action:'click',selector:'button'}]}}),/expectation/);
  assert.throws(()=>validate({kind:'browser-flow',suite:'commerce',options:{steps:[{action:'assertVisible',selector:'main'}]}}),/sandbox/);
  assert.throws(()=>validate({kind:'browser-flow',suite:'delivery',options:{steps:[{action:'evaluate',value:'evil'}]}}),/unknown/);
});
test('flow write actions are blocked before browser launch',async()=> {
  await assert.rejects(run({check:{kind:'browser-flow',suite:'delivery',options:{steps:[{action:'click',selector:'button'},{action:'assertText',selector:'main',value:'done'}]}},config:{environment:'production',allowTestWrites:true},token:'test-token-123'}),/BLOCKED/);
});
test('no-op adapter cannot pass independent post-operation state probe',async()=> {
  const dir=await mkdtemp(join(tmpdir(),'workflow-test-'));
  let state='version-before';
  const server=http.createServer((req,res)=>res.end(state));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const baseURL=`http://127.0.0.1:${server.address().port}`;
  const adapter=join(dir,'adapter.mjs');
  await writeFile(adapter,`import {writeFile} from 'node:fs/promises'; import {join} from 'node:path'; export async function execute({operation,token,runDir}) {await writeFile(join(runDir,'proof.txt'),token);return {performed:true,operation,evidence:['proof.txt']};}`);
  const check={kind:'operation-drill',suite:'operations',options:{adapter:'update',operation:'update',before:{url:'/',status:200,bodyIncludes:'version-before'},after:{url:'/',status:200,bodyIncludes:'version-after {{token}}'}}};
  const args={check,config:{baseURL,environment:'local',allowTestWrites:true,trustedAdapters:{update:adapter}},token:'test-token-123',runDir:dir,configDir:dir};
  try {await assert.rejects(run(args),/state marker missing/);} finally {await new Promise(resolve=>server.close(resolve)); await rm(dir,{recursive:true,force:true});}
});
test('real browser detects a wrong final expectation and duplicate submission mail',async()=> {
  let count=0;
  const token='workflow-token-123';
  const server=http.createServer(async(req,res)=> {
    if(req.url==='/send') {count++;res.end('ok');return;}
    if(req.url.startsWith('/api/v1/search')) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({messages:Array.from({length:count},(_,i)=>({ID:String(i)}))}));return;}
    if(req.url.startsWith('/api/v1/message')) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ID:'1',Subject:token,Text:token,To:[{Address:'qa@example.test'}],Attachments:[]}));return;}
    res.setHeader('Content-Type','text/html');
    res.end('<input type="file" onchange="document.querySelector(\'p\').textContent=this.files[0].name"><button onclick="fetch(\'/send\').then(()=>document.querySelector(\'p\').textContent=\'sent\')">send</button><p>ready</p>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const baseURL=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true});
  const config={baseURL,environment:'local',allowTestWrites:true,timeoutMs:500};
  const check={kind:'browser-flow',suite:'delivery',options:{steps:[{action:'goto',url:'/'},{action:'assertText',selector:'p',value:'wrong'}]}};
  try {
    const events=[];
    await assert.rejects(run({check,config,browser,token,record:e=>events.push(e)}),error=>{
      assert.match(error.message,/toHaveText/);
      assert.equal(error.qaEvidence.at(-1).passed,false);
      assert.equal(events.length,4);
      assert.ok(!JSON.stringify(events).includes('wrong'));
      return true;
    });
    check.options.steps=[{action:'goto',url:'/'},{action:'setInputFiles',selector:'input',name:'sample.txt',mimeType:'text/plain',value:'{{token}}'},{action:'assertText',selector:'p',value:'sample.txt'}];
    assert.equal((await run({check,config,browser,token})).steps.length,3);
    check.options.steps=[{action:'goto',url:'/'},{action:'click',selector:'button'},{action:'assertText',selector:'p',value:'sent'},{action:'click',selector:'button'},{action:'waitForMail',source:{url:baseURL},expected:{to:'qa@example.test',subject:'{{token}}',count:1,timeoutMs:1000,settleMs:200}}];
    await assert.rejects(run({check,config,browser,token}),/exceeds/);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
test('cron operations require scheduled suite and generated uploads reject local paths',()=> {
  const options={adapter:'cron',operation:'cron',before:{url:'/',status:200,bodyIncludes:'pending'},after:{url:'/',status:200,bodyIncludes:'complete {{token}}'}};
  validate({kind:'operation-drill',suite:'scheduled',options});
  assert.throws(()=>validate({kind:'operation-drill',suite:'operations',options}),/scheduled/);
  assert.throws(()=>validate({kind:'browser-flow',suite:'delivery',options:{steps:[{action:'setInputFiles',selector:'input',name:'C:\\secret.txt',mimeType:'text/plain',value:'fixture'},{action:'assertVisible',selector:'p'}]}}),/basename/);
});
test('UI saved named role JSON authenticates protected flow while anonymous is denied',async()=> {
  const dir=await mkdtemp(join(tmpdir(),'workflow-role-'));
  const server=http.createServer((req,res)=> {
    const authenticated=(req.headers.cookie??'').split(';').some(c=>c.trim()==='session=member-secret');
    res.writeHead(authenticated?200:403,{'Content-Type':'text/html'});
    res.end(authenticated?'<main>Private member data</main>':'<main>Access denied</main>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const baseURL=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true});
  const variable='WPQA_ROLE_MEMBER_STATE',previous=process.env[variable];
  try {
    const store=new ProjectStore(dir,{codec:(value)=>value});
    const state={cookies:[{name:'session',value:'member-secret',domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]};
    const id=store.save({config:{name:'Role test',baseURL,environment:'local',pages:[{id:'home',path:'/',canonical:baseURL+'/',indexable:false}]},auth:{roleCredentials:[{name:'member',browser:state}]}});
    process.env[variable]=store.prepare(id).env[variable];
    assert.equal(typeof JSON.parse(process.env[variable]),'object');
    const config=store.context(id).config;
    const check={kind:'browser-flow',suite:'membership',options:{steps:[{action:'goto',url:'/protected'},{action:'assertText',selector:'main',value:'Access denied'}]}};
    assert.equal((await run({check,config,browser,token:'role-token-123'})).roleConfigured,false);
    check.options.roleEnv=variable;check.options.steps[1].value='Private member data';
    assert.equal((await run({check,config,browser,token:'role-token-123'})).roleConfigured,true);
    process.env[variable]=JSON.stringify({...state,origins:[{origin:'https://other.test',localStorage:[]}]});
    await assert.rejects(run({check,config,browser,token:'role-token-123'}),/restricted to configured site/);
    process.env[variable]=JSON.stringify({...state,cookies:[{...state.cookies[0],domain:'other.test'}]});
    await assert.rejects(run({check,config,browser,token:'role-token-123'}),/restricted to configured site/);
  } finally {
    if(previous===undefined)delete process.env[variable];else process.env[variable]=previous;
    await browser.close();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});
  }
});
