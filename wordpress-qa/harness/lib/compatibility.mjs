import {compareVersions,phpSupportRows} from './security-inventory.mjs';

// PHP・WordPress 本体を上げる前に、プラグイン・テーマが公開している動作要件と照合する。
// 照合するのは WordPress.org に掲載された「宣言」だけで、実際に動くかは検証環境で確かめる必要がある。
export const WP_RELEASES='https://api.wordpress.org/core/version-check/1.7/';
export const SCOPE='WordPress.org に掲載された動作要件（必要なPHP・動作確認済みのWordPress・最終更新日）との照合です。実際の動作は保証しません。本体・PHPを上げる前に、検証環境で主要画面とフォームを確認してください。';
const STALE_DAYS=730;
const numeric=v=>typeof v==='string'&&/^\d+(?:\.\d+){1,3}$/.test(v);
const branch=v=>numeric(v)?v.split('.').slice(0,2).join('.'):null;

export function latestWordPress(data){
 const versions=(Array.isArray(data?.offers)?data.offers:[]).map(o=>o?.current).filter(numeric);
 if(!versions.length)throw Error('WordPressの最新版を取得できません');
 return versions.reduce((a,b)=>compareVersions(a,b)>=0?a:b);
}
// 公式サポート中の系列のうち、いちばん新しいもの。
export function phpTargetBranch(html){
 let rows;try{rows=phpSupportRows(html);}catch{throw Error('PHPの公式サポート系列を取得できません');}
 return rows.map(r=>r.branch).reduce((a,b)=>compareVersions(a,b)>=0?a:b);
}
export function infoURL(type,slug){
 const s=encodeURIComponent(slug);
 return type==='theme'
  ?`https://api.wordpress.org/themes/info/1.2/?action=theme_information&request%5Bslug%5D=${s}&request%5Bfields%5D%5Bsections%5D=0`
  :`https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request%5Bslug%5D=${s}&request%5Bfields%5D%5Bsections%5D=0&request%5Bfields%5D%5Bversions%5D=0&request%5Bfields%5D%5Breviews%5D=0`;
}
const pageURL=(type,slug)=>`https://wordpress.org/${type==='theme'?'themes':'plugins'}/${encodeURIComponent(slug)}/`;
const label=type=>type==='theme'?'テーマ':'プラグイン';

// target：{php:'8.4',wordpress:'6.9'}。結果の status は ok / caution（要確認）/ incompatible（要件を満たさない・配布停止）/ unlisted（WordPress.org 未掲載）。
export function evaluateCompatibility(asset,info,target,now=new Date()){
 const type=asset.type==='theme'?'theme':'plugin',source=pageURL(type,asset.slug),findings=[],notes=[];
 const add=(level,title,fix)=>findings.push({level,title,fix,asset:{slug:asset.slug,name:asset.name,version:asset.version,type},sources:[{url:source}],cves:[]});
 const base={slug:asset.slug,name:asset.name,type,installed:asset.version??null,active:asset.active??null,source,latest:null,requiresPhp:null,requiresWordPress:null,tested:null,lastUpdated:null,updateFirst:false,notes,findings};
 if(info?.error){
  if(/closed/i.test(String(info.error))){
   add('incompatible',`${label(type)}の配布が停止されています（WordPress.org）`,'今後の本体・PHPへの対応や修正は期待できません。代替の'+label(type)+'への移行を検討してください。');
   return {...base,status:'incompatible'};
  }
  add('unlisted',`WordPress.org に掲載がないため、配布元で対応状況を確認してください`,`有料・独自の${label(type)}は、配布元の更新履歴や動作要件で、移行先の PHP ${target.php}・WordPress ${target.wordpress} に対応しているかを確認してください。`);
  return {...base,status:'unlisted'};
 }
 const latest=numeric(info?.version)?info.version:null,requiresPhp=numeric(info?.requires_php)?info.requires_php:null,requiresWordPress=numeric(info?.requires)?info.requires:null,tested=type==='plugin'&&numeric(info?.tested)?info.tested:null;
 const updated=Date.parse(String(info?.last_updated??'').replace(/(\d)(am|pm)/i,'$1 $2')),lastUpdated=Number.isFinite(updated)?new Date(updated).toISOString().slice(0,10):null;
 const updateFirst=!!(latest&&numeric(asset.version)&&compareVersions(asset.version,latest)<0);
 if(updateFirst)notes.push(`動作要件は最新版 ${latest} のものです。本体・PHPを上げる前に、先にこの${label(type)}を最新版へ更新してください（現在 ${asset.version}）。`);
 if(requiresPhp&&compareVersions(requiresPhp,target.php)>0)add('incompatible',`PHP ${target.php} では動作要件を満たしません（PHP ${requiresPhp} 以上が必要）`,`PHPを上げる場合は ${requiresPhp} 以上の系列を選ぶか、この${label(type)}の要件を配布元で確認してください。`);
 if(requiresWordPress&&compareVersions(requiresWordPress,target.wordpress)>0)add('incompatible',`WordPress ${target.wordpress} では動作要件を満たしません（WordPress ${requiresWordPress} 以上が必要）`,`本体を ${requiresWordPress} 以上へ上げるまで、この${label(type)}は更新できません。`);
 if(type==='plugin'&&tested&&compareVersions(branch(tested),branch(target.wordpress))<0)add('caution',`WordPress ${branch(target.wordpress)} での動作確認が宣言されていません（確認済みは ${tested} まで）`,'配布元の更新を待つか、検証環境で本体を上げて、この'+label(type)+'の画面・機能が動くかを確認してください。');
 if(type==='plugin'&&!tested)notes.push('動作確認済みの WordPress の版が宣言されていません。');
 if(lastUpdated&&now.getTime()-updated>STALE_DAYS*86400000)add('caution',`2年以上更新されていません（最終更新 ${lastUpdated}）。新しい PHP ${target.php} での動作は配布元が確認していない可能性があります`,'検証環境で PHP・本体を上げて動作を確認し、問題があれば代替の'+label(type)+'への移行を検討してください。');
 const status=findings.some(f=>f.level==='incompatible')?'incompatible':findings.length?'caution':'ok';
 return {...base,status,latest,requiresPhp,requiresWordPress,tested,lastUpdated,updateFirst};
}
