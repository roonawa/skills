import {load} from 'cheerio';
import {compareVersions,publicData} from './security-inventory.mjs';
export const WP_RELEASES='https://api.wordpress.org/core/version-check/1.7/';
export const SWELL_RELEASES='https://swell-theme.com/category/update/';
const comparison=(a,b)=>{const n=compareVersions(a,b);if(n===null)throw Error('公式版とのバージョン比較ができません');return n===0?'current':n<0?'outdated':'ahead';};
export async function officialSupplement(asset,type,assets,read=publicData){
 const base={checkedAt:new Date().toISOString(),reviewRequired:true,limit:'公式更新情報との比較です。全既知脆弱性の照合・コードの同一性・改変の有無は保証しません。'};
 if(type==='core'){
  const data=JSON.parse(await read(WP_RELEASES));
  const offers=(data.offers??[]).filter(x=>x.response==='upgrade'&&/^\d+\.\d+(?:\.\d+)?$/.test(x.version));
  if(!offers.length)throw Error('WordPress公式の最新安定版を取得できません');
  const latest=offers.sort((a,b)=>compareVersions(b.version,a.version))[0].version;
  return {...base,source:WP_RELEASES,referenceVersion:latest,comparison:comparison(asset.version,latest),action:'「ダッシュボード → 更新」で公式版と更新通知を確認してください。更新が必要な場合はバックアップ・検証環境での確認後に適用し、再検査します。CVE照合の未確認範囲は技術担当者が確認してください。'};
 }
 if(type!=='theme')return null;
 if(asset.parentName){
  const parents=assets.filter(a=>a.name===asset.parentName&&!a.parentName&&a.slug!==asset.slug);
  if(parents.length!==1)throw Error('子テーマの親テーマを一意に確認できません');
  const parent=parents[0],details=await officialSupplement(parent,'theme',assets,read);
  return {...base,source:details?.source??'https://developer.wordpress.org/themes/advanced-topics/child-themes/',parent:{slug:parent.slug,name:parent.name,version:parent.version,...details},comparison:'child-review',limit:'親テーマの確認結果を子テーマの安全性に引き継ぎません。独自コードの簡易静的検査は別欄に記載します。配布版との差分や実行条件の確認は含みません。',action:'「外観 → テーマ」で親テーマとバージョンを確認してください。技術担当者が子テーマのPHP・JavaScript・上書きテンプレートを配布元との差分で確認します。管理画面からの親テーマ更新だけでは独自コードの問題は解消しません。'};
 }
 if(asset.slug!=='swell'||asset.name!=='SWELL')return null;
 const $=load(await read(SWELL_RELEASES)),entries=[];
 $('a[href]').each((_,el)=>{const title=$(el).text().replace(/\s+/g,' ').trim(),v=title.match(/SWELL\s*[–—-]?\s*ver\.\s*(\d+\.\d+(?:\.\d+)?)/i)?.[1];if(!v)return;try{const u=new URL($(el).attr('href'),SWELL_RELEASES);if(u.origin==='https://swell-theme.com'&&/^\/update\/\d+\/$/.test(u.pathname)&&!u.search&&!u.hash)entries.push({version:v,url:u.href});}catch{}});
 if(!entries.length)throw Error('SWELL公式更新情報のバージョンを取得できません');
 const latest=entries.sort((a,b)=>compareVersions(b.version,a.version))[0];
 return {...base,source:latest.url,indexSource:SWELL_RELEASES,referenceVersion:latest.version,comparison:comparison(asset.version,latest.version),action:'「外観 → テーマ」または「ダッシュボード → 更新」でSWELLの更新通知を確認してください。公式更新情報と照合し、必要に応じてSWELL提供元にセキュリティ修正・同梱ライブラリの対応状況を確認します。公開更新記事は完全な脆弱性一覧ではありません。'};
}
