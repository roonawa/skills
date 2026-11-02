import {createHash} from 'node:crypto';
const tags={a:'リンク',button:'ボタン',input:'入力欄',textarea:'入力欄',select:'選択欄',iframe:'埋め込みフレーム',img:'画像',p:'文章',span:'文字',div:'領域',section:'領域',nav:'ナビゲーション',h1:'見出し',h2:'見出し',h3:'見出し'};
const findings={'frame-title':'フレームの識別名がありません','color-contrast':'文字と背景のコントラストが基準を満たしていません','scrollable-region-focusable':'スクロール領域のキーボード操作に関する違反を検出しました','image-alt':'画像の代替テキストに関する違反を検出しました','link-name':'リンクの読み上げ名がありません','button-name':'ボタンの読み上げ名がありません',label:'入力欄のラベルに関する違反を検出しました'};
export function safeLocationUrl(value,base){
 try{if(typeof value!=='string'||!value)return '';const u=new URL(value,base);if(!['http:','https:'].includes(u.protocol)||u.origin!==new URL(base).origin)return '';return u.origin+u.pathname;}catch{return '';}
}
export function configuredLocation(row,config,base){
 const id=row.id.slice(row.id.indexOf('.')+1),visual=config.visuals?.find(v=>v.id===id),page=config.pages?.find(p=>p.id===(visual?.pageId??id));
 const check=config.checks?.find(c=>c.id===id),policy=config.policies?.find(p=>p.id===id);
 return {url:safeLocationUrl(page?.path??policy?.path??check?.options?.path,base),width:Number.isInteger(visual?.width)?visual.width:null};
}
export function elementLocation(shot,base,fallback={}){
 const tag=/^\s*<([a-z0-9]+)/i.exec(shot.html??'')?.[1]?.toLowerCase();
 const width=shot.viewport?.width;
 return {url:safeLocationUrl(shot.url,base)||fallback.url||'',width:Number.isInteger(width)&&width>0&&width<20000?width:fallback.width??null,
  ref:Array.isArray(shot.target)?createHash('sha256').update(JSON.stringify(shot.target)).digest('hex').slice(0,24):null,element:tags[tag]??'対象要素',finding:findings[shot.rule]??'この要素で検査基準との不一致を検出しました',number:Number.isSafeInteger(shot.number)&&shot.number>0?shot.number:null};
}
export function locationText(location){
 return [location.url||'対象ページは未特定',location.width?`画面幅 ${location.width}px`:'',location.number?`画像の「指摘 ${location.number}」`:'',location.element,location.finding].filter(Boolean).join(' ／ ');
}
