import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium, request } from '@playwright/test';
import { validate, inspect, run } from '../lib/checks/read-only.mjs';
const config={baseURL:'http://localhost:8080',timeoutMs:3000};
const check=(kind,options)=>({id:'fixture',suite:kind.startsWith('seo-')||kind==='redirect'?'seo':kind==='performance-navigation'?'performance':kind==='compatibility-screen'?'compatibility':'accessibility',kind,options});
const response=body=>({body,status:200,headers:{},url:config.baseURL+'/'});
test('SEO canonical, OGP, structured data defects are detected',()=>{
  const c=check('seo-page',{path:'/',canonical:config.baseURL+'/',meta:{'og:title':'Example'},jsonLd:[{type:'Organization',properties:{name:'Example'}}]});
  const html='<link rel="canonical" href="/"><meta property="og:title" content="Example"><script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Example"}]}</script>';
  validate(c,config);assert.equal(inspect(c,response(html)).canonical,config.baseURL+'/');
  for(const bad of [html.replace('href="/"','href="/wrong"'),html.replace('content="Example"','content="wrong"'),html.replace('"name":"Example"','"name":"wrong"')])assert.throws(()=>inspect(c,response(bad)));
});
test('robots policy groups and explicit sitemap exclusions',()=>{
  const robots=check('seo-robots',{path:'/robots.txt',rules:[{userAgent:'Googlebot',directive:'disallow',value:'/private/'}]});
  assert.doesNotThrow(()=>inspect(robots,response('User-agent: *\nUser-agent: Googlebot\nDisallow: /private/')));
  assert.throws(()=>inspect(robots,response('User-agent: *\nDisallow: /private/\nUser-agent: Googlebot\nAllow: /')));
  const sitemap=check('seo-sitemap',{path:'/sitemap.xml',requiredUrls:['http://example.test/'],excludedUrls:['http://example.test/private']});
  assert.doesNotThrow(()=>inspect(sitemap,response('<urlset><url><loc>http://example.test/</loc></url></urlset>')));
  assert.throws(()=>inspect(sitemap,response('<urlset><url><loc>http://example.test/private</loc></url></urlset>')));
});
test('strict malformed options and suite rejection',()=>{
  for(const c of [check('redirect',{path:'/',status:200,location:'/'}),check('seo-page',{path:'/',meta:{},typo:true}),check('performance-navigation',{path:'/',samples:0,cache:'warm',budgets:{durationMs:1}}),check('compatibility-screen',{path:'/',engine:'opera',viewport:{width:100,height:100},visible:['h1']}),check('keyboard-sequence',{path:'/',steps:[{key:'Delete',focus:'input'}]}),check('seo-page',{path:'https://outside.test/',canonical:'https://outside.test/'})])assert.throws(()=>validate(c,config));
  assert.throws(()=>validate({...check('seo-page',{path:'/',canonical:config.baseURL}),suite:'security'},config));
});
test('HTTP redirect checks do not silently follow wrong mapping',async()=>{
  const server=http.createServer((req,res)=>{res.writeHead(301,{location:'/wrong'});res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const local={...config,baseURL:`http://127.0.0.1:${server.address().port}`};
  try {await assert.rejects(run({check:check('redirect',{path:'/',status:301,location:'/correct'}),config:local,requestFactory:request}));assert.equal((await run({check:check('redirect',{path:'/',status:301,location:'/wrong'}),config:local,requestFactory:request})).actual.location,local.baseURL+'/wrong');}finally{await new Promise(r=>server.close(r));}
});
test('real browser keyboard defects and navigation budget failures',async t=>{
  let browser;try{browser=await chromium.launch();}catch(e){t.skip(`Chromium unavailable: ${e.message.split('\n')[0]}`);return;}
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>Fixture</h1><button id="first">First</button><button id="second">Second</button>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const local={...config,baseURL:`http://127.0.0.1:${server.address().port}`};
  try {
    await run({check:check('keyboard-sequence',{path:'/',steps:[{key:'Tab',focus:'#first'},{key:'Tab',focus:'#second'}]}),config:local,browser});
    await assert.rejects(run({check:check('keyboard-sequence',{path:'/',steps:[{key:'Tab',focus:'#second'}]}),config:local,browser}),/focus differs/);
    const screen={path:'/',engine:'chromium',viewport:{width:800,height:600},visible:['h1'],text:[{selector:'h1',value:'Fixture'}]};
    let screenshots=0;await run({check:check('compatibility-screen',screen),config:local,attach:async(name,data)=>{assert(name.endsWith('.png'));assert(data.body.length>0);screenshots++;}});assert.equal(screenshots,1);
    await assert.rejects(run({check:check('compatibility-screen',{...screen,text:[{selector:'h1',value:'Wrong'}]}),config:local}),/Fixture/);
    const perf=await run({check:check('performance-navigation',{path:'/',samples:2,cache:'warm',budgets:{durationMs:30000,resourceCount:10}}),config:local,browser});assert.equal(perf.actual.samples.length,2);
    await assert.rejects(run({check:check('performance-navigation',{path:'/',samples:1,cache:'cold',budgets:{transferBytes:0}}),config:local,browser}),/exceeds/);
  }finally{await browser.close();await new Promise(r=>server.close(r));}
});
test('compatibility and keyboard refuse matching content on an external redirect',async t=>{
  let browser;try{browser=await chromium.launch();}catch(e){t.skip(e.message.split('\n')[0]);return;}
  let externalRequests=0;
  const external=http.createServer((req,res)=>{externalRequests++;res.end('<h1>Fixture</h1><button id="first">First</button>');});await new Promise(r=>external.listen(0,'127.0.0.1',r));
  const destination=`http://127.0.0.1:${external.address().port}/`;
  const server=http.createServer((req,res)=>{if(req.url==='/link'){res.setHeader('Content-Type','text/html');res.end(`<h1>Fixture</h1><a id="first" href="${destination}">First</a>`);}else{res.writeHead(302,{location:destination});res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const local={...config,baseURL:`http://127.0.0.1:${server.address().port}`};
  try {
    await assert.rejects(run({check:check('compatibility-screen',{path:'/',engine:'chromium',viewport:{width:800,height:600},visible:['h1']}),config:local}),/same origin/);
    await assert.rejects(run({check:check('keyboard-sequence',{path:'/',steps:[{key:'Tab',focus:'#first'}]}),config:local,browser}),/same origin/);
    await assert.rejects(run({check:check('keyboard-sequence',{path:'/link',steps:[{key:'Tab',focus:'#first'},{key:'Enter',visible:'h1'}]}),config:local,browser}));
    assert.equal(externalRequests,0,'external navigation must be blocked before the destination receives it');
  }finally{await browser.close();await Promise.all([server,external].map(s=>new Promise(r=>s.close(r))));}
});
