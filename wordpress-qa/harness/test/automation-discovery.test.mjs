import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverAutomation} from '../ui/automation-discovery.mjs';

const baseURL='https://example.test';
test('automatic contact links remain inside the registered subsite',async t=>{
 const {requests}=await run(t,{profile:{sitePath:'/site/'},pages:[{path:'/other/contact'}],publicFixture:{'/site/':'<a href="/other/contact">Other site</a><a href="/site/contact">Contact</a>','/site/contact':'<html></html>'}});
 assert(!requests.some(r=>r.url===baseURL+'/other/contact'));
 assert(requests.some(r=>r.url===baseURL+'/site/contact'));
});
const adminPage={url:()=>baseURL+'/wp-admin/',locator:()=>({count:async()=>1})};
const auth='<div id="wpadminbar"></div>';
const fixture={
  '/wp-admin/options-reading.php':auth+'<input name="show_on_front" type="radio" value="page" checked><select id="page_on_front"><option selected value="12">Secret page title</option></select><select id="page_for_posts"><option selected value="0">None</option></select>',
  '/wp-admin/options-discussion.php':auth+'<input id="default_comment_status" type="checkbox" checked><input id="require_name_email" type="checkbox"><input name="_wpnonce" value="RAW_ADMIN_NONCE">',
  '/wp-admin/options-permalink.php':auth+'<input id="permalink_structure" value="/%postname%/">',
  '/wp-admin/plugins.php':auth+'<table><tr class="active" data-plugin="contact-form-7/wp-contact-form-7.php"><td class="plugin-title"><strong>Contact Form 7</strong><a href="?action=deactivate&_wpnonce=RAW_ACTION_SECRET">Deactivate</a></td></tr><tr data-plugin="inactive/plugin.php"><td class="plugin-title"><strong>Inactive</strong></td></tr></table>',
  '/':`<button aria-label="検索を開く">Search</button><form method="get" action="/"><input name="s" value="RAW_SEARCH_VALUE"><button type="submit">Go</button></form>
    <button aria-controls="mobile-menu" aria-expanded="false">Menu</button><nav id="mobile-menu"></nav>
    <div class="wpcf7" id="wpcf7-f42-p1-o1"><form class="wpcf7-form">
    <input name="your-name" required value="RAW_PERSONAL_NAME"><input type="email" name="your-email" aria-required="true" value="private@example.test">
    <textarea name="your-message" class="wpcf7-validates-as-required">RAW_MESSAGE</textarea><input name="your-password" type="password" value="RAW_PASSWORD">
    <input name="_wpnonce" type="hidden" value="RAW_HIDDEN_NONCE"><input name="_wpcf7" type="hidden" value="42">
    <input type="submit" class="wpcf7-submit"><div class="wpcf7-response-output"></div></form></div>`,
  '/robots.txt':'User-agent: *\nSitemap: https://example.test/sitemap_index.xml\nSitemap: https://evil.test/stolen.xml',
  '/sitemap_index.xml':'<?xml version="1.0"?><sitemapindex></sitemapindex>',
  '/wp-sitemap.xml':'<sitemapindex></sitemapindex>',
};
async function run(t,{publicFixture=fixture,adminFixture=fixture,page=adminPage,...args}={}) {
  const requests=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const u=new URL(url);requests.push({kind:'public',url:u.href,...options});
    const entry=publicFixture[u.pathname];if(entry instanceof Error)throw entry;
    if(entry instanceof Response)return entry;
    return new Response(entry || '',{status:entry?200:404});
  });
  const api={get:async(url,options)=>{
    const path=new URL(url).pathname;requests.push({kind:'admin',url,...options});
    const body=adminFixture[path];if(body instanceof Error)throw body;
    if(body && typeof body==='object')return body;
    return {status:()=>body?200:403,headers:()=>({}),url:()=>url,text:async()=>body,dispose:async()=>{}};
  }};
  const result=await discoverAutomation({baseURL,adminPage:page,adminContext:{request:api},...args});
  return {result,requests};
}

