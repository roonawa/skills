import test from 'node:test';
import assert from 'node:assert/strict';
import {run,validate} from '../lib/checks/wordpress.mjs';
import {preflight} from '../lib/preflight.mjs';

const baseURL='https://cache.test';
const state={cookies:[{domain:'cache.test',name:'wordpress_logged_in_fixture',value:'SECRET_COOKIE',path:'/',expires:-1}],origins:[]};
const options={headersEnv:'WPQA_CACHE_TEST_HEADERS',storageStateEnv:'WPQA_CACHE_TEST_STATE',restPath:'/blog/wp-json/wp/v2',pollIntervalMs:1,maxWaitMs:5};
const config={baseURL,environment:'staging',allowTestWrites:true,headersEnv:'WPQA_CACHE_TEST_PUBLIC'};
function env(t,headers){
  for(const [key,value] of Object.entries({WPQA_CACHE_TEST_HEADERS:headers,WPQA_CACHE_TEST_STATE:JSON.stringify(state),WPQA_CACHE_TEST_PUBLIC:JSON.stringify({Cookie:'password_protected_gate=GATE; wordpress_logged_in_bad=SECRET_BAD','X-WP-Nonce':'SECRET_PUBLIC_NONCE',Authorization:'SECRET_PUBLIC_AUTH'})})){
    const previous=process.env[key];t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});
    if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
}
function fixture({mode='',root=baseURL+'/blog/wp-json/'}={}){
  const calls=[],contexts=[];let post,deleted=false;
  const response=(status,data,html)=>({status:()=>status,json:async()=>data,text:async()=>html??JSON.stringify(data)});
  const requestFactory={newContext:async settings=>{
    const c={settings,disposed:false,dispose:async()=>{c.disposed=true;},fetch:async(url,request)=>{
      const u=new URL(url);calls.push({path:u.pathname,search:u.search,settings,...request});
      assert.equal(u.origin,baseURL);assert.equal(request.maxRedirects,0);
      if(u.pathname.endsWith('/wp-admin/')){
        assert.equal(request.method,'GET');assert.equal(settings.storageState.cookies[0].value,'SECRET_COOKIE');
        if(mode==='redirect')return response(302,{});
        const marker=mode==='login'?'<form id="loginform"></form>':'<div id="wpadminbar"></div>';
        return response(200,null,marker+(mode==='no-nonce'?'':`<script>var wpApiSettings = ${JSON.stringify({root,nonce:'SECRETNONCE'})};</script>`));
      }
      const api=u.pathname.includes('/wp-json/');
      if(api){
        if(settings.extraHTTPHeaders.Authorization==='ROLE_AUTH'){
          if(u.pathname.endsWith('/users/me'))return response(200,{id:8,roles:['subscriber']});
          return response(403,{code:request.method==='POST'?'rest_cannot_edit':'rest_cannot_read'});
        }
        assert.ok(settings.extraHTTPHeaders.Authorization==='REST_AUTH'||(settings.extraHTTPHeaders['X-WP-Nonce']==='SECRETNONCE'&&settings.storageState.cookies[0].value==='SECRET_COOKIE'));
        if(u.pathname.endsWith('/users/me'))return response(200,{id:7,roles:['administrator']});
        if(request.method==='DELETE'){deleted=true;post=null;return response(200,{deleted:true});}
        if(request.method==='POST'){
          if(!post){post={...request.data,id:12,author:7,link:baseURL+'/blog/test-post/'};return response(201,post);}
          Object.assign(post,request.data);return response(200,post);
        }
        return response(200,post);
      }
      if(settings.storageState)return response(200,null,post.content);
      assert.deepEqual(settings.extraHTTPHeaders,{Cookie:'password_protected_gate=GATE'});
      if(post.status!=='publish')return response(404,null,'not found');
      return response(200,null,mode==='stale'?post.content.replace('-v2','-v1'):post.content);
    }};contexts.push(c);return c;
  }};
  return {requestFactory,calls,contexts,get deleted(){return deleted;}};
}

test('cache derives nonce using read-only subdirectory admin HTML, isolates public gate, and cleans up',async t=>{
  env(t);const f=fixture(),records=[];
  const result=await run({check:{kind:'wp-cache',options},config,requestFactory:f.requestFactory,record:r=>records.push(r)});
  assert.equal(f.calls[0].path,'/blog/wp-admin/');assert.equal(f.calls[0].method,'GET');
  assert.equal(result.cleanedUp,true);assert.equal(f.deleted,true);
  assert.ok(result.phases.some(p=>p.phase==='cache-refreshed-three-reads'));
  assert.ok(f.contexts.every(c=>c.disposed));
  assert.doesNotMatch(JSON.stringify({result,records}),/SECRET|REST_AUTH|GATE/);
});

