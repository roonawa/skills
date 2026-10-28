import {zipFiles} from './zip.mjs';
import {escapeHTML as e} from './results.mjs';
export function resultDownload(report,read){
 const names=new Set(['report.html','issue-report.html','designer-report.html','results.json']);
 for(const row of report.rows??[])for(const file of row.evidence??[])if(/\.(png|jpe?g)$/i.test(file))names.add(file);
 const files=[],missing=[];let total=0;
 for(const name of names){if(name.startsWith('/')||name.includes('\\')||name.includes(':')||name.split('/').some(x=>!x||x==='..'||x==='.'))continue;
  let data;try{data=read(name);}catch{missing.push(name);continue;}
  total+=Buffer.byteLength(data);if(total>250*1024*1024)throw Error('結果が大きいため個別の報告書・画像を取得してください');files.push({name,data});
 }
 const index=`<!doctype html><meta charset="utf-8"><title>検査結果</title><style>body{font:16px/1.8 sans-serif;max-width:960px;margin:40px auto;padding:20px}td,th{padding:8px;border:1px solid #ccc}table{border-collapse:collapse}</style><h1>${e(report.name??'サイト')}：検査結果</h1><p>実行：${e(report.runId)} / 状態：${e(report.runStatus)}</p><p>ZIPを展開してこのファイルを開いてください。認証セッション・設定ファイル・通信トレースは含めていません。報告書と画像には検査対象の情報が含まれます。</p><ul>${files.filter(f=>/html$/.test(f.name)).map(f=>`<li><a href="${e(f.name)}">${e(f.name)}</a></li>`).join('')}</ul><table><tr><th>検査</th><th>結果</th><th>理由</th></tr>${(report.rows??[]).map(r=>`<tr><td>${e(r.title)}</td><td>${e(({pass:'合格',fail:'不合格',blocked:'実行不能',not_run:'未実施',review:'確認待ち'})[r.status]??r.status)}</td><td>${e((r.reason??'').replace(/\x1b\[[0-9;]*m/g,''))}</td></tr>`).join('')}</table><details><summary>同梱ファイル</summary><ul>${files.map(f=>`<li><a href="${e(f.name)}">${e(f.name)}</a></li>`).join('')}</ul></details>${missing.length?`<p>未生成・取得できないファイル：${e(missing.join('、'))}</p>`:''}<p>詳細ログ・通信トレースなど、同梱していない証拠へのリンクはサーバーのUIで確認してください。</p>`;
 return zipFiles([{name:'index.html',data:index},...files]);
}