test('discovers exact admin baselines and public conditions without retaining secrets',async t=>{
  const {result,requests}=await run(t,{restSettings:{root:baseURL+'/wp-json/',nonce:'RAW_REST_NONCE'},publicHeaders:{Cookie:'wordpress_logged_in_123=RAW_ADMIN_COOKIE; password_protected_gate=PUBLIC_GATE','X-WP-Nonce':'RAW_HEADER_NONCE',Authorization:'RAW_AUTH'}});
  assert.equal(result.version,1);assert.ok(Date.parse(result.observedAt));
  assert.equal(result.admin.reading.length,3);
  assert.equal(result.admin.reading[0].expected,'page');
  assert.deepEqual(result.admin.discussion.map(x=>x.expected),[true,false]);
  assert.equal(result.admin.permalink[0].expected,'/%postname%/');
  assert.deepEqual(result.activePlugins,['contact-form-7']);
  assert.equal(result.admin.plugins[0].selector,'tr.active[data-plugin="contact-form-7/wp-contact-form-7.php"] .plugin-title strong');
  assert.equal(result.admin.plugins[0].read,'text');
  assert.match(result.warnings[0],/regression baselines/);
  const form=result.public.forms[0];assert.equal(form.formId,42);
  assert.equal(form.restPath,'/wp-json/contact-form-7/v1/contact-forms/42/feedback');
  assert.deepEqual(form.fields,[{name:'your-name',type:'text',required:true},{name:'your-email',type:'email',required:true},{name:'your-message',type:'textarea',required:true}]);
  assert.equal(result.public.search.openSelector,'button[aria-label="検索を開く"]');
  assert.equal(result.public.menu.menuSelector,'#mobile-menu');
  assert.equal(result.public.sitemaps.length,2);
  assert.doesNotMatch(JSON.stringify(result),/RAW_|private@|Secret page title|PUBLIC_GATE|evil\.test/);
  for(const r of requests){assert.equal(new URL(r.url).origin,baseURL);if(r.kind==='admin')assert.equal(r.maxRedirects,0);else{assert.equal(r.method,'GET');assert.equal(r.redirect,'manual');assert.equal(r.credentials,'omit');assert.deepEqual(r.headers,{Cookie:'password_protected_gate=PUBLIC_GATE'});}}
});

test('malformed and missing authentication never becomes an admin baseline',async t=>{
  const {result,requests}=await run(t,{page:{url:()=> 'https://evil.test/wp-admin/',locator:()=>({count:async()=>1})}});
  assert.equal(requests.filter(x=>x.kind==='admin').length,0);
  assert.ok(Object.values(result.admin).every(a=>a.length===0));
});

test('login documents and partial errors are isolated and error text is omitted',async t=>{
  const {result}=await run(t,{adminFixture:{...fixture,'/wp-admin/options-reading.php':'<form id="loginform"><input value="RAW_LOGIN"></form>','/wp-admin/options-discussion.php':new Error('RAW_EXCEPTION_TOKEN')},publicFixture:{...fixture,'/robots.txt':new Error('RAW_NETWORK_SECRET')}});
  assert.deepEqual(result.admin.reading,[]);assert.deepEqual(result.admin.discussion,[]);
  assert.equal(result.admin.plugins.length,1);assert.equal(result.public.forms.length,1);
  assert.equal(result.sources.find(s=>s.path==='/robots.txt').status,'failed');
  assert.doesNotMatch(JSON.stringify(result),/RAW_/);
});

