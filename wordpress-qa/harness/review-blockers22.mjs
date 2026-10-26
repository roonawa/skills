import fs from 'node:fs';
const base='../../debug-evidence/mannendo-staging',file=base+'/site.json',c=JSON.parse(fs.readFileSync(file));
const entries={
inventory:['review','先行検査済み・範囲確認','REST4投稿型149件を照合。台帳外の送信完了・SNS埋め込み2URLを検査に追加し、ブログパーツ2件のトップ転送を記録。残りはメディア個別ページ・分類アーカイブ・非REST投稿型の対象範囲の確認。','inventory'],
metadata:['review','運用仕様の確認','管理画面にSEO SIMPLE PACKあり。既存title/description等の存在検査・6ページ観測済み。正しい広告文言や構造化データ内容は設定値からは決められない。承認済み内容仕様が必要。'],
crawl:['review','運用仕様の確認','既存robots検査は非公開方針との不一致を検出済み。全旧URL・bot別の運用仕様が必要。管理認証不足ではない。'],
'contact-errors':['review','先行検査済み・境界仕様の確認','管理画面の必須名・メール形式・必須本文・同意の4条件を照合済み。以前のサーバー必須入力テストも合格。フォーム定義にminlength/maxlength指定なし。上限値と超過時の振る舞いは運用仕様の確認が必要。','contact-schema'],
'contact-retry':['blocked','実装を継続できる・既知不具合あり','通信遮断時の送信中固着は既存検査で不合格。二重送信・戻る・再送と登録件数の照合は未実装。今回の管理認証でFlamingo照合は可能だが、修正前の失敗から成功復帰を合格にしない。'],
notification:['blocked','利用者側の受信確認手段が必要','通知先webinfo@ailesys.co.jpの受信箱または受信APIが未接続。管理画面保存・mail_sentは受信証拠にしない。'],
autoreply:['blocked','利用者側の受信確認手段が必要','自動返信ON・返信先[contact-email]は管理設定で合格。添付なし。返信メールの受信箱または受信APIが必要。'],
analytics:['review','運用仕様の確認','SEO設定にGoogle計測欄とCF7連携画面がある。存在だけでは計測の要否・イベント・同意方針を確定できない。承認済み測定IDとイベント仕様が必要。'],
order:['blocked','実装を継続できる','銀行振込注文・キャンセルの既存証拠あり。配送設定画面を特定し、国内JP・配送時間設定を調査済み。地域別送料・在庫競合は設定データの追加取得と注文検査の実装が残る。'],
'order-notification':['blocked','利用者側の受信確認手段が必要','管理者・購入者通知を注文識別子で照合できる受信箱/APIが必要。受注の保存だけでメール到着を合格にしない。'],
'visual-selection':['review','運用仕様の確認','7ページ×2幅の表示検査と画像候補を実行済み。CMS公開データの取得ができた。長文・画像なしの例外ページの選定と表示完了条件の承認は残る。'],
browsers:['review','利用者側の対象端末確認','ChromiumおよびFirefox代表3ページは実施済み。対応対象のブラウザー・実機OS・画面幅を確定して残りを検査する。'],
keyboard:['review','実機・支援技術の確認','問い合わせフォーカス移動は実施済み。読み上げと代替文の意味、モーダル全体は未検証。支援技術・対象導線を確認して評価する。'],
publishing:['blocked','一部合格・残りの実装が必要','標準投稿で下書き→公開→更新→非公開を実行し、専用テスト投稿の削除まで確認。固定ページ・商品・SNS埋め込み等の投稿型別検査が残る。','post-lifecycle'],
roles:['blocked','利用者側のロール認証が必要','管理者認証は利用可能。別ロールの既存テストアカウントと許可/拒否仕様が必要。ユーザーや権限を推測で作成・変更しない。'],
cache:['blocked','一部合格・残りの実装が必要','標準投稿を更新後、管理者画面で新本文の表示・旧本文の不在を3回確認済み。匿名/ロール別・一覧/検索・非公開キャッシュは別認証と検査実装が残る。','post-lifecycle'],
scheduled:['blocked','一部実行・定期処理の指定が必要','標準投稿の予約公開をサーバー時刻に基づき検査。結果はjourney.admin-progress-scheduledを参照。バックアップ等の定期処理は対象ジョブ・実行間隔・成功条件の指定が必要。','scheduled'],
update:['blocked','利用者側の隔離環境が必要','更新候補は管理画面に表示されるが、共有テストサイトを更新対象として推測しない。隔離コピーと更新対象・ロールバック条件の指定が必要。'],
restore:['blocked','利用者側の隔離環境が必要','復元先・バックアップ取得時刻・復元後照合データの指定が必要。共有サイトへの復元は行わない。'],
performance:['review','運用仕様の確認','トップ・商品・カートの計測値あり。ロード時間・転送量等の合否予算が未確定。現在値を正解として採用しない。'],
membership:['not_applicable','現設定では対象外','Welcart基本設定のmembersystem_state=deactivateとmembersystem_point=deactivateを実査。現構成のWelcart会員操作は対象外。有効化した場合は会員間データ分離検査を必須へ戻す。'],
multilingual:['review','適用範囲の確認','プラグイン一覧と代表6ページで翻訳プラグイン・hreflangを確認していない。独自実装や将来要件まで非該当とは断定できないため、多言語の適用要否を確認する。']
};
for(const [key,[status,owner,note]] of Object.entries(entries)){const check=c.checks.find(x=>x.id==='coverage-'+key);if(!check)throw Error(key);check.kind=status==='blocked'?'unconfigured':'human-review';check.options={instructions:`【管理認証は利用可能／${owner}】${note} 調査証拠: coverage-evidence/blockers22-discovery.json。`};}
fs.writeFileSync(file,JSON.stringify(c,null,2));
fs.writeFileSync(base+'/coverage-evidence/blockers22-review.json',JSON.stringify({at:new Date().toISOString(),entries},null,2));
console.log(JSON.stringify(Object.values(entries).reduce((a,[s])=>(a[s]=(a[s]??0)+1,a),{})));
