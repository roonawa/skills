import * as wordpress from './wordpress.mjs';
import * as reading from './read-only.mjs';
import * as workflows from './workflows.mjs';

export const suites={publishing:'投稿・公開',authz:'権限・非公開',cache:'キャッシュ',operations:'更新・復元',scheduled:'予約・定期処理',delivery:'フォーム・配送',performance:'性能',compatibility:'ブラウザー互換性',seo:'SEO・移行',accessibility:'キーボード・手動評価',commerce:'EC・決済',membership:'会員・データ分離',multilingual:'多言語'};
const handlers=[wordpress,reading,workflows];
export function validateChecks(config){
 config.checks??=[];config.allowTestWrites??=false;
 if(!Array.isArray(config.checks)||typeof config.allowTestWrites!=='boolean')throw new Error('checksは配列、allowTestWritesは真偽値で指定してください');
 if(config.trustedAdapters!==undefined&&(!config.trustedAdapters||Array.isArray(config.trustedAdapters)||typeof config.trustedAdapters!=='object'||Object.entries(config.trustedAdapters).some(([k,v])=>!/^[-a-z0-9]+$/.test(k)||typeof v!=='string'||!v)))throw new Error('trustedAdaptersは別名とモジュールパスの対応表です');
 const seen=new Set();
 for(const check of config.checks){
  if(!check||typeof check!=='object'||Array.isArray(check))throw new Error('check must be an object');
  for(const key of Object.keys(check))if(!['id','title','suite','kind','options','required','timeoutMs'].includes(key))throw new Error('Unknown check.'+key);
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(check.id)||seen.has(check.id))throw new Error('check.id must be a unique lowercase slug');seen.add(check.id);
  if(!Object.hasOwn(suites,check.suite))throw new Error('Unknown extended suite');
  check.title??=check.id;check.required??=true;check.options??={};
  if(typeof check.title!=='string'||!check.title.trim()||typeof check.required!=='boolean'||!check.options||typeof check.options!=='object'||Array.isArray(check.options))throw new Error('Invalid check title/required/options');
  if(check.timeoutMs!==undefined&&(!Number.isInteger(check.timeoutMs)||check.timeoutMs<1000||check.timeoutMs>900000))throw new Error('check.timeoutMs must be 1000..900000');
  if(['unconfigured','human-review'].includes(check.kind)){
   if(typeof check.options.instructions!=='string'||!check.options.instructions.trim()||Object.keys(check.options).some(k=>k!=='instructions'))throw new Error('未設定・手動検査はoptions.instructionsが必要です');
  }else{
   const wpSuite={'wp-lifecycle':'publishing','wp-authz':'authz','wp-cache':'cache','wp-scheduled':'scheduled'}[check.kind];
   if(wpSuite&&check.suite!==wpSuite)throw new Error('WordPress kind/suite mismatch');
   const handler=handlers.find(h=>h.kinds.includes(check.kind));if(!handler)throw new Error('Unknown check.kind: '+check.kind);handler.validate(check,config);
  }
 }
 return config;
}
export async function runCheck(args){
 const check=args.check;
 if(check.kind==='unconfigured')throw new Error('BLOCKED: '+check.options.instructions);
 const handler=handlers.find(h=>h.kinds.includes(check.kind));if(!handler)throw new Error('BLOCKED: 実行処理がありません');
 return handler.run(args);
}
export function coveragePlan(){
 const rows=Object.keys(suites).map(suite=>({id:suite,title:suites[suite],suite,kind:'unconfigured',required:true,options:{instructions:'対象・期待値・必要な認証を設定してください。利用しない機能は手動確認に切り替え、対象外の根拠を記録してください。'}}));
 rows.find(r=>r.suite==='operations').id='update';rows.find(r=>r.suite==='operations').title='更新後の互換性';
 rows.push({id:'restore',title:'バックアップからの復元',suite:'operations',kind:'unconfigured',required:true,options:{instructions:'隔離環境の復元アダプターと復元データの検証条件を設定してください。'}});
 rows.push({id:'human-usability',title:'実機・読み上げ・内容の使いやすさ',suite:'accessibility',kind:'human-review',required:true,options:{instructions:'実機・読み上げで主要導線を確認し、使用端末・ブラウザー・読み上げソフト・操作手順・確認結果を記録してください。'}});
 return rows;
}