test('rejects foreign pages, query action links and unsafe REST roots; bounds pages',async t=>{
  const {result,requests}=await run(t,{pages:[{},null,{path:'https://evil.test/p'},{path:'/wp-admin/plugins.php'},{path:'/?action=delete&_wpnonce=RAW_SECRET'},...Array.from({length:30},(_,i)=>({path:'/page-'+i}))],restSettings:{root:'https://evil.test/wp-json/',nonce:'RAW_NONCE'}});
  assert.equal(requests.filter(r=>r.kind==='public' && /^\/page-/.test(new URL(r.url).pathname)).length,10);
  assert.equal(result.public.forms[0].restPath,undefined);
  assert.ok(requests.every(r=>!r.url.includes('RAW_') && !r.url.includes('evil.test')));
});

test('redirects are not followed and oversized public documents are discarded',async t=>{
  const {result,requests}=await run(t,{publicFixture:{'/':new Response('',{status:302,headers:{location:'https://evil.test/?RAW_SECRET'}}),'/robots.txt':new Response('x',{headers:{'content-length':String(3*1024*1024)}})}});
  assert.deepEqual(result.public.forms,[]);assert.equal(result.public.robots,undefined);
  assert.equal(result.sources.find(s=>s.path==='/').status,302);
  assert.equal(result.sources.find(s=>s.path==='/robots.txt').status,'too-large');
  assert.ok(requests.every(r=>new URL(r.url).origin===baseURL));
});

test('ambiguous or unverified controls are not guessed; subpath REST is preserved',async t=>{
  const {result}=await run(t,{profile:{sitePath:'/blog/'},publicFixture:{'/blog/':fixture['/'].replace('aria-controls="mobile-menu"','aria-controls="missing"')+'<form><input name="s"></form>','/robots.txt':'User-agent: *','/blog/wp-sitemap.xml':'<urlset></urlset>'}});
  assert.equal(result.public.menu,undefined);assert.equal(result.public.search,undefined);
  assert.equal(result.public.forms[0].restPath,'/blog/wp-json/contact-form-7/v1/contact-forms/42/feedback');
  assert.deepEqual(result.public.sitemaps,[{path:'/blog/wp-sitemap.xml'}]);
});

test('authenticated requests stop at redirects and reject foreign response URLs',async t=>{
  const redirect={status:()=>302,headers:()=>({location:'https://evil.test/RAW_SECRET'}),url:()=>baseURL+'/wp-admin/options-reading.php',text:async()=>{throw Error('must not read');},dispose:async()=>{}};
  const foreign={status:()=>200,headers:()=>({}),url:()=> 'https://evil.test/options-discussion.php',text:async()=>fixture['/wp-admin/options-discussion.php'],dispose:async()=>{}};
  const {result,requests}=await run(t,{adminFixture:{...fixture,'/wp-admin/options-reading.php':redirect,'/wp-admin/options-discussion.php':foreign}});
  assert.deepEqual(result.admin.reading,[]);assert.deepEqual(result.admin.discussion,[]);
  assert.equal(result.admin.permalink.length,1);
  assert.ok(requests.filter(r=>r.kind==='admin').every(r=>r.maxRedirects===0));
  assert.doesNotMatch(JSON.stringify(result),/RAW_SECRET|evil\.test/);
});

test('invalid base URL causes no request and does not echo credentials',async t=>{
  const {result,requests}=await run(t,{baseURL:'https://user:RAW_PASSWORD@example.test'});
  assert.equal(requests.length,0);assert.doesNotMatch(JSON.stringify(result),/RAW_PASSWORD/);
});

test('explicit contactPath precedes the page cap without rewriting the selection',async t=>{
  const profile={contactPath:'/selected-contact'};
  const {result,requests}=await run(t,{profile,pages:Array.from({length:30},(_,i)=>({path:'/page-'+i})).concat({path:'/selected-contact'}),publicFixture:{...fixture,'/':'<h1>Home</h1>','/selected-contact':fixture['/']}});
  const publicPaths=requests.filter(r=>r.kind==='public').map(r=>new URL(r.url).pathname);
  assert.deepEqual(publicPaths.slice(0,3),['/','/selected-contact','/page-0']);
  assert.equal(publicPaths.filter(p=>/^\/page-/.test(p)).length,9);
  assert.equal(publicPaths.filter(p=>p==='/selected-contact').length,1);
  assert.equal(result.public.forms[0].path,'/selected-contact');
  assert.equal(profile.contactPath,'/selected-contact');
});

