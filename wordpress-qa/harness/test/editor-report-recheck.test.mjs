import test from 'node:test';
import assert from 'node:assert/strict';
import {recheck,defaultClient,sitemapWellFormed} from '../lib/editor-report/recheck.mjs';

const BASE='https://komoro.example';
const page=(body='',status=200,headers={})=>({status,location:headers.location??null,headers,text:`<!doctype html><html><head>${body.head??''}</head><body>${body.body??body}</body></html>`});
// Fake client: routes map URL -> response (or Error to throw); missing path -> 404. Records every call.
function fake(routes={}){
  const calls=[];
  const answer=(method,url)=>{calls.push({method,url});const r=routes[url];if(r instanceof Error)throw r;return r??{status:404,location:null,headers:{},text:''};};
  return {calls,get:async url=>answer('get',url),head:async url=>({status:answer('head',url).status})};
}
const group=(rule,probes,extra={})=>({id:`${rule}:fail`,rule,rowIds:[`${rule}.row`],status:'fail',category:'not-site',facts:{},probes,...extra});
const options=(client,extra={})=>({baseURL:BASE,sitePath:'/',environment:'production',client,allowedOrigins:[BASE],now:()=>'2026-11-05T00:00:00.000Z',...extra});
const byRule=(r,rule)=>r.groups.find(g=>g.rule===rule);

test('index expectation on production with indexable pages is tool-side',async()=>{
  const client=fake({[`${BASE}/`]:page('<h1>top</h1>'),[`${BASE}/about/`]:page({head:'<meta name="robots" content="index, follow">'}),[`${BASE}/news/`]:page('x')});
  const r=await recheck([group('index-expectation',[{kind:'page',path:'/'},{kind:'page',path:'/about/'},{kind:'page',path:'/news/'}])],options(client));
  const g=byRule(r,'index-expectation');
  assert.equal(g.category,'not-site');assert.equal(g.verification.result,'tool-side');
  assert(g.verification.notes.some(n=>/公開方針を案件の担当と確認/.test(n)));
  assert.equal(r.used,3);assert.equal(r.log.length,3);
  assert.deepEqual(r.log[0],{at:'2026-11-05T00:00:00.000Z',method:'GET',url:`${BASE}/`,status:200,rule:'index-expectation'});
});

test('index expectation outside production with indexable pages goes to admin',async()=>{
  const client=fake({[`${BASE}/`]:page('x')});
  const r=await recheck([group('index-expectation',[{kind:'page',path:'/'}])],options(client,{environment:'staging'}));
  const g=byRule(r,'index-expectation');assert.equal(g.category,'admin');assert.equal(g.verification.result,'site-side');assert(g.verification.notes.some(n=>n.includes('検証サイトが検索エンジンに公開されています')));
  const failed=await recheck([group('index-expectation',[{kind:'page',path:'/x/'}])],options(fake(),{environment:'staging'}));
  assert.equal(byRule(failed,'index-expectation').category,'unverified');
});

test('real noindex goes to admin',async()=>{
  const client=fake({[`${BASE}/`]:page({head:'<meta name="robots" content="noindex, nofollow">'}),[`${BASE}/about/`]:page('x',200,{'x-robots-tag':'noindex'})});
  const r=await recheck([group('index-expectation',[{kind:'page',path:'/'}])],options(client));
  assert.equal(byRule(r,'index-expectation').category,'admin');assert.equal(byRule(r,'index-expectation').verification.result,'site-side');
  const h=await recheck([group('index-expectation',[{kind:'page',path:'/about/'}])],options(client));
  assert.equal(byRule(h,'index-expectation').category,'admin');
});

test('transient link recovers',async()=>{
  const ok=await recheck([group('link-transient',[{kind:'link',url:`${BASE}/contact/`}])],options(fake({[`${BASE}/contact/`]:page('x')})));
  assert.equal(byRule(ok,'link-transient').category,'not-site');assert.equal(byRule(ok,'link-transient').verification.result,'tool-side');
  const broken=await recheck([group('link-transient',[{kind:'link',url:`${BASE}/gone/`}])],options(fake()));
  assert.equal(byRule(broken,'link-transient').category,'editor');assert.equal(byRule(broken,'link-transient').verification.result,'site-side');
});

