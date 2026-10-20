import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { request } from '@playwright/test';
import { run, validate } from '../lib/checks/wordpress.mjs';

async function fixture(bad='') {
  const posts=new Map(); let next=1; let writes=0;
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'); const admin=url.pathname.startsWith('/wp-json')?req.headers.authorization==='admin':req.headers.cookie?.includes('wordpress_logged_in_fixture=session')&&bad!=='session'; const role=req.headers.authorization==='role';
    let raw=''; for await(const c of req) raw+=c; const data=raw?JSON.parse(raw):{};
    const send=(s,b)=>{res.writeHead(s,{'content-type':'application/json'});res.end(JSON.stringify(b));};
    if(url.pathname.endsWith('/users/me')) return send(admin||role?200:401,admin?{id:1,roles:['administrator']}:{id:2,roles:['subscriber']});
    if(['/wp-json/wp/v2/posts','/wp-json/wp/v2/pages'].includes(url.pathname)&&req.method==='POST') {writes++; if(!admin)return send(403,{code:'rest_cannot_create'});const id=next++;posts.set(id,{...data,id,link:`http://127.0.0.1:${server.address().port}/?p=${id}`,author:1});return send(201,posts.get(id));}
    const id=Number(url.pathname.match(/(?:posts|pages)\/(\d+)/)?.[1]||url.searchParams.get('p')||url.pathname.match(/published\/(\d+)/)?.[1]); const p=posts.get(id);
    if(!p)return send(404,{code:'rest_post_invalid_id'});
    if(p.status==='future'&&(bad==='early'||Date.parse(p.date_gmt+'Z')<=Date.now())&&bad!=='cron')p.status='publish';
    if(req.method==='DELETE'){if(!admin)return send(403,{});posts.delete(id);return send(200,{deleted:true});}
    if(req.method==='POST'){if(!admin&&bad!=='authz'&&!(bad==='own'&&role&&p.author===2))return send(403,{code:'rest_cannot_edit'});Object.assign(p,data);if(bad==='permalink'&&p.status==='publish')p.link=`http://127.0.0.1:${server.address().port}/published/${p.id}`;return send(200,p);}
    if(bad==='permalink'&&p.status==='publish'&&url.searchParams.has('p')){res.writeHead(301,{location:p.link});return res.end();}
    if(!admin&&p.status!=='publish'&&bad!=='leak'&&!(bad==='own'&&role&&p.author===2))return send(403,{code:'rest_cannot_read'});
    if(url.pathname.startsWith('/wp-json'))return send(200,p);
    res.writeHead(200);res.end(bad==='stale'&&p.content.includes('-v2')?p.content.replace('-v2','-v1'):p.content);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {posts,get writes(){return writes;},baseURL:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};
}
process.env.WPQA_UI_ADMIN_HEADERS=JSON.stringify({Authorization:'admin'});
process.env.WPQA_ROLE_SUBSCRIBER_HEADERS=JSON.stringify({Authorization:'role'});
process.env.WPQA_UI_ADMIN_STATE=JSON.stringify({cookies:[{name:'wordpress_logged_in_fixture',value:'session',domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]});
const authz={role:'subscriber',expectedUserId:2,readStatus:403,updateStatus:403,readCode:'rest_cannot_read',updateCode:'rest_cannot_edit'};
for(const kind of ['wp-lifecycle','wp-cache','wp-scheduled','wp-authz'])test(`${kind} exercises behavior and removes its post`,async()=>{
  const f=await fixture();try{const result=await run({check:{kind,options:{pollIntervalMs:10,maxWaitMs:2500,scheduleDelayMs:1000,...(kind==='wp-authz'?authz:{})}},config:{baseURL:f.baseURL,environment:'staging',allowTestWrites:true,timeoutMs:2000},requestFactory:request});assert.equal(result.cleanedUp,true);assert.equal(f.posts.size,0);}finally{await f.close();}
});
for(const [kind,bad] of [['wp-lifecycle','leak'],['wp-cache','stale'],['wp-scheduled','cron'],['wp-scheduled','early'],['wp-scheduled','leak'],['wp-authz','authz']])test(`${kind} detects ${bad} and cleans up`,async()=>{
  const f=await fixture(bad);try{await assert.rejects(run({check:{kind,options:{pollIntervalMs:10,maxWaitMs:1200,scheduleDelayMs:1000,...(kind==='wp-authz'?authz:{})}},config:{baseURL:f.baseURL,environment:'staging',allowTestWrites:true,timeoutMs:2000},requestFactory:request}),/leaked|cache-refreshed|scheduled-published|authorization bypass|published early/);assert.equal(f.writes,1);assert.equal(f.posts.size,0);}finally{await f.close();}
});
test('production writes blocked before transport',async()=>{await assert.rejects(run({check:{kind:'wp-cache'},config:{environment:'production',allowTestWrites:true}}),/BLOCKED/);});
test('authz requires explicit expected denial and identity',()=>assert.throws(()=>validate({kind:'wp-authz',options:{role:'subscriber'}})));
test('HTML checks require browser state and reject foreign cookies before writes',async()=>{
 const f=await fixture();const saved=process.env.WPQA_UI_ADMIN_STATE;
 try{const args={check:{kind:'wp-cache'},config:{baseURL:f.baseURL,environment:'staging',allowTestWrites:true},requestFactory:request};
 delete process.env.WPQA_UI_ADMIN_STATE;await assert.rejects(run(args),/BLOCKED:.*state/i);
 process.env.WPQA_UI_ADMIN_STATE=JSON.stringify({cookies:[{domain:'.example.test',name:'session',value:'secret'}],origins:[]});await assert.rejects(run(args),/BLOCKED:.*state/i);assert.equal(f.writes,0);
 }finally{process.env.WPQA_UI_ADMIN_STATE=saved;await f.close();}
});

test('cancellation cleans created object independently of signal',async()=>{
 const f=await fixture(),controller=new AbortController();try{await assert.rejects(run({check:{kind:'wp-scheduled',options:{scheduleDelayMs:5000,pollIntervalMs:10,maxWaitMs:6000}},config:{baseURL:f.baseURL,environment:'staging',allowTestWrites:true},requestFactory:request,signal:controller.signal,record:({method,status})=>{if(method==='POST'&&status===201)controller.abort();}}),/cancelled/);assert.equal(f.posts.size,0);}finally{await f.close();}
});

test('custom collection own-object successful permission expectations',async()=>{
 const f=await fixture('own');try{const result=await run({check:{kind:'wp-authz',options:{role:'subscriber',expectedUserId:2,postType:'pages',ownership:'own',expectations:{read:{status:200},update:{status:200}}}},config:{baseURL:f.baseURL,environment:'staging',allowTestWrites:true},requestFactory:request});assert.equal(result.cleanedUp,true);assert.equal(f.posts.size,0);}finally{await f.close();}
});

test('lifecycle refreshes canonical link returned after publication',async()=>{const f=await fixture('permalink');try{const result=await run({check:{kind:'wp-lifecycle',options:{pollIntervalMs:10,maxWaitMs:500}},config:{baseURL:f.baseURL,environment:'staging',allowTestWrites:true},requestFactory:request});assert.equal(result.cleanedUp,true);assert.match(result.coverage.urls[0],/published/);}finally{await f.close();}});