test('foreign explicit contactPath is ignored without consuming an inventory slot',async t=>{
  const {requests}=await run(t,{profile:{contactPath:'https://evil.test/contact'},pages:Array.from({length:20},(_,i)=>({path:'/page-'+i}))});
  assert.ok(requests.every(r=>new URL(r.url).origin===baseURL));
  assert.equal(requests.filter(r=>r.kind==='public'&&/^\/page-/.test(new URL(r.url).pathname)).length,10);
});

for(const state of ['closed',undefined,'unknown'])test(`SWELL duplicate toggles use verified label; state ${state}`,async t=>{
  const html=`<html ${state?`data-spmenu="${state}"`:''}><body><button data-onclick="toggleMenu" aria-label="メニューボタン"></button><div id="sp_menu" class="p-spMenu"><button data-onclick="toggleMenu" aria-label="閉じる"></button></div></body></html>`;
  const {result}=await run(t,{publicFixture:{'/':html}});
  assert.equal(result.public.menu.openSelector,'button[data-onclick="toggleMenu"][aria-label="メニューボタン"]');
  assert.equal(result.public.menu.menuSelector,'#sp_menu');
  assert.equal(result.public.menu.stateSelector,state==='closed'?'html':undefined);
  if(state==='closed')assert.deepEqual({attribute:result.public.menu.stateAttribute,opened:result.public.menu.openedValue,closed:result.public.menu.closedValue},{attribute:'data-spmenu',opened:'opened',closed:'closed'});
});

test('duplicated labelled SWELL openers still remain unconfigured',async t=>{
  const button='<button data-onclick="toggleMenu" aria-label="メニューボタン"></button>';
  const {result}=await run(t,{publicFixture:{'/':button+button+'<div id="sp_menu" class="p-spMenu"></div>'}});
  assert.equal(result.public.menu,undefined);
});

test('verifies bounded same-origin linked and Yoast sitemap candidates under sitePath',async t=>{
  const links=Array.from({length:12},(_,i)=>`<link rel="alternate sitemap" href="map-${i}.xml">`).join('');
  const {result,requests}=await run(t,{profile:{sitePath:'/blog/'},publicFixture:{'/blog/':'<link rel="sitemap" href="https://evil.test/map.xml"><link rel="sitemap" href="/bad.xml?nonce=RAW_NONCE">'+links,'/blog/map-0.xml':'<sitemapindex></sitemapindex>','/blog/map-1.xml':'<html><urlset></urlset></html>','/blog/sitemap_index.xml':'<?xml version="1.0"?><sitemapindex></sitemapindex>'}});
  assert.deepEqual(result.public.sitemaps,[{path:'/blog/map-0.xml'},{path:'/blog/sitemap_index.xml'}]);
  assert.equal(requests.filter(r=>r.kind==='public'&&new URL(r.url).pathname.endsWith('.xml')).length,8);
  assert.ok(requests.every(r=>!r.url.includes('evil.test')&&!r.url.includes('RAW_NONCE')));
});

test('plugin update rows are deduplicated and common sitemap.xml is verified',async t=>{
  const {result}=await run(t,{adminFixture:{...fixture,'/wp-admin/plugins.php':fixture['/wp-admin/plugins.php']+'<table><tr class="active plugin-update-tr" data-plugin="contact-form-7/wp-contact-form-7.php"><td>Update available</td></tr></table>'},publicFixture:{...fixture,'/sitemap.xml':'<urlset></urlset>'}});
  assert.equal(result.admin.plugins.length,1);
  assert.ok(result.public.sitemaps.some(s=>s.path==='/sitemap.xml'));
});

