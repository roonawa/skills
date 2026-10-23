import fs from 'node:fs';
import path from 'node:path';
import {writeReport,escapeHTML as e} from './lib/results.mjs';
const root=path.resolve('../../debug-evidence/mannendo-staging'),src=path.join(root,'submit-tests'),run='2026-10-23T04-17-13-615Z-3166a037',dir=path.join(root,'runs',run);
const read=n=>JSON.parse(fs.readFileSync(path.join(src,n)));
const bank=read('bank-submission-evidence.json'),contact=read('contact-submission-evidence.json'),credit=read('credit-connect-evidence.json');
const result=credit.snapshots.find(s=>s.name==='credit-gateway-result');
if(!bank.submission.text.includes('お買い上げありがとうございました')||!contact.text.includes('送信完了しました')||!result.text.includes('ERR001'))throw Error('Expected evidence not found');
const ui='http://127.0.0.1:4311',api=`${ui}/api/projects/b1036ad97b52/runs/${run}`,url=api+'/files?path=submit-results.html';
const notes={
 'manual.checkout-flow':`銀行振込の注文確定を1回実行。商品616円＋送料850円＝1466円。完了表示を確認。識別番号 ${bank.submission.token}。受注番号は画面に表示なし。管理画面での受注登録・在庫・メール到達は未確認のため全体は確認待ち。注文は発送・請求不要と明記。取消は未実施。`,
 'manual.contact-form':`問い合わせを1回送信し、送信完了画面を確認。識別番号 ${contact.token}。入力メール webinfo@ailesys.co.jp。実際の通知宛先・自動返信設定・メール到達は未確認。接続済みGmailで識別番号検索は0件だが、設定先の受信箱と一致するか不明のため未着とは判定しない。`,
 'manual.payment-gateway':'カード決済のテスト環境への送信でERR001。加盟店コードまたはホスト番号の不一致、解約済・休止中という応答で、カード入力画面に進めない。原因の確定には管理画面のテスト環境用設定とルミーズ契約情報の照合が必要。カード情報の不足とは別の接続不具合。'
};
const picture=(file,label)=>`<details open><summary>${e(label)}</summary><img alt="${e(label)}" src="data:image/png;base64,${fs.readFileSync(path.join(src,file)).toString('base64')}"></details>`;
fs.writeFileSync(path.join(dir,'submit-results.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>万年堂 注文・問い合わせ送信の検証</title><style>body{font:16px/1.8 system-ui;max-width:1050px;margin:30px auto;padding:20px}td,th{border:1px solid #ccd4df;padding:12px;text-align:left}table{border-collapse:collapse;width:100%}img{max-width:100%}details{border:1px solid #ccc;padding:15px;margin:20px 0}aside{background:#fff1da;padding:18px}.error{border:3px solid #bd2323;padding:15px}a{color:#1758aa}</style><h1>注文・問い合わせ送信の検証</h1><p>2026年10月23日／テストサイトのみ。依頼に基づき送信を実施。</p><table><tr><th>項目</th><th>結果</th></tr><tr><td>銀行振込の注文確定</td><td>完了画面を確認。注文登録・通知到達は管理画面での照合待ち。</td></tr><tr><td>問い合わせ送信</td><td>完了画面を確認。通知到達は未確認。</td></tr><tr><td>カード決済</td><td>不合格：ルミーズのテスト環境でERR001。カード入力前に停止。</td></tr><tr><td>管理画面の調査</td><td>ログイン画面は画像認証あり。ID・パスワード入力済み、ユーザーの認証完了待ち。</td></tr></table><h2>カード決済の問題</h2><div class="error"><strong>${e(result.text)}</strong></div><p>再現：商品をカートに入れる → 顧客情報 → クレジットカードを選択 → 内容確認 →「上記内容で注文する」。遷移先 https://test.remise.jp/rpgw2/pc/card/paycard.aspx で上記エラー。利用者はカード情報を入力できず、決済完了に進めません。</p><p>管理画面での対応候補：Welcart Shopのクレジット決済設定で、ルミーズの稼働環境・加盟店コード・ホスト番号をテスト用の設定情報連絡票と照合。値が一致している場合はルミーズ側のテスト契約の有効状態を確認。現時点では設定未閲覧のため、特定の値が間違いとは断定していません。設定変更はしていません。</p><p>テストカード番号はルミーズへ問い合わせる案内です。<a href="https://www.welcart.com/docs/settlement/Remise.pdf">Welcart公式のルミーズ決済運用マニュアル（接続テスト）</a>。まずERR001を解消する必要があります。</p>${picture('credit-gateway-result.png','カード入力前のERR001')}<h2>送信したテストデータと確認範囲</h2><ul>${Object.values(notes).map(n=>`<li>${e(n)}</li>`).join('')}</ul>${picture('bank-submitted-result.png','銀行振込注文の完了画面')}${picture('contact-after-submit.png','問い合わせの送信完了画面')}<aside>テスト注文は取消未実施。受注記録を確認でき次第、このテスト注文のみ後片付けが必要です。メールの再送や注文の二重実行は行っていません。</aside></html>`);
for(const file of ['bank-submission-evidence.json','contact-submission-evidence.json','credit-connect-evidence.json','bank-submitted-result.png','contact-after-submit.png','credit-gateway-result.png'])fs.copyFileSync(path.join(src,file),path.join(dir,file));
const report=JSON.parse(fs.readFileSync(path.join(dir,'results.json')));
fs.copyFileSync(path.join(dir,'results.json'),path.join(dir,'results.before-submit-review.json'));
for(const row of report.rows)if(notes[row.id]){row.reason=notes[row.id];row.details={...row.details,submissionFollowup:{at:new Date().toISOString(),notes:notes[row.id]}};row.evidence=[...new Set([...(row.evidence??[]),'submit-results.html',...(row.id==='manual.checkout-flow'?['bank-submission-evidence.json','bank-submitted-result.png']:row.id==='manual.contact-form'?['contact-submission-evidence.json','contact-after-submit.png']:['credit-connect-evidence.json','credit-gateway-result.png'])])];}
writeReport(dir,report);
const old=path.join(dir,'staging-summary.html');let html=fs.readFileSync(old,'utf8');html=html.replace('<h1>万年堂 テストサイト検証報告</h1>',`<h1>万年堂 テストサイト検証報告</h1><aside><strong>最新：注文・問い合わせ送信を実施しました。</strong>銀行振込と問い合わせは完了画面を確認。カード決済はERR001。<a href="${url}">最新結果と証拠画像</a>。以下の以前の検証記録よりこちらを優先してください。</aside>`);fs.writeFileSync(old,html);
const boot=await (await fetch(ui+'/api/bootstrap')).json();
const headers={Origin:ui,'Content-Type':'application/json','X-QA-Token':boot.token};
const review=await fetch(api+'/review',{method:'POST',headers,body:JSON.stringify({rowId:'manual.payment-gateway',outcome:'fail',reviewer:'Codex',notes:notes['manual.payment-gateway'],evidence:[url,api+'/files?path=credit-connect-evidence.json']})});
if(!review.ok)throw Error(`Review failed: ${review.status} ${await review.text()}`);
const issue=await fetch(api+'/issue-report',{method:'POST',headers,body:JSON.stringify({includeHistory:true,notes:'最新追加検証はsubmit-results.html参照。'+Object.values(notes).join('\n')+' 初回javascript.shopguide-pcとsnapshot.cart-spの失敗は終了処理エラー。通常スクロール再検査の8画面ではJS例外0・横はみ出し0。初回画像の空白はアニメーション表示準備の不足。'})});
if(!issue.ok)throw Error(`Issue report failed: ${issue.status}`);
const check=await fetch(url);if(!check.ok)throw Error('Report not accessible');console.log(JSON.stringify({url,http:check.status,issue:await issue.json()}));