test('explicit REST credentials take priority and never read admin HTML',async t=>{
  env(t,JSON.stringify({Authorization:'REST_AUTH'}));const f=fixture({mode:'no-nonce'});
  const result=await run({check:{kind:'wp-cache',options},config,requestFactory:f.requestFactory});
  assert.equal(result.cleanedUp,true);assert.ok(f.calls.every(c=>!c.path.endsWith('/wp-admin/')));
});
test('authorization uses saved admin browser plus separately supplied role credentials and cleans up',async t=>{
 env(t);const key='WPQA_CACHE_ROLE_HEADERS',previous=process.env[key];process.env[key]=JSON.stringify({Authorization:'ROLE_AUTH'});
 t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});
 const f=fixture();const result=await run({check:{kind:'wp-authz',options:{...options,role:'subscriber',roleHeadersEnv:key,expectedRoles:['subscriber'],readStatus:403,readCode:'rest_cannot_read',updateStatus:403,updateCode:'rest_cannot_edit'}},config,requestFactory:f.requestFactory});
 assert.equal(result.cleanedUp,true);assert(f.deleted);assert(result.phases.some(x=>x.phase==='read'&&x.status===403));assert(result.phases.some(x=>x.phase==='update'&&x.status===403));
});
test('lifecycle reuses saved browser admin and public gate across draft, publish, update and cleanup',async t=>{
 env(t);const f=fixture();const result=await run({check:{kind:'wp-lifecycle',options},config,requestFactory:f.requestFactory});
 assert.equal(result.cleanedUp,true);assert(result.phases.some(x=>x.phase==='draft-preview'));assert(f.deleted);
});

for(const [label,settings] of [['login',{mode:'login'}],['missing nonce',{mode:'no-nonce'}],['redirect',{mode:'redirect'}],['foreign root',{root:'https://evil.test/wp-json/'}],['different site root',{root:baseURL+'/other/wp-json/'}]])test(`cache blocks ${label} before any write`,async t=>{
  env(t);const f=fixture(settings);
  await assert.rejects(run({check:{kind:'wp-cache',options},config,requestFactory:f.requestFactory}),/BLOCKED/);
  assert.ok(f.calls.every(c=>c.method==='GET'));assert.ok(f.contexts.every(c=>c.disposed));
});

test('failed cache freshness still deletes the owned post using nonce-authenticated client',async t=>{
  env(t);const f=fixture({mode:'stale'});
  await assert.rejects(run({check:{kind:'wp-cache',options},config,requestFactory:f.requestFactory}),/cache-refreshed/);
  assert.equal(f.deleted,true);assert.ok(f.contexts.every(c=>c.disposed));
});

test('malformed configured REST credentials fail closed rather than fall back',async t=>{
  env(t,'malformed');const f=fixture();
  await assert.rejects(run({check:{kind:'wp-cache',options},config,requestFactory:f.requestFactory}),/credential JSON/);
  assert.equal(f.calls.length,0);
});

test('preflight permits browser administrator fallback and retains role/write/public gate requirements',()=>{
  const check={id:'cache',kind:'wp-cache',options};
  const environment={WPQA_CACHE_TEST_STATE:JSON.stringify(state),WPQA_CACHE_TEST_PUBLIC:'{}'};
  assert.equal(preflight({...config,checks:[check]},environment).ready,true);
  assert.equal(preflight({...config,checks:[{...check,kind:'wp-lifecycle'}]},environment).ready,true);
  assert.equal(preflight({...config,checks:[{...check,kind:'wp-authz',options:{...options,role:'subscriber'}}]},environment).ready,false);
  assert.equal(preflight({...config,allowTestWrites:false,checks:[check]},environment).ready,false);
  assert.equal(preflight({...config,environment:'production',checks:[check]},environment).ready,false);
  assert.equal(preflight({...config,checks:[check]},{WPQA_CACHE_TEST_STATE:'{}'}).ready,false);
  assert.doesNotThrow(()=>validate({kind:'wp-cache',options:{adminPath:'/blog/wp-admin/'}}));
  for(const path of ['//evil.test/wp-admin/','/wp-admin/?action=logout','/../wp-admin/'])assert.throws(()=>validate({kind:'wp-cache',options:{adminPath:path}}));
  assert.doesNotThrow(()=>validate({kind:'wp-lifecycle',options:{adminPath:'/wp-admin/'}}));
});