for(const count of [0,1,2])test(`SWELL closeSelector is emitted only for one verified close control (${count})`,async t=>{
  const close='<button data-onclick="toggleMenu" aria-label="メニューを閉じる"></button>';
  const html='<html data-spmenu="closed"><body><button data-onclick="toggleMenu" aria-label="メニューボタン"></button><div id="sp_menu" class="p-spMenu"><button data-onclick="toggleMenu" aria-label="別の操作"></button>'+close.repeat(count)+'</div></body></html>';
  const {result}=await run(t,{publicFixture:{'/':html}});
  assert.equal(result.public.menu.closeSelector,count===1?'button[data-onclick="toggleMenu"][aria-label="メニューを閉じる"]':undefined);
  assert.equal(result.public.menu.stateAttribute,'data-spmenu');
  assert.equal(result.public.robots,undefined);
  assert.deepEqual(result.public.sitemaps,[]);
});

test('inventory contacts precede ordinary posts while explicit path stays first',async t=>{
  const pages=[...Array.from({length:20},(_,i)=>({path:'/post-'+i})),{path:'/inquiry/'},{path:'/contact/'}];
  const {requests,result}=await run(t,{profile:{contactPath:'/selected-form/'},pages,publicFixture:{'/':'Home','/contact/':fixture['/']}});
  const paths=requests.filter(r=>r.kind==='public').map(r=>new URL(r.url).pathname);
  assert.deepEqual(paths.slice(0,5),['/','/selected-form/','/inquiry/','/contact/','/post-0']);
  assert.equal(paths.filter(p=>p.startsWith('/post-')).length,7);
  assert.equal(result.public.forms[0].path,'/contact/');
  assert.equal(pages[0].path,'/post-0');
});

test('real homepage contact links replace last unvisited ordinary pages within budget',async t=>{
  const home='<a href="contact/">Contact</a><a href="contact/">Again</a><a href="/blog/inquiry/">Ask</a><a href="https://evil.test/contact/">Foreign</a><a href="/contact/?action=delete">Action</a><a href="/wp-admin/contact/">Admin</a>';
  const {requests,result}=await run(t,{profile:{sitePath:'/blog/',contactPath:'/explicit/'},pages:Array.from({length:20},(_,i)=>({path:'/blog/post-'+i})),publicFixture:{'/blog/':home,'/blog/contact/':fixture['/'],'/blog/inquiry/':'No form here'}});
  const paths=requests.filter(r=>r.kind==='public').map(r=>new URL(r.url).pathname);
  assert.deepEqual(paths.slice(0,5),['/blog/','/explicit/','/blog/contact/','/blog/inquiry/','/blog/post-0']);
  assert.equal(paths.filter(p=>p.startsWith('/blog/post-')).length,7);
  assert.ok(!paths.includes('/blog/post-7')&&!paths.includes('/blog/post-8'));
  assert.equal(paths.filter(p=>p==='/blog/contact/').length,1);
  assert.deepEqual(result.public.forms.map(f=>f.path),['/blog/contact/']);
  assert.ok(requests.every(r=>new URL(r.url).origin===baseURL&&!r.url.includes('action=delete')));
});

test('homepage candidates cannot displace explicit or existing contact candidates',async t=>{
  const {requests}=await run(t,{profile:{contactPath:'/explicit/'},pages:Array.from({length:12},(_,i)=>({path:'/contact-'+i})),publicFixture:{'/':'<a href="/inquiry-new/">Ask</a>'}});
  const paths=requests.filter(r=>r.kind==='public').map(r=>new URL(r.url).pathname);
  assert.ok(paths.includes('/explicit/'));assert.ok(!paths.includes('/inquiry-new/'));
  assert.equal(paths.filter(p=>p.startsWith('/contact-')).length,9);
});
