import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {runProfile} from '../builtin/wordpress-profile/runtime.mjs';
const scratch=await fs.mkdtemp(new URL('../.selftest/profile-render-',import.meta.url));
let origin,post=null,stale=false,reads=0;
const server=createServer(async(req,res)=>{
 const u=new URL(req.url,origin);res.setHeader('Content-Type','application/json');
 const json=(value,status=200)=>{res.statusCode=status;res.end(JSON.stringify(value));};
 if(u.pathname==='/wp-admin/') {res.setHeader('Content-Type','text/html');res.end(`<div id="wpadminbar"></div><script>var wpApiSettings = {"root":"${origin}/wp-json/","nonce":"abc123"};</script>`);return;}
 if(u.pathname==='/wp-admin/admin.php'){res.setHeader('Content-Type','text/html');res.end('<textarea id="wpcf7-form">[text* your-name][email* your-email][textarea* your-message][acceptance agree]</textarea>');return;}
 if(u.pathname==='/wp-json/wp/v2/users/me')return json({id:3,roles:['administrator']});
 if(u.pathname==='/wp-json/wp/v2/types')return json({post:{rest_base:'posts'},page:{rest_base:'pages'},custom:{rest_base:'custom'}});
 if(u.pathname==='/wp-json/wp/v2/posts'&&req.method==='POST'){
  let body='';for await(const chunk of req)body+=chunk;const v=JSON.parse(body);
  post={...v,id:7,author:3,title:{raw:v.title},content:{raw:v.content},link:origin+'/post/7'};return json(post,201);
 }
 if(u.pathname==='/wp-json/wp/v2/posts/7'){
  if(!post)return json({},404);
  if(req.method==='DELETE'){post=null;return json({deleted:true});}
  if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;const v=JSON.parse(body);if(v.content)post.content={raw:v.content};if(v.status)post.status=v.status;}
  return json(post);
 }
 if(u.pathname==='/wp-json/wp/v2/posts'&&u.searchParams.has('slug'))return json(post?[post]:[]);
 if(u.pathname.startsWith('/wp-json/wp/v2/')){res.setHeader('X-WP-TotalPages','1');return json(u.pathname.endsWith('/custom')?[{id:99,link:origin+'/custom/99',type:'custom'}]:[]);}
 if(u.pathname==='/post/7'){reads++;res.setHeader('Content-Type','text/html');res.end(`<html><title>Post</title><body>${stale?'old body':post?.content.raw}</body></html>`);return;}
 res.setHeader('Content-Type','text/html');res.end('<html><title>fixture</title><body>fixture</body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
const config={baseURL:origin,environment:'local',allowTestWrites:true,timeoutMs:3000,pages:[{path:'/custom/99'}]};
const profile={writes:true,contactFormId:31,contactNameField:'your-name',contactEmailField:'your-email',contactMessageField:'your-message',contactConsentField:'agree',interactions:{inventory:{postTypes:['post','page','custom']}}};
const oldProfile=process.env.WPQA_UI_PROFILE,oldState=process.env.WPQA_UI_ADMIN_STATE;
process.env.WPQA_UI_PROFILE=JSON.stringify(profile);process.env.WPQA_UI_ADMIN_STATE=JSON.stringify({cookies:[],origins:[]});
try{
 const evidence=[];const args={config,runDir:scratch,attach:async(name,data)=>evidence.push({name,data})};
 await runProfile('inventory',args);assert(evidence.find(e=>e.name==='cms-inventory').data.scopes.some(s=>s.type==='custom'));
 await runProfile('contact-schema',args);assert.equal(evidence.find(e=>e.name==='contact-schema').data.missing.length,0);
 await runProfile('post-lifecycle',args);assert.equal(reads,4);assert.equal(post,null,'owned post cleaned');
 stale=true;await assert.rejects(runProfile('post-lifecycle',args));assert.equal(post,null,'render failure also cleans owned post');
 console.log('Custom inventory, CF7 schema, published rendering and failure cleanup passed');
}finally{
 if(oldProfile===undefined)delete process.env.WPQA_UI_PROFILE;else process.env.WPQA_UI_PROFILE=oldProfile;
 if(oldState===undefined)delete process.env.WPQA_UI_ADMIN_STATE;else process.env.WPQA_UI_ADMIN_STATE=oldState;
 await new Promise(r=>server.close(r));
}
