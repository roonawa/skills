import fs from 'node:fs';import path from 'node:path';
import {loadConfig,catalog} from './lib/config.mjs';import {writeReport,escapeHTML as e} from './lib/results.mjs';
const base=path.resolve('../../debug-evidence/mannendo-staging'),root=path.join(base,'runs'),ctx=loadConfig(path.join(base,'site.json'));
const sourceIds=['2026-10-26T01-06-31-532Z-linked-summary','2026-10-26T01-43-01-072Z-5c100e79','2026-10-26T02-25-36-597Z-de1fedc6'];
const sources=sourceIds.map(id=>JSON.parse(fs.readFileSync(path.join(root,id,'results.json'))));
if(sources.at(-1).configHash!==ctx.configHash||sources.at(-1).rows.filter(r=>r.selected).some(r=>r.status!=='pass'))throw Error('Admin run not verified');
const map=new Map(catalog(ctx.config).map(r=>[r.id,r]));
for(const [i,run] of sources.entries())for(const row of run.rows)if(map.has(row.id)&&(i===0||row.selected))map.set(row.id,{...row,sourceRunId:run.runId});
// Earlier evidence reviews are historical conclusions, not new executions.
for(const row of sources[0].rows.filter(r=>r.review))if(map.has(row.id)&&map.get(row.id).status==='review')map.set(row.id,{...row,sourceRunId:sources[0].runId});
const id=new Date().toISOString().replace(/[:.]/g,'-')+'-admin-summary',dir=path.join(root,id);fs.mkdirSync(dir,{recursive:true});
for(const check of ctx.config.checks.filter(c=>c.id.startsWith('coverage-admin-'))){const row=map.get('check.'+check.id);Object.assign(row,{status:'review',kind:'human-review',manualReview:true,reason:check.options.instructions,instructions:check.options.instructions,review:undefined,sourceRunId:null,evidence:[],details:{reviewedAt:new Date().toISOString(),method:'認証済み管理画面の読み取り専用実査。方針未確定のため合否は保留。'}});}
const rows=[...map.values()];
for(const row of rows){const src=row.sourceRunId;row.selected=false;row.active=false;row.evidence=(row.evidence??[]).filter(f=>src&&fs.existsSync(path.join(root,src,f))).map(f=>{const relative=path.join('sources',src,f);fs.mkdirSync(path.dirname(path.join(dir,relative)),{recursive:true});fs.copyFileSync(path.join(root,src,f),path.join(dir,relative));return relative.replaceAll('\\','/');});if(src)row.reason=`採用元 ${src}\n`+(row.reason??'');}
for(const name of ['admin-settings-observed.json','admin-expectation-basis.json','coverage-links.json'])fs.copyFileSync(path.join(base,'coverage-evidence',name),path.join(dir,name));
for(const r of rows.filter(r=>r.id.startsWith('check.coverage-admin-')))r.evidence.push('admin-settings-observed.json','admin-expectation-basis.json','admin-followup.html');
rows[0].evidence.push('admin-followup.html');
const result={...sources.at(-1),name:'万年堂：管理設定再検査と既存結果の統合',runId:id,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),runStatus:'finished',errors:[],rows,aggregation:{notAFreshRun:true,sourceRuns:sourceIds,createdAt:new Date().toISOString()},runtime:'管理設定14件を再実行。他項目は採用元の既存結果。5分類の残る運用方針は確認待ち。'};writeReport(dir,result);
fs.writeFileSync(path.join(dir,'context.json'),JSON.stringify({...ctx,runDir:dir,config:ctx.config,configHash:ctx.configHash,report:result},null,2));
const prefix=`/api/projects/b1036ad97b52/runs/${id}/files?path=`;
const groups=rows.filter(r=>r.id.startsWith('check.coverage-admin-'));
const admin=rows.filter(r=>r.suite==='admin');
const obs=JSON.parse(fs.readFileSync(path.join(dir,'admin-settings-observed.json')));
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>万年堂 管理設定の再テスト</title><style>body{font:16px/1.8 system-ui;background:#f3f6fa;color:#183048;max-width:1100px;margin:32px auto;padding:0 20px}section{background:white;padding:22px;margin:18px 0;border-radius:10px}table{border-collapse:collapse;width:100%}th,td{padding:12px;border:1px solid #ccd5df;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#155b9a}.pass{color:#17633b}</style><h1>万年堂：管理設定の再テスト</h1><p><a href="/">QAコンソール</a> ／ <a href="${prefix}report.html">全件結果</a></p><section><h2 class="pass">管理設定14件：すべて合格</h2><p>既存9件＋固定トップページの参照先1件＋必要プラグイン4件を再テストしました。管理認証は有効です。管理設定単独実行時に公開ページ用の認証を要求する問題も修正しました。</p><p>管理画面の設定保存・注文・メール送信は行っていません。観測日時：${e(obs.observedAt)}</p><p>全体集計：${e(JSON.stringify(result.summary))}。管理設定以外は過去の結果を採用しており、今回全件を再実行したものではありません。</p></section><section><h2>5分類の残る確認事項</h2><p>「実行不能（認証未設定）」から「確認待ち（方針未確定）」に更新。自動検査の合格と運用設定の妥当性を区別しています。</p>${groups.map(r=>`<h3>${e(r.title)}</h3><p>${e(r.reason)}</p>`).join('')}</section><section><h2>再テストした項目</h2><table><tr><th>項目</th><th>結果</th><th>期待値・実測値</th></tr>${admin.map(r=>`<tr><td>${e(r.title)}</td><td class="pass">${e(r.status)}</td><td><pre>${e(JSON.stringify(r.setting??{},null,2))}</pre></td></tr>`).join('')}</table></section><section><h2>調査証拠</h2><p><a href="${prefix}admin-settings-observed.json">管理画面の現在値・プラグイン一覧</a> ／ <a href="${prefix}admin-expectation-basis.json">期待値の根拠</a></p></section></html>`;
fs.writeFileSync(path.join(dir,'admin-followup.html'),html);
// Keep historical verdicts intact; visibly direct old open reports to the update.
const old=path.join(root,sourceIds[0],'blocker-actions.html');let oldHTML=fs.readFileSync(old,'utf8');const banner=`<section id="admin-auth-update"><h2>更新：管理認証は確認済み</h2><p>管理設定14件は再テストで合格。5分類の残りは方針確認待ちです。この下の内容は認証登録前の記録です。</p><a href="${prefix}admin-followup.html">最新の管理設定報告書を開く</a></section>`;oldHTML=oldHTML.replace(/<section id="admin-auth-update">[\s\S]*?<\/section>/,'');oldHTML=oldHTML.replace('<h1>',banner+'<h1>');fs.writeFileSync(old,oldHTML);
console.log(JSON.stringify({runId:id,summary:result.summary,url:'http://127.0.0.1:4310'+prefix+'admin-followup.html'}));
