import {inspectChildTheme} from '../child-theme-code.mjs';
import {officialSupplement} from '../official-software.mjs';
import {wordpressSessionStatus} from '../wordpress-session.mjs';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {phpAdvisory} from '../php-advisories.mjs';
import {parseInventory,publicData,evaluateFeed,phpLifecycle,PROVIDER,PHP_SOURCE} from '../security-inventory.mjs';
export const kinds=['software-security'];
export function validate(check){assert.equal(check.suite,'authz');assert(['core','plugin','theme','php'].includes(check.options.component));assert(Object.keys(check.options).every(k=>['component','adminPath'].includes(k)));if(check.options.adminPath)assert(/^\/(?:[\w-]+\/)*wp-admin\/$/.test(check.options.adminPath));}
export async function run({check,config,requestFactory,attach=async()=>{},signal}){
 validate(check);const component=check.options.component;const evidence={schema:'software-security-v1',component,checkedAt:new Date().toISOString(),assets:[],findings:[],unknown:[],scope:'既知情報とのバージョン照合。攻撃による実証・全脆弱性の網羅診断ではありません。'};let context;
 try{
  const raw=process.env.WPQA_UI_ADMIN_STATE;if(!raw)throw Error('管理画面のログインを設定してください');let state;try{state=JSON.parse(raw);}catch{throw Error('管理画面の認証形式を確認してください');}
  const base=new URL(config.baseURL);if(!Array.isArray(state.cookies)||!Array.isArray(state.origins)||state.cookies.some(c=>typeof c.domain!=='string'||c.domain.replace(/^\./,'')!==base.hostname)||state.origins.some(o=>o.origin!==base.origin))throw Error('管理認証の対象ホストが一致しません');
  const session=wordpressSessionStatus(state,check.options.adminPath??'/wp-admin/');if(session.expired)throw Error('保存済みWordPress認証の内部期限が切れています（'+session.expiresAt+'）。管理画面の認証からログインを確認して保存してください');context=await requestFactory.newContext({storageState:state,timeout:20000});const admin=check.options.adminPath??'/wp-admin/';
  async function get(file){if(signal?.aborted)throw Error('検査が中断されました');const url=new URL(admin+file,base);const r=await context.get(url.href,{maxRedirects:0});try{if(r.status()!==200)throw Error('管理画面に接続できません（HTTP '+r.status()+'）。認証・権限・管理パスを確認してください');const text=await r.text();if(text.length>6*1024*1024||!text.includes('id="wpadminbar"'))throw Error('認証済み管理画面を確認できません');return text;}finally{await r.dispose();}}
  const health=await get('site-health.php?tab=debug');let plugins=component==='plugin'?await get('plugins.php?plugin_status=all'):'';
  if(plugins){const $=load(plugins);const pages=Number($('.total-pages').first().text().trim()||1);if(!Number.isInteger(pages)||pages<1||pages>20)throw Error('プラグイン一覧のページ数を確認できないか、取得上限を超えました');for(let page=2;page<=pages;page++)plugins+=await get('plugins.php?plugin_status=all&paged='+page);}
  const inventory=parseInventory(health,plugins,component==='theme'?await get('themes.php'):'');
  evidence.assets=inventory[component];evidence.scope+=' '+inventory.scope;
  if(!evidence.assets.length)throw Error('対象のバージョン一覧を取得できません');
  if(new Set(evidence.assets.map(a=>a.slug)).size!==evidence.assets.length)throw Error('構成一覧に識別子の重複があります。ページ送り・一覧の取得範囲を確認してください');
  if(component==='php'){
   const asset=evidence.assets[0],advisory=phpAdvisory(asset.version);evidence.phpAdvisory=advisory;
   evidence.scope+=' '+advisory.message+' 判定情報確認日：'+advisory.reviewedAt+'。'+advisory.note;
   if(['affected-range','legacy-risk'].includes(advisory.status))evidence.findings.push({...advisory,asset});
   if(advisory.status==='unknown')evidence.unknown.push(advisory.message);
   evidence.lifecycle=phpLifecycle(asset.version,await publicData(PHP_SOURCE,{signal}));
   if(evidence.lifecycle.state==='eol')evidence.findings.push({asset,title:'PHPの公式セキュリティサポートが終了しています',fix:'WordPress管理画面からは通常変更できません。サーバー担当者・ホスティング管理画面で、延長サポートと修正適用を確認し、検証環境で対応するPHP系列へ移行してください。',sources:[{url:PHP_SOURCE}],cves:[]});
  }else{
   const cache=new Map(),read=async url=>{if(!cache.has(url))cache.set(url,await publicData(url,{signal}));return cache.get(url);};
   if(evidence.assets.length>100)throw Error('構成要素が100件を超えました。検査範囲を分けてください');
   for(const asset of evidence.assets){
    if(component==='theme'&&asset.parentName){asset.childCode=await inspectChildTheme(asset,get,new URL(admin+'theme-editor.php',base).href);evidence.reviewRequired=true;}
    if(!asset.version||!asset.slug||!/^[a-z0-9_-]+$/.test(asset.slug)){evidence.unknown.push(asset.name+'：識別子・バージョンを取得できません');continue;}
    try{const url=PROVIDER+'/'+component+'/'+encodeURIComponent(component==='core'?asset.version:asset.slug)+'/';const data=JSON.parse(await publicData(url,{signal}));const result=evaluateFeed(asset,component,data);asset.lookup={source:url,checkedAt:new Date().toISOString(),status:result.unknown.length?'incomplete':'checked'};evidence.findings.push(...result.findings.map(f=>({...f,asset})));evidence.unknown.push(...result.unknown.map(s=>asset.name+'：'+s));}catch(error){let supplement;try{supplement=await officialSupplement(asset,component,evidence.assets,read);}catch{evidence.unknown.push(asset.name+'：公式補助情報を取得・比較できません。接続許可と公開情報の形式を確認してください');}if(supplement){asset.supplement=supplement;evidence.reviewRequired=true;evidence.scope+=' '+asset.name+'：公式情報を補助照合しました。脆弱性照合の未確認範囲は直接確認が必要です。';}else evidence.unknown.push(asset.name+'：'+(error.message==='脆弱性情報なしと未収録を区別できません'?error.message:'脆弱性情報を取得・照合できません（未収録、接続許可、通信、比較条件を確認）'));}
   }
  }
 }catch(error){evidence.unknown.push(error.message);}finally{await context?.dispose();await attach('security',evidence);}
 if(evidence.findings.length)throw Error('SECURITY_FINDINGS: '+evidence.findings.length+'件の要対応項目があります。security.jsonの証拠を確認してください。'+(evidence.unknown.length?' 未確認事項もあります。':''));
 if(evidence.unknown.length)throw Error('BLOCKED: '+evidence.unknown.join('／'));
 return {...evidence,result:'取得できた範囲で該当なし。安全性の保証ではありません。'};
}
