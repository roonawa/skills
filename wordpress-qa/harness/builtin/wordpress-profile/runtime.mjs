import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {journalIntent,journalUpdate,readJournal} from '../../lib/recovery.mjs';
import {ensure,readSettings,requireWrites,sameOrigin,parseSettings,serverTime,scheduleAt,pageCount,inventoryLinks,contactFields,assertOwned} from './helpers.mjs';

const kinds = new Set(['inventory','contact-schema','post-lifecycle','scheduled']);
async function journalDirectory(args) {
  if (typeof args.runDir === 'string' && path.isAbsolute(args.runDir)) return args.runDir;
  // Current journey arguments omit runDir; use the trusted runner's context file.
  try {
    const context = JSON.parse(await readFile(process.env.WPQA_CONTEXT,'utf8'));
    ensure(context.config.baseURL === args.config.baseURL && path.isAbsolute(context.runDir), 'BLOCKED: recovery context mismatch');
    return context.runDir;
  } catch { throw new Error('BLOCKED: durable runDir or runner context required for writes'); }
}

// Also handles an uncertain create response by finding only the exact owned marker.
// Never call shared recover() here: this session authenticates itself using saved state.
export async function cleanupOwned({api,entry,runDir,config,profile}) {
  requireWrites(config,profile);
  ensure(entry.site === new URL(config.baseURL).origin, 'BLOCKED: cleanup site mismatch');
  const query = new URLSearchParams({context:'edit',slug:entry.marker,per_page:'2'});
  for (const status of ['draft','pending','publish','private','future','trash']) query.append('status[]',status);
  const found = await api(entry.collection+'?'+query);
  ensure(found.status === 200 && Array.isArray(found.data) && found.data.length === 1, 'BLOCKED: cleanup lookup absent or ambiguous; recovery remains pending');
  const post = found.data[0];
  assertOwned(post,entry);
  const probe = await api(entry.collection+'/'+post.id+'?context=edit');
  ensure(probe.status === 200, 'BLOCKED: cleanup read failed');
  assertOwned(probe.data,{...entry,id:post.id});
  const deleted = await api(entry.collection+'/'+post.id+'?force=true','DELETE');
  ensure(deleted.status === 200 && deleted.data.deleted === true, 'BLOCKED: cleanup deletion unconfirmed');
  const absent = await api(entry.collection+'/'+post.id+'?context=edit');
  ensure(absent.status === 404, 'BLOCKED: cleanup absence unconfirmed');
  await journalUpdate(runDir,entry.marker,{id:post.id,state:'deleted'});
  return {id:post.id,marker:entry.marker,deleted:true};
}

