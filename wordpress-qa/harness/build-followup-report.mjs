import fs from 'node:fs';
import path from 'node:path';
import {writeReport,escapeHTML as e} from './lib/results.mjs';
const base=path.resolve('../../debug-evidence/mannendo-staging');
const root=path.join(base,'runs');
const runs=fs.readdirSync(root).filter(n=>n>='2026-10-23T08-32-18').sort().flatMap(n=>{try{const r=JSON.parse(fs.readFileSync(path.join(root,n,'results.json')));return r.runStatus==='finished'?[r]:[];}catch{return [];}});
const latest=runs.at(-1);if(!latest)throw Error('No finished run');
const rows=new Map(latest.rows.map(r=>[r.id,{...r,run:null,reason:'現在の台帳に登録済み。選択して実行した記録なし。'}]));
for(const run of runs)for(const r of run.rows)if((r.selected||r.review||run.aggregation)&&rows.has(r.id))rows.set(r.id,{...r,run:run.runId,configHash:run.configHash});
const all=[...rows.values()];
const counts=Object.fromEntries(['pass','fail','blocked','not_run','review','not_applicable'].map(s=>[s,all.filter(r=>r.status===s).length]));
const endpoint=(run,file)=>`/api/projects/b1036ad97b52/runs/${run}/files?path=${encodeURIComponent(file)}`;
const clean=s=>String(s??'').replace(/\x1b\[[0-9;]*m/g,'');
const labels={pass:'合格',fail:'不合格',blocked:'実行不能',not_run:'未実施',review:'要レビュー',not_applicable:'適用外'};
const tips={
 'color-contrast':['文字が背景に埋もれ、弱視の利用者などが読みづらい。','外観→カスタマイズの文字色・背景色を確認。設定で調整できない箇所は追加CSSまたはテーマを修正し再測定。'],
 'link-name':['読み上げでリンク先の目的を判断できない。','固定ページ・ウィジェット・メインビジュアル設定でリンク文言や画像の代替テキストを設定。装飾リンクはテーマ側で適切な名前を付ける。'],
 'label-content-name-mismatch':['表示文言と読み上げ名が違い、音声操作で指定しづらい。','検索ボタンの表示文言を含むアクセシブル名に修正。管理設定に該当項目がなければテーマのボタン実装を修正。'],
 'label':['入力欄の目的が読み上げで分からない。','お問い合わせ→フォーム編集でlabelと入力欄を対応付ける。EC欄はテンプレート側を修正。']
};
function detail(r){
 let body=`<p><code>${e(r.id)}</code> / ${e(r.suite)} / ${r.run?e(r.run):'未実施'}</p>`;
 if(r.id.startsWith('axe.')&&r.run){
  const file=r.evidence?.find(f=>/attachments\/axe-.*\.json$/.test(f));
  if(file){const a=JSON.parse(fs.readFileSync(path.join(root,r.run,file)));body+=`<p>再現：${e(a.url)}を幅${a.testEnvironment.windowWidth}pxで表示し、下記要素を確認。</p>`;
   for(const v of a.violations){const t=tips[v.id]??['支援技術による操作や内容理解に支障が出る可能性。','対象要素の名前・関連付け・HTML構造を修正し再検査。'];body+=`<h4>${e(v.id)}（${e(v.impact)}）</h4><p>影響：${e(t[0])}<br>修正：${e(t[1])}</p><ul>${v.nodes.map(n=>`<li><code>${e(n.target.join(' / '))}</code><pre>${e(n.failureSummary)}</pre></li>`).join('')}</ul>`;}
  }
 }else body+=`<pre>${e(clean(r.reason))}</pre>`;
 if(r.run)body+=`<p><a href="${endpoint(r.run,'report.html')}">元の実行報告書</a></p>`;
 body+=(r.evidence??[]).map(f=>/\.png$/.test(f)?`<details><summary>画像：${e(path.basename(f))}</summary><img loading="lazy" src="${endpoint(r.run,f)}" alt="${e(r.title)} の検査証拠"></details>`:`<a class="evidence" href="${endpoint(r.run,f)}">${e(path.basename(f))}</a>`).join('');
 return `<details class="case"><summary><b>${e(r.title)}</b> <span class="${r.status}">${labels[r.status]}</span></summary>${body}</details>`;
}
const out=path.join(root,latest.runId);const observations=JSON.parse(fs.readFileSync(path.join(base,'coverage-evidence/admin-observations.json')));
const copied=['admin-observations.json','order-1036-cancelled.png','contact-stored-2593.png','contact-mail-settings.png'];
fs.mkdirSync(path.join(out,'followup'),{recursive:true});for(const f of copied)fs.copyFileSync(path.join(base,'coverage-evidence',f),path.join(out,'followup',f));
const img=f=>`<details><summary>管理画面の証拠画像（10月23日）</summary><img loading="lazy" src="${endpoint(latest.runId,'followup/'+f)}" alt="管理画面の確認証拠"></details>`;
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>万年堂 再テスト・残課題報告</title><style>body{font:16px/1.7 system-ui;background:#f4f7fb;color:#203045;max-width:1160px;margin:30px auto;padding:0 22px}section,.intro{background:white;padding:22px;margin:20px 0;border-radius:12px}h1{font-size:28px}h2{font-size:22px}summary{cursor:pointer;padding:10px}.case{border-top:1px solid #d9e1e9;padding:8px}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}pre{background:#f3f5f7;padding:10px;font-size:13px}img{max-width:100%;border:1px solid #aaa}a{color:#145a9c}.evidence{display:block;font-size:13px}.fail{color:#b72030}.blocked,.review,.not_run{color:#835900}.pass{color:#19704a}.cards{display:flex;gap:15px;flex-wrap:wrap}.cards b{font-size:27px;display:block}.cards div{background:#edf2f8;padding:15px;min-width:100px}</style>
<h1>万年堂テストサイト — 再テストと残課題</h1><p>作成：${e(new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))} JST / <a href="/">QAコンソールへ</a></p>
<div class="intro"><strong>必須条件は未達です。</strong><p>現在の台帳${all.length}件について、10月23日の全体検査とその後の部分再テストをケースIDで統合しました。各ケースの「最新の選択実行」を採用し、部分実行で選択しなかった項目は過去の結果を消していません。全件を本日再実行した結果ではありません。設定変更前の結果も含み、詳細から実施日と元の証拠を確認できます。</p><div class="cards">${Object.entries(counts).map(([s,n])=>`<div class="${s}">${labels[s]}<b>${n}</b></div>`).join('')}</div><p>件数はケース数であり、原因の数ではありません。管理画面の実査所見は自動結果と別記しています。基準画像未承認を合格に変更していません。</p></div>
<section><h2>残っている不具合・検査失敗</h2><p>カテゴリURL /archives/category/item/item-neko のcanonical不一致、存在しないURLのHTTP 302（期待404）、アクセシビリティ違反を検出。アクセシビリティはPC・スマホの同一原因を複数ケースで検出しています。</p><p>カテゴリは管理画面の商品カテゴリ・リンク設定とSEO/リダイレクト設定を確認。存在しないURLはリダイレクト系設定を確認し、設定で直せない場合はテーマ・サーバーの404処理を修正します。通信や操作待機による失敗がある場合は詳細に記録し、サイト不具合と断定しません。</p>${all.filter(r=>r.status==='fail').map(detail).join('')}</section>
<section><h2>管理画面で確認した問題（10月23日の実査）</h2><h3>問い合わせ通知設定の警告3件</h3><p>管理者通知・自動返信の送信元ドメイン不一致と、防御不足に関する警告を確認。メールの迷惑判定や不正利用につながる可能性がありますが、未着の事実は未確認です。お問い合わせ→フォーム31→メールで、送信元をサイト側で利用可能な同一ドメインのメールへ変更し、返信先はReply-Toに設定。フォームのスパム対策設定も確認して警告解消後に到達確認を行います。</p>${img('contact-mail-settings.png')}<h3>Flamingoの件名・送信者が置換されない</h3><p>受信記録2593で件名 [your-subject]、送信者 [your-name] &lt;[your-email]&gt; がそのまま表示。本文は保存されていますが、受信一覧から送信者・内容を識別しづらい状態です。お問い合わせ→フォーム31→その他の設定でFlamingo用の件名・名前・メール項目を実際のフォームタグへ対応付けます。新規送信で確認し、過去記録の自動修正は前提にしません。</p>${img('contact-stored-2593.png')}<p>管理画面の所見は実査日付きのレビューとして記録しています。自動検査の結果と区別してください。</p></section>
<section><h2>実行不能 — 前提が不足している項目</h2><p>管理設定の自動検査はQA実行用の認証状態が未設定。以前のログイン画面ではSiteGuard画像認証があり、管理画面の手動実査とは分けています。その他は期待値・実行アダプター・受信証拠などが不足。各詳細に不足内容を記載しました。</p>${all.filter(r=>r.status==='blocked').map(detail).join('')}</section>
<section><h2>未実施</h2>${all.filter(r=>r.status==='not_run').map(detail).join('')||'<p>なし</p>'}</section>
<section><h2>要レビュー・基準画像未承認</h2><p>候補画像の取得は画像差分検査の合格を意味しません。デザイン確認も未完了です。受注登録・取消の過去証拠は台帳へレビュー登録しています。現在の再注文を実行した意味ではありません。</p>${all.filter(r=>r.status==='review').map(detail).join('')}</section>
<section><h2>受注・通知の確認範囲</h2><p>受注1036：銀行振込、商品616円＋送料850円＝1466円。10月23日に注文一覧と開き直した詳細でキャンセルを確認。今回は新たな注文・メール送信を行っていません。</p>${img('order-1036-cancelled.png')}<p>問い合わせ2593のmail_sentはサーバーの送信処理結果です。管理者・購入者・問い合わせ者の受信箱への到達を証明するものではありません。到達確認は受信証拠/APIが未設定のため未完了です。</p></section>
<section><h2>合格した検査</h2><p>合格の有効範囲は各実行時点とその検査内容です。注文・問い合わせのpreview成功を送信成功と扱わないでください。</p><details><summary>${counts.pass}件の一覧と証拠</summary>${all.filter(r=>r.status==='pass').map(detail).join('')}</details></section>
<section><h2>集計元・追跡情報</h2>${runs.map(r=>`<p><a href="${endpoint(r.runId,'report.html')}">${e(r.runId)}</a><br><small>設定SHA256 ${e(r.configHash)}</small></p>`).join('')}<p><a href="${endpoint(latest.runId,'followup/aggregate.json')}">ケース別の採用結果（JSON）</a></p></section></html>`;
fs.writeFileSync(path.join(out,'followup-summary.html'),html);
fs.writeFileSync(path.join(out,'followup/aggregate.json'),JSON.stringify({createdAt:new Date().toISOString(),method:'Latest selected result per current case; not a full fresh run',counts,rows:all},null,2));
latest.rows[0].evidence=[...new Set([...(latest.rows[0].evidence??[]),'followup-summary.html','followup/aggregate.json',...copied.map(f=>'followup/'+f)])];
writeReport(out,latest);
console.log(JSON.stringify({counts,run:latest.runId,url:'http://127.0.0.1:4311'+endpoint(latest.runId,'followup-summary.html')}));

