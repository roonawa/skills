import fs from 'node:fs';
import path from 'node:path';
import {writeReport} from './lib/results.mjs';
const root=path.resolve('../../debug-evidence/mannendo-staging');
const dir=path.join(root,'runs/2026-10-23T04-17-13-615Z-3166a037');
const evidence=JSON.parse(fs.readFileSync(path.join(root,'submit-tests/admin-followup.json')));
const note='管理画面で注文00001035を確認。備考WPQA-20261023044925081が一致。銀行振込・商品616円＋送料850円＝1466円、未入金。対応状況をキャンセルに変更し、受注データ更新成功と保存後の選択値を確認。受注登録と取消は確認済み。受注通知先はwebinfo@ailesys.co.jp。実際のメール到着は未確認（接続済みGmailは別アカウント、メール配送ログ用プラグインは見当たらず）。全体判定は確認待ち。';
for(const name of ['admin-followup.json','bank-cancelled-admin.png'])fs.copyFileSync(path.join(root,'submit-tests',name),path.join(dir,name));
const p=path.join(dir,'results.json'), report=JSON.parse(fs.readFileSync(p));
if(!fs.existsSync(path.join(dir,'results.before-admin-followup.json')))fs.copyFileSync(p,path.join(dir,'results.before-admin-followup.json'));
const row=report.rows.find(r=>r.id==='manual.checkout-flow');
row.reason=note; row.details={...row.details,adminFollowup:evidence};
row.evidence=[...new Set([...row.evidence,'admin-followup.html','admin-followup.json','bank-cancelled-admin.png'])];
writeReport(dir,report);
const image=fs.readFileSync(path.join(dir,'bank-cancelled-admin.png')).toString('base64');
fs.writeFileSync(path.join(dir,'admin-followup.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>万年堂 テスト注文の登録・取消確認</title><style>body{font:16px/1.8 system-ui;max-width:1000px;margin:30px auto;padding:20px}td,th{border:1px solid #ccc;padding:12px}table{border-collapse:collapse}img{max-width:100%}aside{padding:20px;background:#fff3dc}</style><h1>テスト注文の登録・取消確認</h1><p>${evidence.at}</p><table><tr><th>注文番号</th><td>00001035</td></tr><tr><th>受注登録</th><td>確認済み（2026年10月23日 13:49:59 JST）</td></tr><tr><th>支払方法・金額</th><td>銀行振込／1,466円／未入金</td></tr><tr><th>取消</th><td>キャンセルを保存済み</td></tr><tr><th>メール到着</th><td>確認待ち。通知先はwebinfo@ailesys.co.jp</td></tr></table><h2>操作と確認内容</h2><p>Welcart Management → 受注リスト → 注文00001035を開く → 備考の識別子WPQA-20261023044925081を照合 → 対応状況を「キャンセル」に変更 →「設定を更新」。更新成功メッセージと保存後のキャンセル表示を確認しました。</p><aside>メール配送ログ用プラグインは見当たらず、接続済みGmailは通知先と別アカウントです。未着とも到着済みとも判定していません。webinfo@ailesys.co.jpの受信箱で、注文番号00001035または識別子を照合してください。</aside><p>決済検査の今回の対象は銀行振込です。以前のカード決済ERR001は過去の参考記録です。</p><h2>保存直後の管理画面</h2><img alt="受注データ更新成功・注文00001035・キャンセル表示" src="data:image/png;base64,${image}"></html>`);
for(const name of ['submit-results.html','staging-summary.html','issue-report.html']){
 const file=path.join(dir,name);if(!fs.existsSync(file))continue;
 const banner='<aside style="padding:20px;background:#e4f4ee;border:2px solid #24684d"><strong>最新の確認結果：注文00001035は受注登録確認・キャンセル保存済み。</strong> 通知先設定は確認済み、メール到着は確認待ち。以下の取消未実施・管理画面未確認の記述は過去時点の記録です。今回の決済対象は銀行振込です。<a href="admin-followup.html">最新の確認結果と証拠画像</a></aside>';
 let html=fs.readFileSync(file,'utf8');html=html.replace(/(<h1[^>]*>[\s\S]*?<\/h1>)/,`$1${banner}`);fs.writeFileSync(file,html);
}
console.log(JSON.stringify({order:evidence.orderId,cancelled:true,report:path.join(dir,'admin-followup.html')}));
