import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {request} from '@playwright/test';
import {discoverRegistration,validateProfile,registrationConfig} from '../ui/registration.mjs';
import {readSettings,requireWrites} from '../builtin/wordpress-profile/helpers.mjs';

const profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false,adminPath:'/wp-admin/',maxPages:20};
test('automation envelope validates consistently without altering policies or permissions',()=>{
  const automation={useObservedBaselines:false,additionalChecks:[]};
  const p=validateProfile({...profile,automation},'production');
  assert.deepEqual(p.automation,automation);assert.equal(p.writes,false);assert.equal(p.indexable,false);
  const config={baseURL:'https://fixture.test',environment:'production',allowTestWrites:false};
  const env={WPQA_UI_PROFILE:JSON.stringify(p),WPQA_UI_ADMIN_STATE:JSON.stringify({cookies:[],origins:[]})};
  assert.deepEqual(readSettings(config,env).profile.automation,automation);
  assert.throws(()=>requireWrites(config,p),/BLOCKED/);
  for(const bad of [null,{useObservedBaselines:'yes'},{module:'evil.mjs'},{additionalChecks:[{id:'coverage-roles',kind:'wp-authz',suite:'authz',options:{},module:'evil.mjs'}]}]){
    assert.throws(()=>validateProfile({...profile,automation:bad},'staging'),/自動取得/);
    assert.throws(()=>readSettings(config,{...env,WPQA_UI_PROFILE:JSON.stringify({...profile,automation:bad})}),/BLOCKED/);
  }
});

test('only discovery-dependent submit fields can be deferred; default validation remains strict',()=>{
  const pending={...profile,writes:true,submit:true,testEmail:'qa@example.test'};
  assert.doesNotThrow(()=>validateProfile(pending,'staging',{discoveryPending:true}));
  assert.throws(()=>validateProfile(pending,'staging'),/フォームID/);
  for(const patch of [{testEmail:undefined},{writes:false},{contactFormId:-1},{contactPath:'//evil.test/'},{contactNameField:'invalid name'}])assert.throws(()=>validateProfile({...pending,...patch},'staging',{discoveryPending:true}));
  assert.throws(()=>validateProfile(pending,'production',{discoveryPending:true}),/本番/);
  assert.throws(()=>validateProfile({...pending,bankOrder:true},'staging',{discoveryPending:true}),/商品・カート/);
  assert.doesNotThrow(()=>validateProfile({...pending,contactFormId:42,contactPath:'/contact/',contactNameField:'your-name',contactEmailField:'your-email',contactMessageField:'your-message'},'staging'));
});

test('registration enriches before strict validation and compiles without replacing explicit policies',()=>{
  const discovery={pages:[{path:'/'}],warnings:[],automation:{version:1,observedAt:new Date().toISOString(),admin:{reading:[],discussion:[],plugins:[],permalink:[{id:'permalink_structure',title:'Permalink',path:'/wp-admin/options-permalink.php',selector:'#permalink_structure',read:'value',expected:'/%year%/'}]},public:{forms:[{formId:42,path:'/contact/',fields:[{name:'your-name',type:'text',required:true},{name:'your-email',type:'email',required:true},{name:'your-message',type:'textarea',required:true}],formSelector:'#contact',submitSelector:'#submit',responseSelector:'#response',restPath:'/wp-json/contact-form-7/v1/contact-forms/42/feedback'}]}}};
  const input={...profile,writes:true,submit:true,testEmail:'qa@example.test',permalink:'/%postname%/'};
  const config=registrationConfig({name:'Fixture',baseURL:'https://fixture.test',environment:'staging',profile:input,discovery});
  assert.ok(config.journeys.some(x=>x.id==='profile-contact-submit'));
  assert.ok(config.checks.some(x=>x.id==='coverage-contact-errors'&&x.kind==='discovered-public'));
  assert.equal(config.admin.find(x=>x.id==='permalinks').expected,'/%postname%/');
  assert.equal(config.admin.find(x=>x.id==='indexing').expected,true);
  assert.equal(input.contactFormId,undefined);
  assert.throws(()=>registrationConfig({name:'Fixture',baseURL:'https://fixture.test',environment:'staging',profile:input,discovery:{pages:[{path:'/'}],warnings:[]}}),/フォームID/);
});

for(const hasNonce of [false,true])test(`registration collects automation with REST settings ${hasNonce?'available':'unavailable'}`,async t=>{
  const seen=[];let baseURL;
  const server=createServer((req,res)=>{
    seen.push({path:req.url,cookie:req.headers.cookie||'',nonce:req.headers['x-wp-nonce']||'',method:req.method});
    if(req.url.startsWith('/wp-json/')){res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url.includes('/pages?')?[{id:42,link:baseURL+'/contact/'}]:[]));return;}
    if(req.url.startsWith('/wp-admin/')){
      if(!req.headers.cookie?.includes('wordpress_logged_in_fixture=ADMIN_SECRET')){res.writeHead(403);res.end();return;}
      res.end('<div id="wpadminbar"></div>'+(req.url.endsWith('options-reading.php')?'<input name="show_on_front" value="posts" checked type="radio">':''));return;
    }
    if(req.url==='/robots.txt'){res.end('User-agent: *');return;}
    if(req.url==='/wp-sitemap.xml'){res.end('<urlset></urlset>');return;}
    res.end('<form method="get"><input name="s"><button type="submit">Search</button></form>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  baseURL='http://127.0.0.1:'+server.address().port;
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const state={cookies:[{name:'wordpress_logged_in_fixture',value:'ADMIN_SECRET',domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]};
  const api=await request.newContext({storageState:state});t.after(()=>api.dispose());
  let url='',closed=false,browserClosed=false;
  const page={url:()=>url,goto:async value=>{url=value;},locator:selector=>({count:async()=>selector==='#wpadminbar'?1:0,evaluateAll:async()=>hasNonce?`var wpApiSettings = ${JSON.stringify({root:baseURL+'/wp-json/',nonce:'RESTSECRET'})};`:''})};
  const context={request:api,route:async()=>{},newPage:async()=>page,close:async()=>{closed=true;}};
  const browser={newContext:async options=>{assert.equal(options.javaScriptEnabled,false);return context;},close:async()=>{browserClosed=true;}};
  const result=await discoverRegistration({baseURL,profile,state,launch:async()=>browser});
  assert.equal(result.authenticated,true);assert.equal(result.automation.version,1);
  assert.equal(result.automation.admin.reading[0].expected,'posts');
  assert.equal(result.automation.public.search.inputSelector,'form input[name="s"]');
  assert.equal(result.pages.length,hasNonce?2:1);
  assert.equal(seen.filter(r=>r.path.startsWith('/wp-json/')).length,hasNonce?2:0);
  assert.ok(seen.filter(r=>!r.path.startsWith('/wp-admin/')&&!r.path.startsWith('/wp-json/')).every(r=>!r.cookie.includes('ADMIN_SECRET')&&!r.nonce));
  assert.ok(seen.every(r=>r.method==='GET'));assert.ok(closed&&browserClosed);
  assert.doesNotMatch(JSON.stringify(result),/ADMIN_SECRET|RESTSECRET/);
});
