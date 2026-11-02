import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sameOrigin} from '../config.mjs';
import {request} from 'undici';
import {load} from 'cheerio';
import {envHeaders} from '../mailpit.mjs';
import {scopedHeaders} from '../headers.mjs';
import {publicHeaders,noGate} from './discovered.mjs';
import {RULES} from '../security-baseline-rules.mjs';

export const kinds=['security-baseline'];
export const LIMITS={exposure:16,transport:4,mixed:10,headers:10,disclosure:10};
export const MAX_BODY=64*1024,GAP_MS=200;
const blocked=message=>{throw new Error('BLOCKED: '+message);};
export function validate(check,config){
  assert.equal(check.kind,'security-baseline');assert.equal(check.suite,'authz','security-baseline suite must be authz');const o=check.options;
  assert(o&&typeof o==='object'&&!Array.isArray(o),'options object required');for(const key of Object.keys(o))assert(['area','paths','wpPath'].includes(key),`unknown option ${key}`);
  assert(Object.hasOwn(LIMITS,o.area),'unsupported area');
  if(o.paths!==undefined){assert(Array.isArray(o.paths)&&o.paths.length>=1&&o.paths.length<=5,'paths must be 1..5');for(const p of o.paths){assert(typeof p==='string'&&p.trim(),'path string required');sameOrigin(p,config.baseURL);}}
  if(o.wpPath!==undefined)assert(typeof o.wpPath==='string'&&/^\/(?:[^/?#\\%]+\/)*$/.test(o.wpPath)&&!o.wpPath.split('/').some(s=>s==='.'||s==='..'),'wpPath must start and end with /');
  return check;
}
export function validateRuntime(check,config){
  validate(check,config);if(check.options.area==='exposure'&&config.allowSensitivePaths!==true)blocked('本番環境の機密パス確認は許可が必要です（登録設定「機密ファイル露出の確認」）');
}
const cancelled=()=>blocked('検査が中断されました');
const sleep=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new Error('BLOCKED: 検査が中断されました'));const id=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},Math.max(0,ms)),stop=()=>{clearTimeout(id);reject(new Error('BLOCKED: 検査が中断されました'));};signal?.addEventListener('abort',stop,{once:true});});
export const isHtml=r=>/^\s*(?:text\/html|application\/xhtml)/i.test(r.contentType)||/<(?:!doctype html|html[\s>]|body[\s>])/i.test(r.text.slice(0,2048));
// サイト閲覧用の見出し：Basic認証とパスワード保護のCookieは残し、管理画面のセッションは送らない。
export function siteHeaders(config){const h=publicHeaders(config);for(const [k,v] of Object.entries(envHeaders(config.headersEnv)))if(k.toLowerCase()==='authorization')h.authorization=v;if(!h.cookie)delete h.cookie;return h;}
const unusable=r=>r.status>=500||r.status===429||r.status===403&&r.headers['x-wpqa-egress']!==undefined;
// 分類ごとに1つ作る。件数上限・200ms間隔・64KiB打ち切り・ゲート検出・通信失敗のBLOCKED化を担う。上限到達時は null を返す。
export function session({config,signal,limit,timeout=config.timeoutMs??15000}){
  const base=new URL(config.baseURL),own=siteHeaders(config),requests=[];let last=0;
  async function fetch(target,{method='GET'}={}){
    assert(['GET','HEAD'].includes(method),'GET/HEAD only');const u=new URL(target,base);
    assert(!u.username&&!u.password&&(u.origin===base.origin||u.protocol==='http:'&&u.hostname===base.hostname&&u.pathname==='/'&&!u.search),'URL must have same origin');u.hash='';
    if(signal?.aborted)cancelled();if(requests.length>=limit)return null;
    await sleep(last+GAP_MS-Date.now(),signal);
    const path=u.origin===base.origin?u.pathname+u.search:u.href,row={method,path,status:null,contentType:null,bytes:0};requests.push(row);
    const headers={'user-agent':'Mozilla/5.0 (compatible; SITE EXAM)',accept:'*/*',...scopedHeaders(own,own,u.href,base.href),...method==='GET'?{range:`bytes=0-${MAX_BODY-1}`}:{}};
    let r;
    try{const res=await request(u.href,{method,headers,signal:AbortSignal.any([AbortSignal.timeout(timeout),...signal?[signal]:[]])}),chunks=[];let n=0;
      try{for await(const c of res.body){chunks.push(c);n+=c.length;if(n>=MAX_BODY)break;}}finally{res.body.destroy();}
      const body=Buffer.concat(chunks).subarray(0,MAX_BODY),h=Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):String(v)]));
      r={url:u,path,status:res.statusCode,headers:h,cookies:[res.headers['set-cookie']??[]].flat().map(String),contentType:h['content-type']??'',bytes:body.length,text:body.toString('utf8')};Object.assign(row,{status:r.status,contentType:r.contentType,bytes:r.bytes});
    }catch(error){if(signal?.aborted)cancelled();throw Object.assign(new Error(`BLOCKED: 通信に失敗しました：${path}`),{network:true,cause:error});}
    finally{last=Date.now();}
    // WordPress REST の401（JSON・認証要求ヘッダーなし）は閲覧制限ではなく、その操作の拒否として返す。
    if(r.status===407||r.status===401&&(r.headers['www-authenticate']!==undefined||!/json/i.test(r.contentType)))blocked(`閲覧に認証が必要です（HTTP ${r.status}）：${path}`);
    if(unusable(r))throw Object.assign(new Error(`BLOCKED: 応答から確認できません（HTTP ${r.status}${r.headers['x-wpqa-egress']!==undefined?'・接続制限':''}）：${path}`),{network:true});
    if(r.status>=300&&r.status<400&&/\/wp-login\.php(?:[?#]|$)/.test(r.headers.location??''))blocked(`ログイン画面へ転送されました：${path}`);
    if(isHtml(r))noGate(r.text);return r;
  }
  return {requests,fetch};
}
const ok=r=>r.status===200||r.status===206;
// 末尾に / を付けるだけの転送は「その場所にファイルはない」とみなす。それ以外の転送は転送先を確認していないので未確認。
export const slashOnly=r=>{try{const to=new URL(r.headers.location??'',r.url);return to.origin===r.url.origin&&to.pathname===r.url.pathname+'/';}catch{return false;}};
const SIGNS={
  'git-head':r=>/^(?:ref: refs\/|[0-9a-f]{40}(?:\s|$))/.test(r.text),
  'git-config':r=>!isHtml(r)&&/^\s*\[core\]/m.test(r.text),
  'env-file':r=>!isHtml(r)&&(r.text.match(/^[A-Za-z_][A-Za-z0-9_]*=.*$/gm)??[]).length>=2,
  'debug-log':r=>!isHtml(r)&&/^.*PHP (?:Warning|Fatal error|Notice|Parse error|Deprecated):/m.test(r.text),
  'wp-config-backup':r=>!isHtml(r)&&/DB_NAME|DB_PASSWORD/.test(r.text),
  'uploads-index':r=>/<title>\s*Index of/i.test(r.text),
};
const finding=(rule,r)=>({rule,level:RULES[rule].level,path:r.path,observation:`HTTP ${r.status}・${r.contentType||'Content-Type なし'}・${r.bytes}バイト。内容の特徴が一致（本文は保存していません）`});
async function exposure(o,s,evidence){
  const wp=o.wpPath??'/',targets=[['git-head','/.git/HEAD'],['git-config','/.git/config'],['env-file','/.env'],['debug-log',wp+'wp-content/debug.log'],...['.bak','.old','.orig','.save','~','.txt'].map(x=>['wp-config-backup',wp+'wp-config.php'+x]),['uploads-index',wp+'wp-content/uploads/']];
  const skip=new Set();let failed=false;
  try{const r=await s.fetch(`/wpqa-baseline-${randomBytes(6).toString('hex')}.txt`);if(r&&ok(r))for(const rule of Object.keys(SIGNS))if(SIGNS[rule](r))skip.add(rule);}catch(error){if(!error.network)throw error;failed=true;}
  for(const [rule,path] of targets){
    if(failed||skip.has(rule)){evidence.unchecked.push(path);continue;}
    let r;try{r=await s.fetch(path);}catch(error){if(!error.network)throw error;failed=true;evidence.unchecked.push(path);continue;}
    if(!r||r.status>=300&&r.status<400&&!slashOnly(r))evidence.unchecked.push(path);else if(ok(r)&&SIGNS[rule](r))evidence.findings.push(finding(rule,r));
  }
}
// 同じoriginへの転送だけ最大3段たどる（各段を件数に含める）。別originへの転送・上限到達は null（未確認）。
async function follow(s,path){
  let r=await s.fetch(path);
  for(let i=0;r&&i<3&&r.status>=300&&r.status<400;i++){let to;try{to=new URL(r.headers.location??'',r.url);}catch{return null;}if(to.origin!==r.url.origin)return null;r=await s.fetch(to.pathname+to.search);}
  return r&&(r.status<300||r.status>=400)?r:null;
}
// fn が null を返した項目と、通信できなくなった後の項目は未確認にする。
function steps(evidence){let failed=false;return async(path,fn)=>{if(failed)return void evidence.unchecked.push(path);try{if(await fn()===null)evidence.unchecked.push(path);}catch(error){if(!error.network)throw error;failed=true;evidence.unchecked.push(path);}};}
const add=(evidence,rule,path,observation)=>evidence.findings.push({rule,level:RULES[rule].level,path,observation});
export function inspectMixed(html,pageURL){
  const out={active:[],passive:[]};if(new URL(pageURL).protocol!=='https:')return out;const $=load(html);let base=pageURL;try{const b=$('base[href]').attr('href');if(b?.trim())base=new URL(b,pageURL).href;}catch{}
  const rel=re=>e=>re.test($(e).attr('rel')??''),put=(kind,sel,attr,keep=()=>true)=>$(sel).each((_,e)=>{if(!keep(e))return;for(const v of attr==='srcset'?($(e).attr(attr)??'').split(',').map(x=>x.trim().split(/\s+/)[0]):[$(e).attr(attr)])try{if(!v?.trim())continue;const u=new URL(v.trim(),base);if(u.protocol==='http:'&&!out[kind].includes(u.href))out[kind].push(u.href);}catch{}});
  for(const [sel,attr] of [['script[src]','src'],['iframe[src]','src'],['frame[src]','src'],['form[action]','action'],['object[data]','data'],['embed[src]','src']])put('active',sel,attr);put('active','link[href]','href',rel(/(?:^|\s)stylesheet(?:\s|$)/i));
  for(const [sel,attr] of [['img[src]','src'],['img[srcset]','srcset'],['source[src]','src'],['source[srcset]','srcset'],['video[src]','src'],['video[poster]','poster'],['audio[src]','src'],['track[src]','src']])put('passive',sel,attr);put('passive','link[href]','href',rel(/(?:^|\s)icon(?:\s|$)/i));
  return out;
}
export function inspectHeaders(r){
  const h=r.headers,https=r.url.protocol==='https:',csp=h['content-security-policy']??'',out=[],put=(rule,observation)=>out.push({rule,observation});
  if(https&&!/max-age\s*=\s*"?0*[1-9]/i.test(h['strict-transport-security']??''))put('missing-hsts',h['strict-transport-security']?'Strict-Transport-Security の max-age が0か読み取れません':'Strict-Transport-Security ヘッダーがありません');
  if(!csp.trim())put('missing-csp','Content-Security-Policy ヘッダーがありません（Report-Only は数えません）');
  if(!/^\s*nosniff\s*$/i.test(h['x-content-type-options']??''))put('missing-nosniff','X-Content-Type-Options: nosniff がありません');
  if(!/^\s*(?:deny|sameorigin)\b/i.test(h['x-frame-options']??'')&&!/(?:^|[;,])\s*frame-ancestors\s/i.test(csp))put('missing-frame-protection','X-Frame-Options もCSPの frame-ancestors もありません');
  if(!(h['referrer-policy']??'').trim())put('missing-referrer-policy','Referrer-Policy ヘッダーがありません');
  const jar=(r.cookies??[]).map(c=>{const [pair,...attrs]=c.split(';');return {name:pair.split('=')[0].trim().slice(0,60),attrs:attrs.map(a=>a.split('=')[0].trim().toLowerCase())};});
  for(const [rule,attr,need] of [['cookie-missing-secure','Secure',https],['cookie-missing-httponly','HttpOnly',true],['cookie-missing-samesite','SameSite',true]]){const bad=need?jar.filter(c=>!c.attrs.includes(attr.toLowerCase())):[];if(bad.length)put(rule,`Cookie ${jar.length}件中${bad.length}件に ${attr} がありません：${bad.map(c=>c.name).join('、')}（値は保存していません）`);}
  if(isHtml(r)){const n=inspectMixed(r.text,r.url.href).passive.length;if(n)put('passive-mixed-content',`http: で読み込む画像・動画・音声等 ${n}件（URLは保存していません）`);}
  return out;
}
async function headerArea(o,s,evidence){const step=steps(evidence);for(const path of o.paths??['/'])await step(path,async()=>{const r=await follow(s,path);if(!r||!ok(r))return null;for(const x of inspectHeaders(r))add(evidence,x.rule,r.path,x.observation);});}
async function mixed(o,s,evidence){const step=steps(evidence);for(const path of o.paths??['/'])await step(path,async()=>{const r=await follow(s,path);if(!r||!ok(r))return null;const n=isHtml(r)?inspectMixed(r.text,r.url.href).active.length:0;if(n)add(evidence,'active-mixed-content',r.path,`http: で読み込むスクリプト・スタイルシート・iframe・フォーム送信先 ${n}件（URLは保存していません）`);});}
const coreVer=($,base)=>$('script[src],link[href]').filter((_,e)=>{try{const u=new URL($(e).attr('src')??$(e).attr('href'),base);return /\/wp-(?:includes|admin)\//.test(u.pathname)&&!/\/(?:jquery|vendor)\//.test(u.pathname)&&/^\d+\.\d+(?:\.\d+)?$/.test(u.searchParams.get('ver')??'');}catch{return false;}}).length;
async function disclosure(o,s,evidence){
  const top=(o.paths??['/'])[0],dir=top.replace(/[?#].*$/,'').replace(/\/?$/,'/'),wp=o.wpPath??'/',step=steps(evidence),put=(...a)=>add(evidence,...a);
  await step(top,async()=>{const r=await follow(s,top);if(!r||!ok(r))return null;
    for(const [k,name] of [['server','Server'],['x-powered-by','X-Powered-By']])if(/\d/.test(r.headers[k]??''))put('server-version-exposed',r.path,`${name} ヘッダーに版番号：${r.headers[k].slice(0,80)}`);
    if(!isHtml(r))return;const $=load(r.text),n=coreVer($,r.url);
    if($('meta[name="generator" i]').filter((_,e)=>/WordPress\s*\d/i.test($(e).attr('content')??'')).length)put('wp-version-exposed',r.path,'meta generator に WordPress の版番号があります');
    if(n)put('wp-version-exposed',r.path,`コアのCSS・JSの ver= に版番号 ${n}件`);});
  await step(wp+'readme.html',async()=>{const r=await follow(s,wp+'readme.html');if(!r)return null;if(ok(r)&&/<title>[^<]*WordPress[^<]*ReadMe/i.test(r.text)&&/Version\s+\d+\.\d/i.test(r.text))put('wp-version-exposed',r.path,'readme.html に版番号があります');});
  await step(dir+'feed/',async()=>{const r=await follow(s,dir+'feed/');if(!r)return null;if(ok(r)&&!isHtml(r)&&/<generator\b[^>]*>[^<]*\?v=\d|<generator\b[^>]*\bversion="\d/i.test(r.text))put('wp-version-exposed',r.path,'フィードの generator に版番号があります');});
  await step(dir+'wp-json/wp/v2/users',async()=>{const r=await follow(s,dir+'wp-json/wp/v2/users');if(!r)return null;const n=ok(r)&&!isHtml(r)&&/^\s*\[\s*\{/.test(r.text)?(r.text.match(/"slug"\s*:\s*"/g)??[]).length:0;if(n)put('rest-user-enumeration',r.path,`ユーザーのスラッグを含むJSON ${n}件（先頭64KiB内。ユーザー名は保存していません）`);});
  await step(dir+'?author=1',async()=>{const r=await s.fetch(dir+'?author=1');if(!r)return null;if(r.status>=300&&r.status<400&&/\/author\/[^/?#]+/.test(r.headers.location??''))put('author-enumeration',r.path,'投稿者ページ（/author/…/）への転送 1件（転送先は取得せず、ユーザー名は保存していません）');});
  await step(wp+'xmlrpc.php',async()=>{const r=await follow(s,wp+'xmlrpc.php');if(!r)return null;if(/XML-RPC server accepts POST requests only/i.test(r.text))put('xmlrpc-enabled',r.path,`GET に「POSTのみ受け付ける」と応答（HTTP ${r.status}）。POSTは送っていません`);});
}
const AREAS={exposure,mixed,headers:headerArea,disclosure};
const SCOPE={mixed:'HTTPSの代表ページ（最大5件）のHTML先頭64KiBから、http: の script・iframe・form action・stylesheet 等を数える。HTTPのページは対象外（HTTPS転送は transport で確認）。URLは保存しない。',
  headers:'代表ページ（最大5件）の応答ヘッダー（HSTSはHTTPS時のみ）、Set-Cookie の Secure（HTTPS時のみ）・HttpOnly・SameSite（Cookie名だけ記録し値は保存しない）、HTML先頭64KiB内の http: の画像等の件数。',
  disclosure:'先頭の代表ページの meta generator・Server・X-Powered-By・コアのCSS/JSの ver=、readme.html、feed/、wp-json/wp/v2/users、?author=1 の転送先（Location だけを見て転送先は取得しない）、xmlrpc.php へのGET。POSTは送らない。ユーザー名は件数だけ記録する。',
  exposure:'既知の機密パスへの読み取り（GET）のみ。HTTP 200だけでは判定せず、内容の特徴が一致したときだけ露出とする。存在しないURLの応答（soft 404）と同じ特徴のルールは判定不能として未確認に入れる。本文は保存しない。'};
// requestFactory は互換のため受け取るが使わない（本文を64KiBで打ち切るため undici で取得する）。
export async function run({check,config,attach=async()=>{},signal}){
  validateRuntime(check,config);const o=check.options,area=AREAS[o.area];if(!area)blocked('未実装');
  const s=session({config,signal,limit:LIMITS[o.area]}),evidence={schema:'security-baseline-v1',area:o.area,requests:s.requests,findings:[],unchecked:[],scope:SCOPE[o.area]};
  try{await area(o,s,evidence);}finally{await attach('security-baseline',evidence);}
  const required=check.required!==false,hit=[...new Set(evidence.findings.filter(f=>!required||f.level==='problem').map(f=>f.rule))];
  if(hit.length)assert.fail(hit.join('\n'));
  if(evidence.unchecked.length)blocked('上限または通信失敗により未確認：'+evidence.unchecked.join('、'));
  return {expectations:{area:o.area,wpPath:o.wpPath??'/'},actual:evidence};
}