test('foreign links are only checked with HEAD when allowed',async()=>{
  const client=fake({'https://partner.example/':{status:200}});
  const denied=await recheck([group('link-transient',[{kind:'link',url:'https://partner.example/'}])],options(client));
  assert.equal(byRule(denied,'link-transient').category,'unverified');assert.equal(client.calls.length,0);
  const allowed=await recheck([group('link-transient',[{kind:'link',url:'https://partner.example/'}])],options(client,{allowedOrigins:[BASE,'https://partner.example']}));
  assert.equal(byRule(allowed,'link-transient').category,'not-site');assert.deepEqual(client.calls,[{method:'head',url:'https://partner.example/'}]);
});

test('soft 404 redirects to home',async()=>{
  const routes=new Proxy({},{get:(_,url)=>String(url).startsWith(`${BASE}/wpqa-missing-`)?{status:302,location:`${BASE}/`,headers:{location:`${BASE}/`},text:''}:undefined});
  const client=fake(routes);
  const r=await recheck([group('soft-404',[{kind:'missing-page'}],{category:'admin'})],options(client));
  const g=byRule(r,'soft-404');
  assert.equal(g.category,'admin');assert.equal(g.verification.result,'site-side');assert(g.verification.notes.some(n=>n.includes(`${BASE}/`)));
  const real=await recheck([group('soft-404',[{kind:'missing-page'}],{category:'admin'})],options(fake()));
  assert.equal(byRule(real,'soft-404').category,'not-site');
});

const SITEMAP='<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/default-sitemap.xsl?sitemap=root"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc><![CDATA[https://komoro.example/post-sitemap.xml]]></loc></sitemap></sitemapindex>';
test('sitemap with CDATA parses',async()=>{
  const r=await recheck([group('sitemap-format',[{kind:'sitemap'}])],options(fake({[`${BASE}/sitemap.xml`]:{status:200,location:null,headers:{'content-type':'application/xml'},text:SITEMAP}})));
  assert.equal(byRule(r,'sitemap-format').category,'not-site');assert.equal(byRule(r,'sitemap-format').verification.result,'tool-side');
  const bad=await recheck([group('sitemap-format',[{kind:'sitemap'}])],options(fake({[`${BASE}/sitemap.xml`]:{status:200,location:null,headers:{},text:'<urlset><url><loc>https://komoro.example/</url></urlset>'}})));
  assert.equal(byRule(bad,'sitemap-format').category,'admin');
});

test('foreign images from a test domain become an editor item',async()=>{
  const html=page({head:'<script>window._wpemojiSettings = {"baseUrl":"https:\\/\\/s.w.org\\/images\\/core\\/emoji\\/17.0.2\\/72x72\\/","ext":".png"};</script>',
    body:'<h2>病院紹介</h2><div><img src="data:image/gif;base64,AAAA" data-src="https://komoro-animal-test.example/wp-content/uploads/gaikan01s.jpg"></div><img src="/wp-content/uploads/own.jpg" srcset="/a.jpg 1x, /b.jpg 2x">'});
  const r=await recheck([group('render-timeout',[{kind:'images',path:'/'}])],options(fake({[`${BASE}/`]:html})));
  const foreign=r.groups.filter(g=>g.rule==='foreign-image');
  assert.equal(foreign.length,1);
  assert.deepEqual(foreign[0].rowIds,[]);assert.equal(foreign[0].category,'editor');
  assert.deepEqual(foreign[0].facts.images.map(({url,host,nearestHeading})=>({url,host,nearestHeading})),[{url:'https://komoro-animal-test.example/wp-content/uploads/gaikan01s.jpg',host:'komoro-animal-test.example',nearestHeading:'病院紹介'}]);
  const timeout=byRule(r,'render-timeout');
  assert.equal(timeout.category,'not-site');assert.equal(timeout.verification.result,'tool-side');
  assert(timeout.verification.notes.some(n=>n.includes('s.w.org')));
  assert(!timeout.verification.notes.some(n=>n.includes('komoro.example/')));
});

