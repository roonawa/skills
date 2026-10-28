import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { journalIntent,journalUpdate } from '../recovery.mjs';
import {load} from 'cheerio';
import {parseSettings} from '../../builtin/wordpress-profile/helpers.mjs';
import {envHeaders} from '../mailpit.mjs';
export const kinds=['wp-lifecycle','wp-scheduled','wp-authz','wp-cache'];
export function validate(check) {
  assert(kinds.includes(check.kind),'Unknown WordPress check');
  const o=check.options||{};
  assert(o&&typeof o==='object'&&!Array.isArray(o),'options must be an object');
  const allowed=['adminPath','headersEnv','storageStateEnv','restPath','pollIntervalMs','maxWaitMs','scheduleDelayMs','postType','ownership','expectations','listingURLs','searchURLs','cacheRoles',...(check.kind==='wp-authz'?['role','roleHeadersEnv','expectedUserId','expectedRoles','readStatus','readCode','updateStatus','updateCode']:[])];
  for(const key of Object.keys(o))assert(allowed.includes(key),`Unknown WordPress option: ${key}`);
  for(const key of ['pollIntervalMs','maxWaitMs','scheduleDelayMs'])if(o[key]!==undefined)assert(Number.isInteger(o[key])&&o[key]>0&&o[key]<=600000,`${key} must be 1..600000`);
  for(const key of ['headersEnv','roleHeadersEnv','storageStateEnv'])if(o[key]!==undefined)assert(/^[A-Z_][A-Z0-9_]*$/.test(o[key]),`Invalid ${key}`);
  if(o.restPath!==undefined)assert(typeof o.restPath==='string'&&o.restPath.startsWith('/')&&!o.restPath.startsWith('//')&&!/[?#]/.test(o.restPath),'restPath must be a same-origin absolute path');
  if(o.adminPath!==undefined)assert(typeof o.adminPath==='string'&&/^\/(?:[a-zA-Z0-9_-]+\/)*wp-admin\/$/.test(o.adminPath),'Invalid adminPath');
  if(o.postType!==undefined)assert(/^[a-z][a-z0-9_-]*$/.test(o.postType),'Invalid postType');
  if(o.ownership!==undefined)assert(['own','other'].includes(o.ownership),'Invalid ownership');
  for(const key of ['listingURLs','searchURLs'])if(o[key]!==undefined)assert(Array.isArray(o[key])&&o[key].every(u=>typeof u==='string'&&u.startsWith('/')&&!u.startsWith('//')),'Invalid cache URLs');
  if(o.cacheRoles!==undefined)assert(Array.isArray(o.cacheRoles)&&o.cacheRoles.every(r=>r&&typeof r.role==='string'&&/^[A-Z_][A-Z0-9_]*$/.test(r.storageStateEnv)&&typeof r.canReadPrivate==='boolean'),'Invalid cacheRoles');
  if(o.expectations!==undefined)for(const phase of ['read','update'])assert(Number.isInteger(o.expectations[phase]?.status)&&o.expectations[phase].status>=200&&o.expectations[phase].status<500,'Invalid expectations');
  if(check.kind==='wp-authz'){
    assert(typeof o.role==='string'&&/^[a-z][a-z0-9_-]*$/.test(o.role),'role required');
    assert((Number.isInteger(o.expectedUserId)&&o.expectedUserId>0)||(Array.isArray(o.expectedRoles)&&o.expectedRoles.length>0&&o.expectedRoles.every(r=>typeof r==='string'&&r.length)),'expectedUserId or expectedRoles required');
    if(!o.expectations)for(const phase of ['read','update']){assert([401,403,404].includes(o[phase+'Status']),`${phase}Status required`);assert(typeof o[phase+'Code']==='string'&&o[phase+'Code'].length,`${phase}Code required`);}
  }
}
function headers(name){
  if(!process.env[name])throw new Error(`BLOCKED: credentials missing: ${name}`);
  let value;try{value=JSON.parse(process.env[name]);}catch{throw new Error(`BLOCKED: invalid credential JSON: ${name}`);}
  if(!value||Array.isArray(value)||typeof value!=='object'||!Object.keys(value).length||Object.values(value).some(v=>typeof v!=='string'))throw new Error(`BLOCKED: invalid credential headers: ${name}`);
  return value;
}
function browserState(name,base){
  if(!process.env[name])throw new Error(`BLOCKED: browser state missing: ${name}`);
  let state;try{state=JSON.parse(process.env[name]);}catch{throw new Error(`BLOCKED: browser state must contain JSON: ${name}`);}
  if(!state||!Array.isArray(state.cookies)||!Array.isArray(state.origins)||
    state.cookies.some(c=>!c||typeof c.domain!=='string'||c.domain.replace(/^\./,'')!==base.hostname||typeof c.name!=='string'||typeof c.value!=='string'||typeof c.path!=='string')||
    state.origins.some(o=>!o||o.origin!==base.origin||!Array.isArray(o.localStorage))||
    !state.cookies.some(c=>c.name.startsWith('wordpress_logged_in_')&&c.value))throw new Error(`BLOCKED: browser state must be authenticated and scoped to target origin: ${name}`);
  return state;
}
export async function run({check,config,requestFactory,runDir,signal,record=()=>{}}) {
  if(config.environment==='production'||config.allowTestWrites!==true)throw new Error('BLOCKED: WordPress mutations require non-production and allowTestWrites=true');
  validate(check);
  const o=check.options||{}, base=new URL(config.baseURL), rest=o.restPath||'/wp-json/wp/v2';
  const credentialEnv=o.headersEnv||'WPQA_UI_ADMIN_HEADERS';
  const browserFallback=!process.env[credentialEnv];
  let adminHeaders=browserFallback?null:headers(credentialEnv);
  const state=browserFallback||['wp-lifecycle','wp-cache'].includes(check.kind)?browserState(o.storageStateEnv||'WPQA_UI_ADMIN_STATE',base):undefined;
  const roleHeaders=check.kind==='wp-authz'?headers(o.roleHeadersEnv||`WPQA_ROLE_${o.role.toUpperCase().replaceAll('-','_')}_HEADERS`):null;
  const collection=rest+'/'+(o.postType||'posts');const abort=()=>{if(signal?.aborted)throw new Error('BLOCKED: cancelled WordPress check cancelled');};
  const contexts=[];let owned=null, failure, publicURL,admin;const result={kind:check.kind,phases:[],cleanedUp:false};
  const marker=`wpqa-${randomUUID()}`, first=`${marker}-v1`, second=`${marker}-v2`;
  async function context(extraHTTPHeaders={},storageState){let c;try{c=await requestFactory.newContext({extraHTTPHeaders,storageState,timeout:config.timeoutMs||30000,ignoreHTTPSErrors:false});}catch{throw new Error('BLOCKED: request context unavailable');}contexts.push(c);return c;}
  async function req(c,path,method='GET',data,cleanup=false){if(!cleanup)abort();
    const url=new URL(path,base);assert.equal(url.origin,base.origin,'Refusing cross-origin request');assert(!url.username&&!url.password,'URL credentials forbidden');
    let r;try{r=await c.fetch(url.href,{method,data,maxRedirects:0});}catch{throw new Error('BLOCKED: WordPress transport failed');}
    if(r.status()>=300&&r.status()<400)throw new Error('BLOCKED: redirect refused; configure canonical baseURL');
    await record({phase:'http',method,status:r.status()});return r;
  }
  async function json(r){try{return await r.json();}catch{throw new Error('WordPress returned invalid JSON');}}
  function useLink(post){const link=new URL(post.link,base);assert.equal(link.origin,base.origin,'Post link must remain same-origin');assert(!link.username&&!link.password,'Post link credentials forbidden');publicURL=link.href;return publicURL;}
  async function update(admin,data){const r=await req(admin,`${collection}/${owned.id}`,'POST',data);assert.equal(r.status(),200,'Post transition rejected');const p=await json(r);if(data.status)assert.equal(p.status,data.status,'Wrong post status');useLink(p);return p;}
  async function visible(c,url,text,absent){const r=await req(c,url);const body=await r.text();return r.status()===200&&body.includes(text)&&(!absent||!body.includes(absent));}
  async function hidden(anon,url,until){const r=await req(anon,url);const body=await r.text();if(until!==undefined&&Date.now()>=until)return;assert(!body.includes(marker),'Non-public content leaked anonymously');assert([200,401,403,404].includes(r.status()),'Unexpected anonymous visibility status');}
  async function poll(fn,label){const end=Date.now()+(o.maxWaitMs||(check.kind==='wp-scheduled'?(o.scheduleDelayMs||120000)+30000:30000));let count=0;do{abort();count++;if(await fn()){result.phases.push({phase:label,attempts:count});return;}await new Promise(r=>setTimeout(r,o.pollIntervalMs||1000));}while(Date.now()<end);assert.fail(`${label}: expected content/state not observed before timeout`);}
  try{
    const htmlAdmin=state?await context({},state):null;
    if(browserFallback){
      // Read only the authenticated admin document. No navigation, script
      // execution, redirects or nonce/cookie transfer to the public client.
      const inferred=rest.match(/^(.*\/)wp-json\/wp\/v2\/?$/)?.[1];
      const adminPath=o.adminPath||(inferred?inferred+'wp-admin/':null);
      if(!adminPath)throw new Error('BLOCKED: adminPath required for browser cache authentication');
      const r=await req(htmlAdmin,adminPath);
      if(r.status()!==200)throw new Error('BLOCKED: admin HTML authentication failed');
      const body=await r.text();
      if(Buffer.byteLength(body)>2*1024*1024)throw new Error('BLOCKED: admin HTML exceeds discovery limit');
      const $=load(body);
      if($('#wpadminbar').length!==1||$('#loginform').length)throw new Error('BLOCKED: admin HTML authentication failed');
      let settings;
      try{settings=parseSettings($('script:not([src])').map((_,el)=>$(el).text()).get().join('\n'),base.href);}catch{throw new Error('BLOCKED: admin REST settings unavailable');}
      if(new URL('wp/v2',settings.root).href.replace(/\/$/,'')!==new URL(rest,base).href.replace(/\/$/,''))throw new Error('BLOCKED: admin REST root differs from configured restPath');
      adminHeaders={'X-WP-Nonce':settings.nonce};
    }
    admin=await context(adminHeaders,browserFallback?state:undefined);
    const publicHeaders={};
    if(config.headersEnv){
      const supplied=envHeaders(config.headersEnv);
      const cookie=Object.entries(supplied).find(([key])=>key.toLowerCase()==='cookie')?.[1];
      if(cookie){const gate=cookie.split(';').map(v=>v.trim()).filter(v=>/^password_protected_[a-zA-Z0-9_-]+=[^;\r\n]*$/.test(v)&&!v.startsWith('password_protected_cookie_test='));if(gate.length)publicHeaders.Cookie=gate.join('; ');}
    }
    const anon=await context(publicHeaders);
    const meResponse=await req(admin,`${rest}/users/me?context=edit`);
    if(meResponse.status()!==200)throw new Error('BLOCKED: admin authentication positive control failed');
    const me=await json(meResponse);if(!Number.isInteger(me.id)||!me.roles?.includes('administrator'))throw new Error('BLOCKED: configured owner is not an administrator');
    const status=check.kind==='wp-lifecycle'?'draft':'private';
    await journalIntent(runDir,{marker,site:base.origin,rest,collection,owner:me.id,headersEnv:o.headersEnv||'WPQA_UI_ADMIN_HEADERS'});
    const created=await req(admin,`${collection}`,'POST',{title:marker,slug:marker,content:first,status});assert.equal(created.status(),201,'Test post creation failed');
    const p=await json(created);assert(Number.isInteger(p.id)&&p.id>0,'Invalid created post ID');owned={id:p.id};await journalUpdate(runDir,marker,{id:p.id});result.postId=p.id;
    assert.equal(p.status,status);assert.equal(p.author,me.id,'Created object owner mismatch');
    useLink(p);
    const warm=await req(admin,`${collection}/${p.id}?context=edit`);assert.equal(warm.status(),200,'Owner positive read failed');assert(JSON.stringify(await json(warm)).includes(first),'Owner read lost marker');
    if(check.kind==='wp-authz'){
      const role=await context(roleHeaders),who=await req(role,`${rest}/users/me?context=edit`);if(who.status()!==200)throw new Error('BLOCKED: role authentication positive control failed');
      const identity=await json(who);if(o.ownership==='own'){assert(Number.isInteger(identity.id)&&identity.id>0,'Role identity invalid');await journalUpdate(runDir,marker,{plannedOwner:identity.id,credentialOwner:me.id});const assigned=await update(admin,{author:identity.id});assert.equal(assigned.author,identity.id);await journalUpdate(runDir,marker,{owner:identity.id,credentialOwner:me.id,plannedOwner:null});}else assert.notEqual(identity.id,me.id,'Role must differ from owner');if(o.expectedUserId)assert.equal(identity.id,o.expectedUserId,'Role identity mismatch');if(o.expectedRoles)assert.deepEqual([...identity.roles].sort(),[...o.expectedRoles].sort(),'Role mismatch');
      for(const [phase,method,data] of [['read','GET',undefined],['update','POST',{content:second}]]){const r=await req(role,`${collection}/${p.id}`,method,data);const expected=o.expectations?.[phase]||{status:o[phase+'Status'],code:o[phase+'Code']};assert.equal(r.status(),expected.status,`${phase} authorization bypass`);const payload=await json(r);if(expected.code)assert.equal(payload.code,expected.code,`${phase} REST denial code mismatch`);result.phases.push({phase,status:r.status()});}
      const unchanged=await req(admin,`${collection}/${p.id}?context=edit`);assert.equal(unchanged.status(),200);const content=JSON.stringify(await json(unchanged));if((o.expectations?.update.status||o.updateStatus)>=400)assert(content.includes(first)&&!content.includes(second),'Denied update changed content');else assert(content.includes(second),'Allowed update did not persist');
    }else{
      if(check.kind==='wp-cache'){assert(await visible(htmlAdmin,publicURL,first),'Authenticated private warm failed');}
      const extraURLs=[...(o.listingURLs||[]),...(o.searchURLs||[])];for(const url of extraURLs)await hidden(anon,url);
      if(check.kind==='wp-cache')for(const role of o.cacheRoles||[]){const rc=await context({},browserState(role.storageStateEnv,base));if(role.canReadPrivate)assert(await visible(rc,publicURL,first),'Role private warm failed');else await hidden(rc,publicURL);await hidden(anon,publicURL);}
      result.coverage={postType:o.postType||'posts',urls:[publicURL,...extraURLs],roles:(o.cacheRoles||[]).map(r=>r.role)};
      await hidden(anon,publicURL);result.phases.push({phase:'anonymous-nonpublic-hidden'});
      if(check.kind==='wp-lifecycle'){const preview=new URL(publicURL);preview.searchParams.set('preview','true');assert(await visible(htmlAdmin,preview.href,first),'Authenticated draft preview missing marker');result.phases.push({phase:'draft-preview'});}
      if(check.kind==='wp-scheduled'){
        const scheduledAt=Math.ceil((Date.now()+(o.scheduleDelayMs||120000))/1000)*1000;const when=new Date(scheduledAt).toISOString().replace(/\.\d{3}Z$/,'');
        await update(admin,{status:'future',date_gmt:when});await hidden(anon,publicURL,scheduledAt);
        await poll(async()=>{const r=await req(admin,`${collection}/${p.id}?context=edit`);assert.equal(r.status(),200);const snapshot=await json(r);useLink(snapshot);const status=snapshot.status;if(Date.now()<scheduledAt){assert.equal(status,'future','Scheduled post published early');await hidden(anon,publicURL,scheduledAt);for(const url of extraURLs)await hidden(anon,url,scheduledAt);return false;}return status==='publish'&&await visible(anon,publicURL,first);},'scheduled-published');
      }else{
        await update(admin,{status:'publish'});await poll(async()=>{for(const url of [publicURL,...extraURLs])if(!await visible(anon,url,first))return false;return true;},'public-published');
        await update(admin,{content:second});await poll(async()=>{for(let i=0;i<3;i++)for(const url of [publicURL,...extraURLs])if(!await visible(anon,url,second,first))return false;return true;},'cache-refreshed-three-reads');
        await update(admin,{status:'private'});await hidden(anon,publicURL);for(const url of extraURLs)await hidden(anon,url);result.phases.push({phase:'private-hidden-after-publish'});
      }
    }
    if(result.coverage)result.coverage.urls=[publicURL,...(o.listingURLs||[]),...(o.searchURLs||[])];
  }catch(e){failure=e;}
  finally{
    if(owned){try{const r=await req(admin,`${collection}/${owned.id}?force=true`,'DELETE',undefined,true);assert.equal(r.status(),200,'Owned test post cleanup failed');assert.equal((await json(r)).deleted,true,'Deletion not confirmed');result.cleanedUp=true;await journalUpdate(runDir,marker,{state:"deleted"});}catch(e){failure=new Error(`${failure?failure.message+'; ':''}cleanup failed for owned post ${owned.id}: ${e.message}`);}}
    for(const c of contexts)await c.dispose().catch(()=>{});
  }
  if(failure)throw failure;
  return result;
}