export async function runProfile(kind,args) {
  ensure(kinds.has(kind), 'BLOCKED: unknown built-in journey');
  const {config,testInfo,attach = async()=>{},checkCancellation = ()=>{}} = args;
  const {profile,state,base} = readSettings(config);
  const writing = kind === 'post-lifecycle' || kind === 'scheduled';
  if (writing) requireWrites(config,profile);
  if (kind === 'contact-schema') ensure(profile.contactFormId !== null, 'BLOCKED: contactFormId must be supplied');
  const runDir = writing ? await journalDirectory(args) : null;
  if (writing) ensure(!(await readJournal(runDir)).some(e=>e.state === 'pending'), 'BLOCKED: pending recovery must be resolved before writing');
  testInfo?.setTimeout(kind === 'scheduled' ? 360000 : 240000);
  const {chromium} = await import('@playwright/test');
  let browser,context,entry,api;
  let failure;
  try {
    checkCancellation();
    browser = await chromium.launch();
    context = await browser.newContext({storageState:state,javaScriptEnabled:false,serviceWorkers:'block'});
    context.setDefaultTimeout(config.timeoutMs || 15000);
    const page = await context.newPage();
    // No script execution, inherited headers, tracing, external resources or redirects.
    await context.route('**/*',async route=>{
      const request = route.request();
      if (request.method() !== 'GET' || request.resourceType() !== 'document' || new URL(request.url()).origin !== base.origin) return route.abort();
      const response = await route.fetch({maxRedirects:0});
      try {
        if (response.status() >= 300 && response.status() < 400) return await route.abort();
        await route.fulfill({response});
      } finally { await response.dispose(); }
    });
    const admin = await page.goto(new URL(profile.adminPath,base).href);
    ensure(admin?.status() === 200 && await page.locator('#wpadminbar').count() === 1, 'BLOCKED: saved administrator session unavailable');
    const scripts = await page.locator('script:not([src])').allTextContents();
    const settings = parseSettings(scripts.join('\n'),base.href);
    const rest = new URL('wp/v2/',settings.root);
    api = async (route,method='GET',data) => {
      if (method !== 'GET') {
        ensure(writing, 'BLOCKED: read-only journey cannot write');
        requireWrites(config,profile);
      }
      const url = sameOrigin(route,base.href);
      ensure(url.pathname.startsWith(new URL(settings.root).pathname), 'BLOCKED: request outside REST root');
      const response = await context.request.fetch(url.href,{method,data,headers:{'X-WP-Nonce':settings.nonce},maxRedirects:0,timeout:config.timeoutMs || 15000});
      try {
        ensure(response.status() < 300 || response.status() >= 400, 'BLOCKED: REST redirect refused');
        ensure(response.headers()['content-type']?.includes('application/json'), 'BLOCKED: REST JSON required');
        return {status:response.status(),data:await response.json(),headers:response.headers()};
      } finally { await response.dispose(); }
    };
    const me = await api(new URL('users/me?context=edit',rest).href);
    ensure(me.status === 200 && Number.isSafeInteger(me.data.id) && me.data.id > 0 && me.data.roles?.includes('administrator'), 'BLOCKED: administrator authentication required');
    if (kind === 'inventory') {
      const types = await api(new URL('types?context=edit',rest).href);
      ensure(types.status === 200 && types.data && typeof types.data === 'object' && !Array.isArray(types.data), 'BLOCKED: REST types unavailable');
      const availableTypes = Object.keys(types.data),items = [],scopes = [];
      for (const type of ['post','page']) {
        const info = types.data[type];
        ensure(info && /^[a-zA-Z0-9_-]+$/.test(info.rest_base) && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(info.rest_namespace || 'wp/v2'), 'BLOCKED: standard REST collection unavailable');
        const collection = new URL((info.rest_namespace || 'wp/v2')+'/'+info.rest_base,settings.root);
        let pages = 1;
        for (let n=1;n<=pages;n++) {
          checkCancellation();
          const url = new URL(collection); url.search = new URLSearchParams({context:'edit',status:'publish',per_page:'100',page:String(n),_fields:'id,link,type'}).toString();
          const result = await api(url.href);
          ensure(result.status === 200 && Array.isArray(result.data) && result.data.length <= 100, 'BLOCKED: inventory page unavailable');
          pages = pageCount(result.headers['x-wp-totalpages']);
          items.push(...result.data.map(p=>({id:p.id,type,link:p.link})));
        }
        scopes.push({type,pages});
      }
      const coverage = inventoryLinks(items,config.pages || [],base.href);
      // Only paths are attached; do not copy unrestricted API response fields.
      await attach('cms-inventory',{availableTypes,scopes,count:items.length,items:items.map(p=>({id:p.id,type:p.type,path:p.link ? sameOrigin(p.link,base.href).pathname+new URL(p.link,base).search : null})),...coverage});
      ensure(!coverage.missing.length && !coverage.missingLinks.length, 'Published posts/pages have missing links or are absent from configured pages');
    } else if (kind === 'contact-schema') {
      const url = new URL('admin.php',new URL(profile.adminPath,base));
      url.search = new URLSearchParams({page:'wpcf7',post:String(profile.contactFormId),action:'edit'}).toString();
      const response = await page.goto(url.href);
      ensure(response?.status() === 200 && await page.locator('#wpcf7-form').count() === 1, 'BLOCKED: CF7 editor unavailable');
      const fields = contactFields(await page.locator('#wpcf7-form').inputValue());
      ensure(fields.length > 0, 'BLOCKED: CF7 schema contains no supported fields');
      await attach('contact-schema',{contactFormId:profile.contactFormId,fields,scope:'Schema only; no submission, notification or validation execution.'});
    } else {
      entry = {marker:'wpqa-'+randomUUID(),site:base.origin,rest:rest.pathname.replace(/\/$/,''),collection:new URL('posts',rest).pathname,owner:me.data.id,kind};
      await journalIntent(runDir,entry);
      checkCancellation();
      const made = await api(entry.collection,'POST',{title:entry.marker,slug:entry.marker,content:entry.marker+'-v1',status:'draft'});
      ensure(made.status === 201, 'Post creation failed; recovery required');
      assertOwned(made.data,entry);
      entry.id = made.data.id;
      await journalUpdate(runDir,entry.marker,{id:entry.id});
      const events = [];
      async function read(status,version) {
        const result = await api(entry.collection+'/'+entry.id+'?context=edit');
        ensure(result.status === 200, 'Post read-back failed'); assertOwned(result.data,entry);
        ensure(result.data.status === status && result.data.content.raw === entry.marker+'-'+version, 'Post read-back state/content mismatch');
        events.push({status,id:entry.id}); return result;
      }
      async function update(data) {
        checkCancellation();
        const response = await api(entry.collection+'/'+entry.id,'POST',data);
        ensure(response.status === 200, 'Post update failed'); assertOwned(response.data,entry);
        return response;
      }
      await read('draft','v1');
      if (kind === 'post-lifecycle') {
        await update({status:'publish'}); await read('publish','v1');
        await update({content:entry.marker+'-v2'}); await read('publish','v2');
        await update({status:'private'}); await read('private','v2');
        await attach(kind,{events,scope:'Authenticated REST read-back; public rendering and anonymous cache behavior are outside scope.'});
      } else {
        const clock = await read('draft','v1');
        const date = scheduleAt(clock.headers.date),at = Date.parse(date+'Z');
        await update({status:'future',date_gmt:date});
        const saved = await read('future','v1');
        ensure(saved.data.date_gmt === date && at-serverTime(saved.headers.date) >= 90000, 'Scheduled timestamp must remain at least 90 seconds ahead of server Date');
        const started = performance.now(); let published = false;
        while (performance.now()-started < 225000) {
          checkCancellation();
          // Visiting the site may trigger WP-Cron; this is still the same authenticated context.
          const tick = await context.request.get(base.href,{maxRedirects:0,timeout:config.timeoutMs || 15000}); await tick.dispose();
          const current = await api(entry.collection+'/'+entry.id+'?context=edit');
          ensure(current.status === 200, 'Scheduled read-back failed'); assertOwned(current.data,entry);
          const now = serverTime(current.headers.date);
          ensure(current.data.date_gmt === date, 'Scheduled timestamp changed');
          ensure(current.data.status === 'future' || (now >= at && current.data.status === 'publish'), 'Unexpected or premature scheduled publication');
          events.push({status:current.data.status,serverTime:current.headers.date});
          if (current.data.status === 'publish') { published = true; break; }
          await new Promise(resolve=>setTimeout(resolve,2000));
        }
        await attach('scheduled-state',{events,published,scheduledAt:date,scope:'Authenticated REST and WP-Cron observation; external scheduler health is not covered.'});
        ensure(published, 'Scheduled post did not publish within the observation window');
      }
    }
  } catch (error) {
    // Playwright errors may embed headers, HTML, URLs or saved-state values.
    failure = new Error(error.message?.startsWith('BLOCKED:') ? error.message : 'WordPress profile journey failed; inspect sanitized evidence and recovery journal');
  } finally {
    try {
      if (entry && api) await attach('cleanup',await cleanupOwned({api,entry,runDir,config,profile}));
    } catch {
      failure = new Error('BLOCKED: cleanup unconfirmed; durable recovery journal remains pending');
    } finally {
      try { await context?.close(); } finally { await browser?.close(); }
    }
  }
  if (failure) throw failure;
}