test('failed image evidence is preferred over the page images',async()=>{
  const html=page('<h3>アクセス</h3><img src="https://maps.example/tile.png"><img src="https://cdn.example/x.png">');
  const r=await recheck([group('render-timeout',[{kind:'images',path:'/'}])],options(fake({[`${BASE}/`]:html}),{failedImagesByPath:{'/':[{url:'https://maps.example/tile.png',host:'maps.example',reason:'request-failed'}]}}));
  const notes=byRule(r,'render-timeout').verification.notes.join('\n');
  assert.equal(byRule(r,'render-timeout').category,'not-site');assert(notes.includes('maps.example'));assert(!notes.includes('cdn.example'));
  const own=await recheck([group('render-timeout',[{kind:'images',path:'/'}])],options(fake({[`${BASE}/`]:html}),{failedImagesByPath:{'/':[{url:`${BASE}/wp-content/uploads/x.png`,host:'komoro.example',reason:'not-loaded'}]}}));
  assert.equal(byRule(own,'render-timeout').category,'tech');assert.equal(byRule(own,'render-timeout').verification.result,'site-side');
});

test('render timeout without any foreign image stays unverified',async()=>{
  const r=await recheck([group('render-timeout',[{kind:'images',path:'/'}])],options(fake({[`${BASE}/`]:page('<img src="/own.jpg">')})));
  assert.equal(byRule(r,'render-timeout').category,'unverified');
});

test('limit and allowlist make groups unverified',async()=>{
  const groups=()=>[group('index-expectation',[{kind:'page',path:'/'}]),group('soft-404',[{kind:'missing-page'}],{category:'admin'}),group('sitemap-format',[{kind:'sitemap'}])];
  const client=fake({[`${BASE}/`]:page('x'),[`${BASE}/sitemap.xml`]:{status:200,location:null,headers:{},text:SITEMAP}});
  const r=await recheck(groups(),options(client,{limit:2}));
  assert.equal(r.used,2);
  assert.equal(byRule(r,'index-expectation').category,'not-site');assert.equal(byRule(r,'soft-404').category,'not-site');
  assert.equal(byRule(r,'sitemap-format').category,'unverified');assert(byRule(r,'sitemap-format').verification.notes.some(n=>/上限/.test(n)));
  const none=fake();
  const d=await recheck(groups(),options(none,{allowedOrigins:['https://other.example']}));
  assert.equal(d.used,0);assert.equal(none.calls.length,0);
  for(const g of d.groups){assert.equal(g.category,'unverified');assert.equal(g.verification.result,'unverified');}
});

test('groups without probes keep their category and network errors are unverified',async()=>{
  const plugin={id:'plugin-vulnerability:fail:x',rule:'plugin-vulnerability',rowIds:['check.security-plugin'],status:'fail',category:'admin',facts:{plugins:[]},probes:[]};
  const r=await recheck([plugin,group('index-expectation',[{kind:'page',path:'/'}]),group('link-transient',[])],options(fake({[`${BASE}/`]:new Error('ECONNRESET')})));
  assert.deepEqual(r.groups[0],plugin);
  assert.equal(byRule(r,'index-expectation').category,'unverified');assert.equal(r.log[0].status,null);
  assert.equal(byRule(r,'link-transient').category,'unverified');
});

test('a password gate page is not taken as the page itself',async()=>{
  const r=await recheck([group('index-expectation',[{kind:'page',path:'/'}])],options(fake({[`${BASE}/`]:page('<form><input name="password_protected_pwd"></form>')})));
  assert.equal(byRule(r,'index-expectation').category,'unverified');
});

test('only GET and HEAD are used',async()=>{
  const calls=[];
  const client=new Proxy({},{get:(_,method)=>async url=>{calls.push(method);return {status:200,location:null,headers:{},text:''};}});
  await recheck([group('render-timeout',[{kind:'images',path:'/'}]),group('index-expectation',[{kind:'page',path:'/'}]),group('link-transient',[{kind:'link',url:`${BASE}/x/`}]),group('soft-404',[{kind:'missing-page'}]),group('sitemap-format',[{kind:'sitemap'}])],options(client));
  assert(calls.length>0);assert(calls.every(m=>m==='get'||m==='head'),calls.join());
});

