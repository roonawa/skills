import {load} from 'cheerio';

const LIMIT = 2 * 1024 * 1024;
const token = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const quoted = value => JSON.stringify(value);
const discussion = ['default_pingback_flag','default_ping_status','default_comment_status','require_name_email','comment_registration','close_comments_for_old_posts','show_comments_cookies_opt_in','thread_comments','page_comments','comments_notify','moderation_notify','comment_moderation','comment_previously_approved','comment_whitelist','show_avatars'];

/** Observations are regression baselines, never assertions of business correctness.
 * adminPage must be the caller's authenticated, JavaScript-disabled page.
 * adminContext may be a BrowserContext or its APIRequestContext. Neither is used publicly.
 * All returned paths exclude arbitrary query strings; no raw HTML, values from forms,
 * request headers, REST nonce, mail destinations or exception text are returned.
 */
export async function discoverAutomation({baseURL, profile = {}, adminPage, adminContext, publicHeaders = {}, pages = [], restSettings} = {}) {
  const out = {version:1, observedAt:new Date().toISOString(), admin:{reading:[],discussion:[],permalink:[],plugins:[]}, activePlugins:[], public:{forms:[],sitemaps:[]}, warnings:['Admin observations are regression baselines, not validated business requirements.'], sources:[]};
  let origin;
  try { const u = new URL(baseURL); if(!/^https?:$/.test(u.protocol) || u.username || u.password) throw Error(); origin=u.origin; }
  catch {out.warnings.push('Invalid base URL.'); return out;}
  const safeURL = value => {
    if(typeof value!=='string' || !value.trim())return null;
    try {const u=new URL(value, origin); if(u.origin!==origin || u.username || u.password || u.hash || u.search || /%(?:2e|2f|5c)|\\/i.test(u.pathname))return null; return u;} catch{return null;}
  };
  let site = safeURL(profile.sitePath || '/');
  if(site && (!site.pathname.endsWith('/') || /\/(?:wp-admin|wp-login\.php)(?:\/|$)/i.test(site.pathname)))site=null;
  const admin = safeURL(profile.adminPath || '/wp-admin/');
  const warn = message => {if(!out.warnings.includes(message))out.warnings.push(message);};
  const headers = {};
  // Only the public password gate cookie is transferable. Never forward WP login cookies.
  for(const [name,value] of Object.entries(publicHeaders || {})) {
    if(typeof value!=='string')continue;
    if(name.toLowerCase()==='cookie') {
      const gate=value.split(';').map(s=>s.trim()).filter(s=>/^password_protected_[a-zA-Z0-9_-]+=[^;\r\n]*$/.test(s) && !s.startsWith('password_protected_cookie_test='));
      if(gate.length)headers.Cookie=gate.join('; ');
    } else if(['accept','accept-language','user-agent'].includes(name.toLowerCase()) && !/[\r\n]/.test(value))headers[name]=value;
  }
  async function get(path, authenticated=false) {
    const source={path,status:'failed'};out.sources.push(source);
    try {
      const target=new URL(path,origin);
      if(target.origin!==origin || target.username || target.password)throw Error();
      if(authenticated) {
        const api=adminContext?.request || adminContext;
        if(!api?.get){source.status='unavailable';return null;}
        const r=await api.get(target.href,{maxRedirects:0,timeout:10000});
        try {
          source.status=r.status();
          if(source.status!==200 || (r.url && r.url()!==target.href))return null;
          const length=Number(r.headers?.()['content-length']); if(length>LIMIT){source.status='too-large';return null;}
          const body=await r.text();if(Buffer.byteLength(body)>LIMIT){source.status='too-large';return null;} return body;
        } finally {await r.dispose?.();}
      }
      const r=await fetch(target,{method:'GET',headers,redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(10000)});
      source.status=r.status;
      if(r.status!==200 || (r.url && r.url!==target.href)){await r.body?.cancel();return null;}
      if(Number(r.headers.get('content-length'))>LIMIT){await r.body?.cancel();source.status='too-large';return null;}
      const chunks=[];let size=0;
      for await (const chunk of r.body || []){size+=chunk.length;if(size>LIMIT){source.status='too-large';return null;}chunks.push(chunk);}
      return Buffer.concat(chunks).toString('utf8');
    } catch {source.status='failed';return null;}
    finally {if(source.status!==200)warn('Some discovery sources were unavailable; missing conditions were not inferred.');}
  }
  let authenticated=false;
  try {authenticated=!!adminPage && await adminPage.locator('#wpadminbar').count()===1 && new URL(adminPage.url()).origin===origin;}catch{}
  if(authenticated && admin && /^\/(?:[\w-]+\/)*wp-admin\/$/.test(admin.pathname)) {
    for(const [group,file] of [['reading','options-reading.php'],['discussion','options-discussion.php'],['permalink','options-permalink.php'],['plugins','plugins.php']]) {
      const path=admin.pathname+file, body=await get(path,true);if(!body)continue;
      const $=load(body);
      if($('#wpadminbar').length!==1 || $('#loginform').length){warn('An admin source did not confirm authentication.');continue;}
      const row=(id,selector,read,expected,title=id)=>out.admin[group].push({id,title,path,selector,read,expected});
      if(group==='reading') {
        const selected=$('input[name="show_on_front"]:checked');
        if(selected.length===1 && ['posts','page'].includes(selected.val()))row('show_on_front','input[name="show_on_front"]:checked','value',selected.val());
        for(const id of ['page_on_front','page_for_posts'])if($('#'+id).length===1 && /^\d+$/.test(String($('#'+id).val())))row(id,'#'+id,'value',String($('#'+id).val()));
      }
      if(group==='discussion')for(const id of discussion)if($(`input[type="checkbox"]#${id}`).length===1)row(id,`input[type="checkbox"]#${id}`,'checked',$('#'+id).is(':checked'));
      if(group==='permalink' && $('#permalink_structure').length===1){const v=$('#permalink_structure').val();if(typeof v==='string' && /^[\w%/.-]{0,200}$/.test(v))row('permalink_structure','#permalink_structure','value',v);}
      if(group==='plugins')$('tr.active[data-plugin]').each((_,el)=>{
        const plugin=$(el).attr('data-plugin'); if(!/^[\w-]+(?:\/[\w.-]+)?\.php$/.test(plugin || ''))return;
        const selector=`tr.active[data-plugin=${quoted(plugin)}] .plugin-title strong`;
        const label=$(selector),title=label.text().trim();
        if(label.length!==1 || !title || title.length>150 || /@|nonce|secret|password/i.test(title))return;
        const slug=plugin.includes('/')?plugin.split('/')[0]:plugin.replace(/\.php$/,'');
        if(out.admin.plugins.some(row=>row.id==='plugin-'+slug))return;
        out.activePlugins.push(slug);row('plugin-'+slug,selector,'text',title,title);
      });
    }
  } else warn('Admin authentication unavailable; no admin baseline was inferred.');
  const sitemapPaths=new Set();
  const addSitemap=value=>{const u=safeURL(value);if(u && /\.xml$/i.test(u.pathname) && !/\/wp-admin\//i.test(u.pathname) && sitemapPaths.size<5)sitemapPaths.add(u.pathname);};
  const publicPath=(value,explicit=false)=>{const u=safeURL(value);return u&&!/\/(?:wp-admin|wp-login\.php)(?:\/|$)/i.test(u.pathname)&&(explicit||!site||u.pathname.startsWith(site.pathname))?u.pathname:null;};
  const contactLike=path=>/contact|inquiry/i.test(path);
  const inventory=[...new Set((Array.isArray(pages)?pages:[]).map(p=>publicPath(typeof p==='string'?p:p?.path)).filter(Boolean))];
  const explicit=publicPath(profile.contactPath,true);
  const paths = [...new Set([site?.pathname,explicit,...inventory.filter(contactLike),...inventory.filter(p=>!contactLike(p))].filter(Boolean))].slice(0,11);
  const protectedPaths=new Set([site?.pathname,explicit,...paths.filter(contactLike)].filter(Boolean));
  const visited=new Set();
  // Explicit form selection takes a slot before the bounded inventory, even when
  // its URL appears after the first ten pages. Never rewrite that user input.
  for(let index=0;index<paths.length;index++) {
    const path=paths[index];visited.add(path);
    const body=await get(path);if(!body)continue;
    const $=load(body);
    if($('#loginform,[name="password_protected_pwd"]').length){warn('A public source returned an authentication page.');continue;}
    if(path===site?.pathname)$('a[href]').slice(0,1000).each((_,el)=>{
      let candidate;try{candidate=publicPath(new URL($(el).attr('href'),new URL(path,origin)).href);}catch{return;}
      if(!candidate||!contactLike(candidate)||paths.includes(candidate))return;
      if(paths.length>=11){
        const replace=paths.findLastIndex(p=>!visited.has(p)&&!protectedPaths.has(p));
        if(replace<0)return;
        paths.splice(replace,1);
      }
      const insert=paths.findIndex(p=>!visited.has(p)&&!protectedPaths.has(p));
      paths.splice(insert<0?paths.length:insert,0,candidate);protectedPaths.add(candidate);
    });
    $('link[rel~="sitemap"][href]').each((_,el)=>{
      try{addSitemap(new URL($(el).attr('href'),new URL(path,origin)).href);}catch{}
    });
    const exact = selector => $(selector).length===1;
    $('form').each((_,el)=>{
      const form=$(el), wrapper=form.closest('.wpcf7'), id=wrapper.attr('id');
      const match=/^wpcf7-f(\d+)-[\w-]+$/.exec(id || '');
      if(!match || !exact('#'+id+' form') || !form.hasClass('wpcf7-form'))return;
      const formId=Number(match[1]);if(!Number.isSafeInteger(formId)||formId<1)return;
      const formSelector='#'+id+' form', fields=[];
      form.find('input,select,textarea').each((_,field)=>{
        const f=$(field),type=(f.attr('type') || (field.tagName==='input'?'text':field.tagName)).toLowerCase(),name=f.attr('name');
        if(!token(name) || !['text','email','tel','url','number','date','checkbox','radio','select','textarea','file'].includes(type))return;
        fields.push({name,type,required:f.is('[required]') || f.attr('aria-required')==='true' || f.hasClass('wpcf7-validates-as-required')});
      });
      // REST settings are only a routing hint; their nonce never enters public requests or output.
      let root=safeURL(restSettings?.root || (site?.pathname || '/')+'wp-json/');
      const restPath=root && /\/wp-json\/$/.test(root.pathname)?root.pathname+`contact-form-7/v1/contact-forms/${formId}/feedback`:undefined;
      const submitSelector=formSelector+' .wpcf7-submit',responseSelector='#'+id+' .wpcf7-response-output';
      out.public.forms.push({path,formId,formSelector,fields,...(restPath?{restPath}:{}),...(exact(submitSelector)?{submitSelector}:{}),...(exact(responseSelector)?{responseSelector}:{})});
    });
    if(!out.public.search) {
      const input=$('form input[name="s"]');
      if(input.length===1){const form=input.closest('form'),action=safeURL(form.attr('action')||path);
        if((form.attr('method')||'get').toLowerCase()==='get' && action){
          const inputSelector='form input[name="s"]',formSelector='form:has(input[name="s"])',submitSelector=formSelector+' :is(button[type="submit"],input[type="submit"],button:not([type]))';
          out.public.search={path,actionPath:action.pathname,inputSelector,formSelector,...(exact(submitSelector)?{submitSelector}:{})};
          for(const selector of ['button[aria-label="検索を開く"]','button[aria-label="検索"]','button[aria-label="Open search"]','button[aria-label="Search"]'])if(exact(selector)){out.public.search.openSelector=selector;break;}
        }
      }
    }
    if(!out.public.menu)$('button[aria-controls],button[data-onclick="toggleMenu"]').each((_,el)=>{
      if(out.public.menu)return;
      const button=$(el),target=button.attr('aria-controls');
      if(token(target) && exact('#'+target) && $('#'+target).is('nav,[role="navigation"],.p-spMenu') && ['true','false'].includes(button.attr('aria-expanded'))){
        const openSelector=`button[aria-controls=${quoted(target)}]`;
        if(exact(openSelector))out.public.menu={path,openSelector,menuSelector:'#'+target};
      } else if(button.attr('data-onclick')==='toggleMenu' && exact('button[data-onclick="toggleMenu"]') && exact('#sp_menu.p-spMenu'))out.public.menu={path,openSelector:'button[data-onclick="toggleMenu"]',menuSelector:'#sp_menu.p-spMenu'};
    });
    if(!out.public.menu){
      const openSelector='button[data-onclick="toggleMenu"][aria-label="メニューボタン"]';
      // SWELL can have separate open/close toggles. Require a unique labelled
      // opener and the known panel; only publish state metadata seen in HTML.
      if(exact(openSelector) && exact('#sp_menu.p-spMenu')){
        const state=$('html').attr('data-spmenu');
        const closeSelector='button[data-onclick="toggleMenu"][aria-label="メニューを閉じる"]';
        out.public.menu={path,openSelector,menuSelector:'#sp_menu',...(exact(closeSelector)?{closeSelector}:{}),...(['opened','closed'].includes(state)?{stateSelector:'html',stateAttribute:'data-spmenu',openedValue:'opened',closedValue:'closed'}:{})};
      }
    }
  }
  if(!out.public.menu)warn('No unambiguous public menu control and target were verified; selectors were not guessed.');
  const robots=await get('/robots.txt');
  if(robots && !/<html|<!doctype/i.test(robots)) {
    out.public.robots={path:'/robots.txt'};
    for(const line of robots.split(/\r?\n/)){const match=/^sitemap:\s*(\S+)\s*$/i.exec(line);if(match)addSitemap(match[1]);}
  }
  sitemapPaths.add((site?.pathname||'/')+'wp-sitemap.xml');
  sitemapPaths.add((site?.pathname||'/')+'sitemap_index.xml');
  sitemapPaths.add((site?.pathname||'/')+'sitemap.xml');
  for(const path of sitemapPaths){const body=await get(path);if(!body)continue;const $=load(body,{xmlMode:true});const root=$.root().children();if(root.length===1 && ['sitemapindex','urlset'].includes(root[0].tagName))out.public.sitemaps.push({path});}
  out.activePlugins=[...new Set(out.activePlugins)];
  return out;
}
