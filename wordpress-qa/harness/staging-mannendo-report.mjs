import fs from 'node:fs';
import path from 'node:path';
import {writeReport,escapeHTML as e} from './lib/results.mjs';
const root=path.resolve('../../debug-evidence/mannendo-staging');
const runId='2026-10-23T04-17-13-615Z-3166a037',dir=path.join(root,'runs',runId);
const report=JSON.parse(fs.readFileSync(path.join(dir,'results.json')));
const journey=JSON.parse(fs.readFileSync(path.join(root,'journey-evidence.json')));
const scroll=JSON.parse(fs.readFileSync(path.join(root,'scroll-evidence.json')));
const ui='http://127.0.0.1:4311';
const boot=await (await fetch(ui+'/api/bootstrap')).json();
const project=boot.projects.find(p=>p.baseURL==='https://mannendo-test.rgr.jp');
if(!project)throw Error('Staging project not found');
const base=`${ui}/api/projects/${project.id}/runs/${runId}/files?path=`;
const notes={
 'manual.checkout-flow':'部分確認済み：商品追加、購入上限1点に対する数量2の警告、数量1への更新、顧客情報への遷移、空入力の必須エラー、架空の顧客情報で配送・支払画面への遷移を確認。注文確定・決済・完了メールは未確認。',
 'manual.contact-form':'部分確認済み：不正メール形式をブラウザーが検知。同意チェック前は送信ボタン無効、チェックボックスを直接クリックすると有効。ラベル文字クリックではチェックされない観測があり、クリック領域は追加調査が必要。フォーム送信・通知メールは未確認。',
 'manual.payment-gateway':'部分確認済み：銀行振込・クレジットカード、ゆうパック・ゆうパケットの選択肢を表示。商品1点616円の小計を確認。送料・税・割引・送料無料境界の最終計算、決済接続・テストモードは未確認。',
 'manual.design-review':'PC1280px・スマホ390pxの4ページを通常スクロールし、8枚を目視確認。横はみ出しなし。スクロール表示要素は表示された。写真・文章の正確性、配色などの最終デザイン承認は保留。初回画像に空白があり、比較基準としての承認はしていない。'
};
const labels={'add-to-cart':'商品をカートに追加','quantity-limit':'購入上限1点を超える数量の警告','customer-input-transition':'顧客情報入力へ遷移','customer-empty-validation':'必須入力のエラー表示','delivery-payment-transition':'配送・支払画面へ遷移','contact-invalid-email-browser':'不正メール形式の検知','contact-consent-state':'同意チェックボックスで送信ボタン有効化'};
const details=journey.checks.map(c=>`<tr><td>${e(labels[c.id]??c.id)}</td><td>${c.pass?'確認済み':'未確定'}</td></tr>`).join('');
function figure(file,label){return `<details><summary>${e(label)}</summary><img loading="lazy" src="data:image/png;base64,${fs.readFileSync(path.join(root,file)).toString('base64')}" alt="${e(label)}"></details>`;}
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>万年堂 テストサイト検証報告</title><style>body{font:16px/1.8 system-ui;max-width:1100px;margin:36px auto;padding:0 24px;color:#203143}h1,h2{line-height:1.4}table{border-collapse:collapse;width:100%}td,th{border:1px solid #cbd5e1;padding:12px;text-align:left;vertical-align:top}th{background:#edf3f8}details{border:1px solid #ccd6e0;margin:12px 0;padding:14px}summary{cursor:pointer}img{max-width:100%;height:auto}aside{background:#fff4df;padding:20px}a{color:#1758aa}</style>
<h1>万年堂 テストサイト検証報告</h1><p>実施日：2026年10月23日／対象：${e(report.baseURL)}。本番とは別の165 URLを対象に実施。</p>
<p><a href="${ui}/">検査UI</a> ｜ <a href="${base}issue-report.html">問題箇所の枠付き画像・再現手順・修正候補</a></p>
<aside>決済・通知メールの設定は不明。注文確定、実決済、問い合わせ送信、会員登録は実施していません。送信前までを検証し、残る範囲は確認待ちのまま記録しています。</aside>
<h2>結果と判定の内訳</h2><table><tr><th>区分</th><th>結果</th></tr><tr><td>URL・メタデータ・リンク・応答方針</td><td>180件中178件合格、2件不合格</td></tr><tr><td>表示の自動検査（32件）</td><td>初回記録：15件合格、10件不合格、7件確認待ち。10件中8件はアクセシビリティ違反、2件はテスト終了処理の通信エラー。</td></tr><tr><td>終了処理エラーの追加確認</td><td>shopguide PCのJavaScriptエラーは独立検査で0件。スマホ空カート画像を再取得。いずれも初回の失敗履歴を残し、サイト不具合とは分けて扱う。</td></tr><tr><td>通常スクロールによる追加確認</td><td>4ページ×2幅の8画面：JavaScript例外0件、横はみ出し0件。画像の基準承認は未実施。</td></tr><tr><td>手動確認4分類</td><td>下記の部分確認を実施。注文・通知の完了、送料・税の最終計算、デザイン最終承認は確認待ち。</td></tr></table>
<h2>サイト側で残る問題</h2><ol><li><strong>カテゴリの一覧がトップへ移動する</strong>：/archives/category/item/item-neko を開くとトップへ移動し、canonicalもトップになる。カテゴリの商品を探せない。管理画面の商品カテゴリ、カテゴリの公開状態、リンク先、転送設定を優先確認。設定がなければテーマのカテゴリ転送処理を調査。</li><li><strong>存在しないURLが404を返さない</strong>：検査用不存在パスで302。リンク切れを正しく案内できない可能性。管理画面のリダイレクト設定・公開制御を確認し、不要な一括転送なら解除。具体的な設定原因は未特定。</li><li><strong>アクセシビリティ8ケース</strong>：4ページのPC/SPでコントラスト不足、リンクの名前不足、検索ボタンの表示名とアクセシブル名の不一致を検出。詳細報告の対象要素・枠付き画像を参照。配色、リンクテキスト、画像代替テキストは管理画面の設定を優先し、テーマ出力のARIAはコード対応を検討。スクロール後に全要素を対象とした追加検査は未実施のため、検出件数は網羅数ではない。</li></ol>
<h2>確認待ち項目の実施範囲</h2><table><tr><th>確認項目</th><th>結果</th></tr>${details}</table><ul>${Object.values(notes).map(n=>`<li>${e(n)}</li>`).join('')}</ul>
<h2>再現手順と操作証拠</h2><p>商品 /archives/2481 を開く → カートへ入れる → 数量2で数量更新（上限1点の警告） → 数量1に戻す → 次へ → 空入力で次へ（必須エラー） → 架空データを入力 → 配送・支払画面。ここで終了し、注文は確定していない。ブラウザーを閉じて検証セッションを終了。カート削除操作は未実施。</p>
${['cart-added','cart-quantity-two','customer-empty-validation','delivery-payment-input','contact-input-only'].map(n=>figure(n+'.png',n)).join('')}
<h2>画像確認と撮影上の注意</h2><p>最初の自動画像はスクロール表示要素が隠れたままのため、空白をサイトの表示不能と断定しない。下記は450pxずつ通常スクロールして撮り直した画像。4ページ×2幅を目視した範囲で主要文章・画像の表示と折返しを確認。薄い文字、背景装飾との重なりは配色・視認性の確認が必要。基準画像への自動承認は行っていない。</p>
${scroll.map(s=>figure(s.file,`${s.url} / ${s.viewport}px：通常スクロール後`)).join('')}
<h2>次の確認に必要な情報</h2><p>決済サービスのテストモードと接続先、通知メールの送信先またはメール捕捉環境、期待する送料・税・送料無料条件、最終デザインの承認者。これらを確定してから注文完了・通知の確認と画像基準の承認を行う。</p></html>`;
fs.writeFileSync(path.join(dir,'staging-summary.html'),html);
if(!fs.existsSync(path.join(dir,'results.before-staging-review.json')))fs.copyFileSync(path.join(dir,'results.json'),path.join(dir,'results.before-staging-review.json'));
for(const row of report.rows){
 if(notes[row.id]){row.reason=notes[row.id];row.details={...row.details,partialReview:{reviewer:'Codex',at:new Date().toISOString(),scope:notes[row.id],complete:false}};row.evidence=[...new Set([...(row.evidence??[]),'staging-summary.html','supplement-journey.json','supplement-scroll.json'])];}
 if(['javascript.shopguide-pc','snapshot.cart-sp'].includes(row.id)){row.details={...row.details,supplement:'初回終了処理で失敗。独立の再確認結果はstaging-summary.html参照。元の自動判定は変更していない。'};row.evidence=[...new Set([...(row.evidence??[]),'staging-summary.html','supplement-scroll.json'])];}
}
fs.copyFileSync(path.join(root,'journey-evidence.json'),path.join(dir,'supplement-journey.json'));
fs.copyFileSync(path.join(root,'scroll-evidence.json'),path.join(dir,'supplement-scroll.json'));
writeReport(dir,report);
const note='テスト環境の追加検証：詳細は同じ実行のstaging-summary.html（各手動確認項目の証拠リンク）参照。URL監査178合格/2不合格、アクセシビリティ8ケース不合格。javascript.shopguide-pcとsnapshot.cart-spの初回失敗は終了時のroute処理エラーであり、サイト不具合とは区別。通常スクロールによる独立再確認8画面はJavaScript例外0、横はみ出し0、画像取得成功。最初の基準候補は非表示アニメーション要素があるため承認しない。'+Object.values(notes).join('\n');
const response=await fetch(`${ui}/api/projects/${project.id}/runs/${runId}/issue-report`,{method:'POST',headers:{Origin:ui,'Content-Type':'application/json','X-QA-Token':boot.token},body:JSON.stringify({includeHistory:true,notes:note})});
if(!response.ok)throw Error(`Report API: ${response.status} ${await response.text()}`);
console.log(JSON.stringify({summaryURL:base+'staging-summary.html',issueURL:base+'issue-report.html',generated:await response.json()}));
for(const file of ['staging-summary.html','issue-report.html']){const r=await fetch(base+file);if(!r.ok)throw Error(`Cannot open ${file}`);console.log(`${file}: HTTP ${r.status}, ${(await r.text()).length} characters`);}