test('default client refuses origins outside the allowlist and other methods',async()=>{
  const c=defaultClient({allowedOrigins:[BASE]});
  assert.deepEqual(Object.keys(c).sort(),['get','head']);
  await assert.rejects(c.get('https://elsewhere.example/'),/許可/);
  assert.throws(()=>defaultClient({allowedOrigins:[BASE],publicHeaders:{Cookie:'a=b'}}),/siteOrigin/);
});

test('default client does not follow redirects and sends viewing headers only to the site',async t=>{
  const {createServer}=await import('node:http');
  const seen=[];
  const server=createServer((req,res)=>{seen.push({method:req.method,url:req.url,cookie:req.headers.cookie??null});
    if(req.url==='/r'){res.writeHead(302,{location:'/'});return res.end();}
    res.writeHead(200,{'content-type':'text/html'});res.end('<p>ok</p>');}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
  const origin=`http://127.0.0.1:${server.address().port}`;
  const c=defaultClient({allowedOrigins:[origin],publicHeaders:{Cookie:'pp=1'},siteOrigin:origin});
  const [r,ok,h]=await Promise.all([c.get(`${origin}/r`),c.get(`${origin}/`),c.head(`${origin}/`)]);
  assert.equal(r.status,302);assert.equal(r.location,'/');
  assert.equal(ok.status,200);assert.equal(ok.text,'<p>ok</p>');assert.deepEqual(h,{status:200});
  assert.deepEqual(seen.map(s=>[s.method,s.url,s.cookie]),[['GET','/r','pp=1'],['GET','/','pp=1'],['HEAD','/','pp=1']]);
});

test('no viewing password means no gate request',async()=>{
  const {publicGateHeaders}=await import('../lib/editor-report/recheck.mjs');
  assert.deepEqual(await publicGateHeaders({baseURL:BASE,sitePath:'/'}),{});
});

test('representative pages are capped per rule across fail and caution groups',async()=>{
  const routes=Object.fromEntries(['/a/','/b/','/c/','/d/','/e/'].map(p=>[`${BASE}${p}`,page('x')]));
  const client=fake(routes);
  const fail=group('index-expectation',[{kind:'page',path:'/a/'},{kind:'page',path:'/b/'},{kind:'page',path:'/c/'}]);
  const caution={...group('index-expectation',[{kind:'page',path:'/d/'},{kind:'page',path:'/e/'},{kind:'page',path:'/b/'}]),id:'index-expectation:caution',status:'caution'};
  const r=await recheck([fail,caution],options(client));
  assert.equal(new Set(client.calls.map(c=>c.url)).size,3);assert.equal(r.used,3);
  for(const g of r.groups) assert.equal(g.category,'not-site');
  assert.deepEqual(r.groups[1].verification.notes.filter(n=>n.startsWith(BASE)).map(n=>n.split('：')[0]),[`${BASE}/b/`]);
});

test('truncated bodies are not judged',async()=>{
  const big={status:200,location:null,headers:{},text:SITEMAP.slice(0,80),truncated:true};
  const s=await recheck([group('sitemap-format',[{kind:'sitemap'}])],options(fake({[`${BASE}/sitemap.xml`]:big})));
  assert.equal(byRule(s,'sitemap-format').category,'unverified');assert(byRule(s,'sitemap-format').verification.notes.some(n=>/大きすぎ/.test(n)));
  const p=await recheck([group('index-expectation',[{kind:'page',path:'/'}])],options(fake({[`${BASE}/`]:{...page('x'),truncated:true}})));
  assert.equal(byRule(p,'index-expectation').category,'unverified');
});

test('default client marks a body cut at the size cap as truncated',async t=>{
  const {createServer}=await import('node:http');
  const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'application/xml'});res.end(req.url==='/big'?'x'.repeat(3*1024*1024):'<urlset/>');}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
  const origin=`http://127.0.0.1:${server.address().port}`,c=defaultClient({allowedOrigins:[origin]});
  const big=await c.get(`${origin}/big`),small=await c.get(`${origin}/small`);
  assert.equal(big.truncated,true);assert.equal(big.text.length,2*1024*1024);assert.equal(small.truncated,false);
});

