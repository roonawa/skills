import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sameOrigin} from '../config.mjs';
import {request} from 'undici';
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
      r={url:u,path,status:res.statusCode,headers:h,contentType:h['content-type']??'',bytes:body.length,text:body.toString('utf8')};Object.assign(row,{status:r.status,contentType:r.contentType,bytes:r.bytes});
    }catch(error){if(signal?.aborted)cancelled();throw Object.assign(new Error(`BLOCKED: 通信に失敗しました：${path}`),{network:true,cause:error});}
    finally{last=Date.now();}
    if(r.status===401||r.status===407)blocked(`閲覧に認証が必要です（HTTP ${r.status}）：${path}`);
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
const AREAS={exposure};
const SCOPE={exposure:'既知の機密パスへの読み取り（GET）のみ。HTTP 200だけでは判定せず、内容の特徴が一致したときだけ露出とする。存在しないURLの応答（soft 404）と同じ特徴のルールは判定不能として未確認に入れる。本文は保存しない。'};
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
