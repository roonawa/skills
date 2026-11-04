import {load} from 'cheerio';
export const PROVIDER='https://www.wpvulnerability.net';
export const PHP_SOURCE='https://www.php.net/supported-versions.php';
const numeric=v=>typeof v==='string'&&/^\d+(?:\.\d+){1,3}$/.test(v);
export function compareVersions(a,b){if(!numeric(a)||!numeric(b))return null;const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){if((x[i]??0)!==(y[i]??0))return (x[i]??0)>(y[i]??0)?1:-1;}return 0;}
export function affected(version,operator){
 if(!operator||!numeric(version))return null;let bounded=false;
 for(const prefix of ['min','max']){const v=operator[prefix+'_version'],op=operator[prefix+'_operator'];if(v==null&&op==null)continue;bounded=true;const c=compareVersions(version,v);if(c===null||!['lt','le','eq','ne','ge','gt'].includes(op))return null;if(!({lt:c<0,le:c<=0,eq:c===0,ne:c!==0,ge:c>=0,gt:c>0}[op]))return false;}
 return bounded?true:null;
}
export function parseInventory(health,plugins,themes){
 const $=load(health);const text=$('[data-clipboard-text]').attr('data-clipboard-text')??'';const groups={};let group='';
 for(const line of text.split(/\r?\n/)){const h=line.match(/^### ([\w-]+).*###$/);if(h){group=h[1];groups[group]={};}else{const p=line.indexOf(': ');if(group&&p>0)groups[group][line.slice(0,p)]=line.slice(p+2);}}
 const version=v=>v?.match(/^\d+(?:\.\d+){1,3}(?=\s|$)/)?.[0]??null;
 const result={core:[],plugin:[],theme:[],php:[],unknown:[],scope:'通常の単一サイト管理画面。MUプラグイン・drop-in・ネットワーク全体は未確認。'};
 if(groups['wp-core']?.version)result.core.push({slug:'wordpress',name:'WordPress',version:version(groups['wp-core'].version)});
 if(groups['wp-server']?.php_version)result.php.push({slug:'php',name:'PHP（Web実行環境）',version:version(groups['wp-server'].php_version)});
 const p=load(plugins);p('tr[data-plugin]').each((_,e)=>{const row=p(e),file=row.attr('data-plugin'),slug=file?.split('/')[0],name=row.find('.plugin-title strong').text().trim();if(!slug||!name)return;const v=row.find('.plugin-version-author-uri').text().match(/(?:Version|バージョン)\s*([0-9]+(?:\.[0-9]+){1,3})(?=\s|\||$)/i)?.[1];result.plugin.push({slug: /^[a-z0-9-]+$/.test(slug)?slug:null,name:name.slice(0,160),version:v??null,active:row.hasClass('active'),identity:'インストールディレクトリ名（独自改変・名称変更は要確認）'});});
 // Theme admin embeds the installed inventory as JSON; never execute site scripts.
 const t=themes.match(/(?:var\s+)?_wpThemeSettings\s*=\s*(\{[^\n]+\})\s*;/);
 try{const data=JSON.parse(t?.[1]??'null');if(Array.isArray(data?.themes))for(const theme of data.themes){result.theme.push({slug:theme.id,name:String(theme.name??theme.id).replace(/<[^>]*>/g,'').slice(0,160),version:numeric(theme.version)?theme.version:null,active:theme.active===true,...(typeof theme.parent==='string'&&theme.parent?{parentName:theme.parent.replace(/<[^>]*>/g,'').slice(0,160)}:{})});}}catch{}
 if(!result.theme.length)result.unknown.push('テーマ一覧を取得できません。権限・管理画面形式を確認してください。');
 if(!result.plugin.length)result.unknown.push('プラグイン一覧を取得できません。権限・管理画面形式を確認してください。');
 return result;
}
// php.net のサポート期限表から、系列ごとの積極サポート・セキュリティサポートの期限を読む。
export function phpSupportRows(html){
 const $=load(html),rows=[];
 $('table tr').each((_,e)=>{const cells=$(e).find('td');const branch=cells.eq(0).text().trim();if(!/^\d+\.\d+$/.test(branch))return;const dates=cells.slice(1).map((_,td)=>$(td).text().match(/\d{1,2} [A-Za-z]{3} \d{4}/)?.[0]).get().filter(Boolean);if(dates.length>=3)rows.push({branch,active:dates[1],security:dates[2]});});
 if(!rows.length)throw Error('PHP公式のサポート期限表を取得・解釈できません');
 return rows;
}
export function phpLifecycle(version,html,now=new Date()){
 if(!numeric(version))throw Error('PHPの正確なバージョンを取得できません');const rows=phpSupportRows(html);const branch=version.split('.').slice(0,2).join('.'),row=rows.find(r=>r.branch===branch);
 if(!row){if(rows.every(r=>compareVersions(branch,r.branch)<0))return {state:'eol',branch,security:null,source:PHP_SOURCE,note:'現在の公式サポート対象より古い系列です。配布元の延長サポート・バックポート適用は別途確認が必要です。'};throw Error('PHP系列のサポート期限を確認できません');}
 const end=date=>Date.parse(date+' 23:59:59 GMT');if(!Number.isFinite(end(row.security)))throw Error('サポート期限形式が不正です');return {...row,state:now.getTime()>end(row.security)?'eol':now.getTime()>end(row.active)?'security-only':'active',source:PHP_SOURCE,note:'PHP本体の公式サポート期限。個別CVE修正・最新パッチ・配布元の延長サポートを保証しません。'};
}
export async function publicData(url,{fetcher=fetch,signal}={}){
 const u=new URL(url);if(![PROVIDER,new URL(PHP_SOURCE).origin,'https://api.wordpress.org','https://swell-theme.com'].includes(u.origin)||u.username||u.password)throw Error('外部情報源が許可されていません');
 const r=await fetcher(url,{redirect:'error',headers:{Accept:'application/json,text/html'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});if(!r.ok)throw Error('情報源のHTTP応答: '+r.status);let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.length;if(size>4*1024*1024)throw Error('情報源の応答上限超過');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');
}
export function evaluateFeed(asset,type,envelope){
 if(envelope?.error!==0||!envelope.data)throw Error('情報源未収録または応答形式不明');const data=envelope.data;
 const identifiedEmpty=['plugin','theme'].includes(type)&&data.vulnerability===null&&typeof data.name==='string'&&data.name.trim()&&typeof data.link==='string'&&data.link.startsWith('https://wordpress.org/');
 if(!Array.isArray(data.vulnerability)&&!identifiedEmpty)throw Error('脆弱性情報なしと未収録を区別できません');
 if(String(data[type])!==(type==='core'?asset.version:asset.slug))throw Error('情報源の識別子が一致しません');
 const findings=[],unknown=[];
 for(const v of data.vulnerability??[]){const match=type==='core'?true:affected(asset.version,v.operator);if(match===false)continue;if(match===null){unknown.push('比較できない影響バージョン条件');continue;}
 const sources=(v.source??[]).filter(s=>typeof s.link==='string'&&/^https:\/\//.test(s.link)).map(s=>({id:String(s.id??'').slice(0,160),url:s.link,title:String(s.name??'').slice(0,300)}));
 if(!sources.length){unknown.push('脆弱性の出典が不足');continue;}
 findings.push({title:String(v.name??'既知脆弱性').slice(0,300),sources,cves:sources.map(s=>s.id).filter(id=>/^CVE-\d{4}-\d+$/.test(id)),range:v.operator??null,fix:type==='core'?'「ダッシュボード → 更新」で修正版を確認。バックアップ後に検証環境で更新し、表示・フォームを再検査してください。':`「${type==='plugin'?'プラグイン':'外観 → テーマ'}」で修正版と互換性を確認し、バックアップ後に更新してください。更新できない場合は技術担当者へ相談してください。`,cvss:v.impact?.cvss?.score??null});
 }
 if(data.supplychain?.length)unknown.push('追加のサプライチェーン情報があります。出典で確認してください');
 return {findings,unknown};
}