test('a malformed Location or link URL makes only that group unverified',async()=>{
  const client=fake({[`${BASE}/sitemap.xml`]:{status:301,location:'http://[bad',headers:{location:'http://[bad'},text:''},[`${BASE}/`]:page('x')});
  const r=await recheck([group('sitemap-format',[{kind:'sitemap'}]),group('link-transient',[{kind:'link',url:'http://[bad'}]),group('index-expectation',[{kind:'page',path:'/'}])],options(client));
  assert.equal(byRule(r,'sitemap-format').category,'unverified');assert(byRule(r,'sitemap-format').verification.notes.some(n=>/解釈できない/.test(n)));
  assert.equal(byRule(r,'link-transient').category,'unverified');
  assert.equal(byRule(r,'index-expectation').category,'not-site');
});

test('a password gate page served for the sitemap is unverified, not malformed',async()=>{
  const r=await recheck([group('sitemap-format',[{kind:'sitemap'}])],options(fake({[`${BASE}/sitemap.xml`]:page('<form><input name="password_protected_pwd"></form>')})));
  const g=byRule(r,'sitemap-format');
  assert.equal(g.category,'unverified');assert.equal(g.verification.result,'unverified');
  assert(g.verification.notes.some(n=>/閲覧パスワード/.test(n)));
});

test('an own-origin image whose request was only aborted does not make the timeout a site problem',async()=>{
  const html=page('<img src="/own.jpg">');
  const evidence=[{url:`${BASE}/own.jpg`,host:'komoro.example',reason:'request-failed'},{url:'https://maps.example/tile.png',host:'maps.example',reason:'request-failed'}];
  const r=await recheck([group('render-timeout',[{kind:'images',path:'/'}])],options(fake({[`${BASE}/`]:html}),{failedImagesByPath:{'/':evidence}}));
  assert.equal(byRule(r,'render-timeout').category,'not-site');assert.equal(byRule(r,'render-timeout').verification.result,'tool-side');
  const onlyOwn=await recheck([group('render-timeout',[{kind:'images',path:'/'}])],options(fake({[`${BASE}/`]:html}),{failedImagesByPath:{'/':evidence.slice(0,1)}}));
  assert.notEqual(byRule(onlyOwn,'render-timeout').category,'tech');assert.equal(byRule(onlyOwn,'render-timeout').verification.result,'unverified');
});

test('default client sends no viewing Cookie to another allowed origin',async t=>{
  const {createServer}=await import('node:http');
  const listen=async seen=>{const s=createServer((req,res)=>{seen.push({method:req.method,cookie:req.headers.cookie??null,auth:req.headers.authorization??null});res.writeHead(200);res.end();}).listen(0,'127.0.0.1');
    await new Promise(r=>s.once('listening',r));t.after(()=>s.close());return `http://127.0.0.1:${s.address().port}`;};
  const siteSeen=[],otherSeen=[],site=await listen(siteSeen),other=await listen(otherSeen);
  const c=defaultClient({allowedOrigins:[site,other],publicHeaders:{Cookie:'pp=1',Authorization:'Basic eDp5'},siteOrigin:site});
  assert.deepEqual(await c.head(`${other}/x.png`),{status:200});
  await c.get(`${other}/`);await c.head(`${site}/`);
  assert.deepEqual(otherSeen,[{method:'HEAD',cookie:null,auth:null},{method:'GET',cookie:null,auth:null}]);
  assert.deepEqual(siteSeen,[{method:'HEAD',cookie:'pp=1',auth:'Basic eDp5'}]);
});

// サイトから返る本文に閉じない <? <!-- <![CDATA[ が大量にあっても、判定は短時間で終わる。
test('sitemap well-formedness check stays linear on hostile bodies',()=>{
 for(const unit of ['<?','<!--','<![CDATA[','<!DOCTYPE']){
  const body='<urlset>'+unit.repeat(150000);
  const started=Date.now();assert.equal(sitemapWellFormed(body),false);
  assert(Date.now()-started<1000,unit+' took '+(Date.now()-started)+'ms');
 }
 assert.equal(sitemapWellFormed('<?xml version="1.0"?><?xml-stylesheet href="a.xsl"?><!-- c --><urlset><url><loc><![CDATA[https://a.test/]]></loc></url></urlset>'),true);
});
