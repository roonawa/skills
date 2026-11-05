import {randomBytes} from 'node:crypto';
import {request} from 'undici';
import {load} from 'cheerio';
import {preparePublicGate} from '../registration-gate.mjs';

// 公開ページだけを GET／HEAD で取り直し、原因の規則ごとに「ツール側／サイト側／未確認」を確かめる。
// 本文は事実（状態・転送先・meta robots・画像の URL と直前の見出し）を取り出すだけで、保存も返却もしない。
const TIMEOUT_MS=15000,MAX_BODY=2*1024*1024;
const ORDER=['render-timeout','index-expectation','link-transient','soft-404','sitemap-format'];
const SITE_SIDE={'render-timeout':'tech','index-expectation':'admin','link-transient':'editor','soft-404':'admin','sitemap-format':'admin'};
const TEST_HOST=/(?:^|[.-])(?:test|staging|stg|dev)\d*(?:[.-]|$)/i;
const originOf=u=>{try{return new URL(u).origin;}catch{return null;}};
const hostOf=u=>{try{return new URL(u).host;}catch{return '';}};
const isGate=text=>/name=["']password_protected_pwd/.test(text??'');
class Skip extends Error {}

// 接続先の許可にある origin だけへ、転送を追わず・同時に1件・15秒で送る。閲覧用の見出しは siteOrigin にだけ付ける。
export function defaultClient({allowedOrigins=[],publicHeaders={},siteOrigin}={}){
  if(Object.keys(publicHeaders??{}).length&&!siteOrigin) throw new Error('publicHeaders require siteOrigin');
  const allowed=new Set(allowedOrigins.map(originOf).filter(Boolean));
  let queue=Promise.resolve();
  async function send(method,url){
    const u=new URL(url);
    if(!allowed.has(u.origin)||u.username||u.password) throw new Error(`接続先が許可されていません：${u.origin}`);
    const headers={'user-agent':'Mozilla/5.0 (compatible; SITE EXAM)',accept:'*/*',...(u.origin===originOf(siteOrigin)?publicHeaders:{})};
    const res=await request(u.href,{method,headers,maxRedirections:0,headersTimeout:TIMEOUT_MS,bodyTimeout:TIMEOUT_MS,signal:AbortSignal.timeout(TIMEOUT_MS)});
    const chunks=[];let n=0;
    try{if(method==='GET')for await(const c of res.body){chunks.push(c);n+=c.length;if(n>=MAX_BODY)break;}}finally{res.body.on('error',()=>{});res.body.destroy();}
    const h=Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k.toLowerCase(),Array.isArray(v)?v.join(', '):String(v)]));
    if(res.statusCode===407||res.statusCode===403&&h['x-wpqa-egress']!==undefined) throw new Error(`接続先が許可されていません（HTTP ${res.statusCode}）`);
    return {status:res.statusCode,location:h.location??null,headers:h,text:Buffer.concat(chunks).subarray(0,MAX_BODY).toString('utf8')};
  }
  const one=(method,url)=>{const run=queue.then(()=>send(method,url));queue=run.catch(()=>{});return run;};
  return {get:url=>one('GET',url),head:async url=>({status:(await one('HEAD',url)).status})};
}

// 閲覧パスワードのあるサイトは、公開ゲートへ1回だけ POST して閲覧用の Cookie 見出しを得る（preparePublicGate と同じ方法）。
export async function publicGateHeaders({baseURL,sitePath='/',password}){
  if(!password) return {};
  const env={WPQA_UI_SITE_PASSWORD:password};
  await preparePublicGate({baseURL,sitePath,headersEnv:'WPQA_UI_PUBLIC_HEADERS'},env);
  return env.WPQA_UI_PUBLIC_HEADERS?JSON.parse(env.WPQA_UI_PUBLIC_HEADERS):{};
}

// 画像の読み込み元：img の src・data-src、img／source の srcset・data-srcset（各候補の URL）、WordPress の絵文字の baseUrl。
export function pageImages(html,pageURL){
  const $=load(html),out=new Map();let heading=null;
  const add=(raw,nearestHeading)=>{
    if(!raw||/^\s*data:/i.test(raw)) return;
    let url;try{url=new URL(raw.trim(),pageURL);}catch{return;}
    if(/^https?:$/.test(url.protocol)&&!out.has(url.href)) out.set(url.href,{url:url.href,host:url.host,nearestHeading});
  };
  const candidates=s=>(s??'').split(/,\s+|,(?=[^,\s]*\s+\d)/).map(c=>c.trim().split(/\s+/)[0]).filter(Boolean);
  $('h1,h2,h3,h4,h5,h6,img,source').each((_,el)=>{
    const e=$(el);
    if(/^h[1-6]$/i.test(el.tagName)){heading=e.text().replace(/\s+/g,' ').trim()||heading;return;}
    for(const raw of [e.attr('src'),e.attr('data-src'),...candidates(e.attr('srcset')),...candidates(e.attr('data-srcset'))]) add(raw,heading);
  });
  for(const m of html.matchAll(/"baseUrl"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) add(m[1].replace(/\\\//g,'/'),null);
  return [...out.values()];
}

function noindexOf(r){
  const header=Object.entries(r.headers??{}).find(([k])=>k.toLowerCase()==='x-robots-tag')?.[1];
  if(/noindex|none/i.test(header??'')) return `X-Robots-Tag: ${header}`;
  const $=load(r.text??'');
  const meta=$('meta[name]').filter((_,el)=>/^(robots|googlebot)$/i.test($(el).attr('name'))&&/noindex|\bnone\b/i.test($(el).attr('content')??'')).first();
  return meta.length?`meta robots: ${meta.attr('content')}`:null;
}

// 標準の XML の形（タグの対応・ルートが1つ）を確かめ、ルートが urlset／sitemapindex で loc が絶対 URL なら正しい形式とみなす。
// 処理命令（xml-stylesheet）・コメント・CDATA（All in One SEO の loc）は形の確認から外す。
export function sitemapWellFormed(text){
  const body=String(text??'').replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>/gi,'');
  const stack=[];let roots=0;
  for(const part of body.split(/(<[^>]*>)/)){
    if(part.startsWith('<')){
      const m=/^<(\/)?([\w:.-]+)(?:\s+[^<>]*?)?(\/)?\s*>$/.exec(part);if(!m) return false;
      if(m[1]){if(stack.pop()!==m[2]) return false;}else{if(!stack.length)roots++;if(!m[3])stack.push(m[2]);}
    }else if(part.includes('<')||!stack.length&&part.trim()) return false;
  }
  if(stack.length||roots!==1) return false;
  const $=load(text,{xmlMode:true}),root=$.root().children().first(),name=root[0]?.tagName;
  if(!['urlset','sitemapindex'].includes(name)) return false;
  const entries=root.children(name==='urlset'?'url':'sitemap');
  return entries.length>0&&entries.toArray().every(e=>/^https?:\/\/\S+$/.test($(e).children('loc').text().trim()));
}

export async function recheck(groups,{baseURL,sitePath='/',environment,client,allowedOrigins=[],limit=60,perRule=3,now=()=>new Date().toISOString(),failedImagesByPath={}}={}){
  const base=new URL(baseURL),allowed=new Set(allowedOrigins.map(originOf).filter(Boolean)),siteAllowed=allowed.has(base.origin);
  const log=[],cache=new Map(),foreign=new Map();let used=0;
  const stamp=()=>{const t=typeof now==='function'?now():now;return t instanceof Date?t.toISOString():String(t);};
  const site=path=>{const u=new URL(path,base);if(u.origin!==base.origin) throw new Skip(`対象サイトの外のため確かめていません：${u.host}`);return u.href;};
  async function fetch(method,url,rule){
    const key=`${method} ${url}`;if(cache.has(key)) return cache.get(key);
    if(used>=limit) throw new Skip(`再確認の上限（${limit}件）に達したため確かめていません`);
    used++;const entry={at:stamp(),method:method.toUpperCase(),url,status:null,rule};log.push(entry);
    let r;try{r=await client[method](url);}catch{throw new Skip(`取得できませんでした：${url}`);}
    entry.status=r?.status??null;cache.set(key,r);return r;
  }
  async function getPage(url,rule){
    const r=await fetch('get',url,rule);
    if(r.status!==200) throw new Skip(`ページを取得できませんでした（HTTP ${r.status}）：${url}`);
    if(isGate(r.text)) throw new Skip(`閲覧パスワードの画面が表示されたため確かめていません：${url}`);
    return r;
  }
  const pagesOf=(g,kind)=>g.probes.filter(p=>p.kind===kind&&p.path).slice(0,perRule);
  const none=()=>({result:'unverified',notes:['確かめる対象のページがありません']});
  const isTestHost=host=>environment==='production'&&TEST_HOST.test(host);

  const handlers={
    async 'render-timeout'(g,rule){
      const pages=pagesOf(g,'images');if(!pages.length) return none();
      const blocked=new Set(),own=[],notes=[];let explained=0;
      for(const p of pages){
        const url=site(p.path),evidence=failedImagesByPath?.[p.path]??g.facts?.failedImages?.[p.path];
        let found=null;
        try{found=pageImages((await getPage(url,rule)).text,url);}catch(e){if(!(e instanceof Skip)||!evidence) throw e;notes.push(e.message);}
        const heading=u=>found?.find(i=>i.url===u)?.nearestHeading??null;
        const seen=[...(found??[]),...(evidence??[]).map(i=>({url:i.url,host:hostOf(i.url),nearestHeading:heading(i.url)}))];
        for(const i of seen) if(originOf(i.url)!==base.origin&&isTestHost(i.host)&&!foreign.has(i.url)) foreign.set(i.url,{url:i.url,host:i.host,nearestHeading:i.nearestHeading,path:p.path});
        const failing=evidence?evidence.map(i=>i.url):found.filter(i=>originOf(i.url)!==base.origin&&!allowed.has(originOf(i.url))).map(i=>i.url);
        let cause=false;
        for(const u of failing){const o=originOf(u);if(o===base.origin||allowed.has(o)) own.push(u);else{cause=true;if(!isTestHost(hostOf(u)))blocked.add(hostOf(u));}}
        if(cause) explained++;
      }
      if(own.length) return {result:'site-side',notes:[...notes,`対象サイトか接続先の許可にある読み込み元の画像が読み込めませんでした：${[...new Set(own.map(hostOf))].join('、')}`]};
      if(explained<pages.length) return {result:'unverified',notes:[...notes,'時間切れの原因になる別ドメインの画像が見つかりませんでした']};
      const testHosts=[...new Set([...foreign.values()].map(i=>i.host))];
      return {result:'tool-side',notes:[...notes,...blocked.size?[`接続先の許可にない読み込み元の画像：${[...blocked].join('、')}`]:[],...testHosts.length?[`検証用と思われるドメインの画像：${testHosts.join('、')}（編集者向けの別の項目にしました）`]:[]]};
    },
    async 'index-expectation'(g,rule){
      const pages=pagesOf(g,'page');if(!pages.length) return none();
      const notes=[];let noindex=false;
      for(const p of pages){const url=site(p.path),r=await getPage(url,rule),found=noindexOf(r);if(found)noindex=true;notes.push(`${url}：${found??'検索エンジンに公開（noindex なし）'}`);}
      if(noindex) return {result:'site-side',notes:[...notes,'実際のページが検索エンジンに非公開（noindex）です']};
      if(environment!=='production') return {result:'unverified',notes:[...notes,'登録の環境が本番ではないため、診断の設定の問題とは判断していません']};
      return {result:'tool-side',notes:[...notes,'本番の実際のページは検索エンジンに公開されています。公開方針を案件の担当と確認すること']};
    },
    async 'link-transient'(g,rule){
      const targets=g.probes.slice(0,perRule).map(p=>p.kind==='link'?p.url:p.kind==='page'?p.path:null).filter(Boolean);
      if(!targets.length) return none();
      const good=[],bad=[];
      for(const t of targets){
        const u=new URL(t,base);let r;
        if(u.origin===base.origin){r=await fetch('get',u.href,rule);if(r.status===200&&isGate(r.text)) throw new Skip(`閲覧パスワードの画面が表示されたため確かめていません：${u.href}`);}
        else if(allowed.has(u.origin)) r=await fetch('head',u.href,rule);
        else throw new Skip(`別ドメインのリンクで、接続先の許可がないため確かめていません：${u.host}`);
        (r.status<400?good:bad).push(`${u.href}（HTTP ${r.status}）`);
      }
      return bad.length?{result:'site-side',notes:bad.map(b=>`取得し直しても失敗しました：${b}`)}:{result:'tool-side',notes:good.map(b=>`取得し直して正常でした：${b}`)};
    },
    async 'soft-404'(g,rule){
      const url=site(`${sitePath}wpqa-missing-${randomBytes(6).toString('hex')}/`),r=await fetch('get',url,rule);
      if(r.status===404||r.status===410) return {result:'tool-side',notes:[`存在しないページは HTTP ${r.status} を返しました`]};
      if(r.status>=300&&r.status<400){
        const to=r.location??r.headers?.location??'';let home=false;try{home=new URL(to,url).href===new URL(sitePath,base).href;}catch{}
        return {result:'site-side',notes:[`存在しないページが${home?'トップページへ':''}転送されました（HTTP ${r.status} → ${to}）`]};
      }
      if(r.status===200&&!isGate(r.text)) return {result:'site-side',category:'tech',notes:['存在しないページが HTTP 200 で表示されました']};
      return {result:'unverified',notes:[`存在しないページの応答から判断できません（HTTP ${r.status}）`]};
    },
    async 'sitemap-format'(g,rule){
      const given=g.probes.find(p=>p.kind==='sitemap')?.path;
      const tries=given?[given]:[`${sitePath}sitemap.xml`,`${sitePath}wp-sitemap.xml`];
      let url=site(tries.shift());
      for(let n=0;n<perRule;n++){
        const r=await fetch('get',url,rule);
        if(r.status===200) return sitemapWellFormed(r.text)?{result:'tool-side',notes:[`標準の XML として読めました：${url}`]}:{result:'site-side',notes:[`標準の XML として読めませんでした：${url}`]};
        const to=r.status>=300&&r.status<400?r.location??r.headers?.location:null;
        if(to&&originOf(new URL(to,url))===base.origin) url=new URL(to,url).href;
        else if(r.status===404&&tries.length) url=site(tries.shift());
        else break;
      }
      return {result:'unverified',notes:[`サイトマップを取得できませんでした：${url}`]};
    },
  };

  const results=new Map();
  for(const rule of ORDER) for(const g of groups.filter(x=>x.rule===rule)){
    let v;
    if(!siteAllowed) v={result:'unverified',notes:['対象サイトが接続先の許可にないため再確認していません']};
    else try{v=await handlers[rule](g,rule);}catch(e){if(!(e instanceof Skip)) throw e;v={result:'unverified',notes:[e.message]};}
    const category=v.result==='tool-side'?'not-site':v.result==='site-side'?v.category??SITE_SIDE[rule]:'unverified';
    results.set(g,{...g,category,verification:{result:v.result,notes:v.notes}});
  }
  const out=groups.map(g=>results.get(g)??{...g});
  if(foreign.size){
    const source=out.find(g=>g.rule==='render-timeout');
    out.push({id:'foreign-image',rule:'foreign-image',rowIds:[],status:source?.status??'fail',category:'editor',facts:{images:[...foreign.values()]},probes:[],
      verification:{result:'site-side',notes:['本番のページが検証用と思われる別のドメインの画像を読み込んでいます']}});
  }
  return {groups:out,log,used};
}
