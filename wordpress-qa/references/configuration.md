# 共通設定と結果契約

設定はUTF-8 JSON。未知のキー・不正な型・同一カテゴリ内のID重複はエラーにする。実装上の正は `../harness/lib/config.mjs`、動く例は `../harness/examples/site.demo.json`。

## サイト設定

| キー | 内容 |
|---|---|
| name | サイト名（必須） |
| baseURL | スキーム＋ホスト＋ポート。パス、認証情報を含めない（必須） |
| environment | local / staging / production（必須） |
| pages | 1件以上の検査対象。自動的な全サイト巡回はしない |
| policies / journeys / visuals / manual | 対象を配列で指定。省略時は空配列。機能があるのに省略すると未検査になるので、統括で必要性を確認する |
| timeoutMs | 条件待ち・通信の上限。既定15000、1000～120000。各テスト全体はこの4倍 |
| headersEnv | サイト向けHTTPヘッダーのJSONを持つ環境変数名。設定に秘密値を直接書かない |
| outputDir / baselineDir | JSONファイルの場所からの相対パス、または絶対パス。既定runs / baselines |
| revision | 検査対象のコミット・デプロイID。未設定なら未指定と記録 |
| allowProductionJourneys | 本番での操作検査の明示的な許可。既定false。設定trueは利用者からの権限取得の代わりではない |
| mailpit | `url`と任意の`headersEnv`。検証用メールAPIのみ指定 |
| checks | 追加検査配列。各要素はid/title/suite/kind/options/required/timeoutMs。[追加検査ガイド](extended-checks.md)参照 |
| allowTestWrites | 追加検査によるテストデータの変更許可。既定false。本番ではtrueでも書込み系を拒否 |
| trustedAdapters | 運用処理の別名とESMモジュールの対応。UIでは起動時登録のみ |

ブラウザーでのheadersEnvは第三者アセットへ転送しない。設定された認証ヘッダーを使う同一originの応答が別originへ転送する場合は中止する。外部SSOはこの方式の対象外。案件moduleのrequest fixtureも認証ヘッダーを持つため、同一origin専用とし、外部APIには別クライアントを使う。

## 項目設定

各項目の `id` は英小文字開始の英小文字・数字・ハイフン、最大64文字。`required` は既定true。参考検査だけfalseにする。

### pages

必須: `id`, `path`, `indexable`（boolean）, `canonical`（期待する絶対URL）。
任意: `title`, `description`, `lang`（指定時は完全一致）, `links`（既定true）, `template`, `reason`。

`path`はbaseURLと同じorigin。HTTP 200とHTML、空でないtitle、単一canonical、一般robots/metaとX-Robots-Tagのnoindexを検査する。canonicalは実際の最終URLを基準に相対URLを解決して完全一致。`indexable:false`はnoindexを要求する。robots.txt・検索エンジンの実際の登録状態・bot別指定を含むSEO全体の保証ではない。
HTMLのbase[href]がある場合、canonicalと内部リンクの相対URLはその基準を反映する。

内部リンク検査は指定ページのHTML内のa[href]を重複除去してGETする。同一originのみ、ハッシュ部分は除外。外部リンク・ハッシュの存在・JSのみのリンクは対象外。転送は最大5回、別originへの転送は停止して不合格。ログアウト等、GETで副作用を持つURLがある場合はlinks:falseとし、対象を選ぶ独自検査を用意する。

### policies

必須: `id`, `path`, `statuses`（許容HTTPステータス配列）。
任意: `location`（期待転送先。3xxを許容する場合必須）, `forbiddenText`（本文に含まれてはいけない文字列、大文字小文字を区別しない）, `requiredHeaders`（ヘッダー名→期待文字列）。

転送を追わず応答を検査する。例のwp-config.php方針は全サイト共通の正解ではない。禁止文字列検査は既知の兆候の検出であり、機密漏洩の完全検出ではない。XML-RPCのGET応答だけでPOST処理の無効化を証明しない。

### journeys

必須: `id`, `module`（設定ファイルからの相対パスまたは絶対パスのJSモジュール）。任意: `title`, `reason`。
モジュールは信頼できるローカルコードのみ。`export async function run(context)`を実装する。任意のsetup/cleanupをexportでき、setup/run失敗時もcleanupを呼ぶ。

context: `page`, `request`, `expect`, `config`, `token`, `testInfo`, `mail(expected)`, `attach(name,data)`。
実行不能は `throw new Error('BLOCKED: メールAPIの認証設定が未提供')` のように例外で示す。戻り値のstatusは解釈しない。人の確認待ちはmanualへ登録する。Playwrightの単なるskipはnot_runとなる。
通常のPlaywrightコードで操作と具体的な期待結果をassertする。空のrunや操作だけのrunはランナーでは検出できないため、レビューと不具合注入で検出力を確認する。

mail引数: `to`（文字列または配列、Toの完全一致）, `subject`（完全一致）, `textIncludes`, `count`（既定1）, `timeoutMs`, `settleMs`（既定500ms）。一意tokenを本文か件名へ含める。検索後に本文を取得してtokenを再照合する。所定件数で観測期間を満たした時に成功。観測期間より後の重複配送、Cc/Bcc、添付、実SMTP到達性は別途検査。共有メールの全削除はしない。

### visuals

必須: `id`, `pageId`, `width`, `height`, `ready`（表示準備完了のセレクタ）。
任意: `mask`（除外セレクタ配列）, `maxDiffPixels`（既定0）, `axe`（既定true）, `reason`。

代表ページはテンプレート、重要導線、長文・画像なし等の例外から選ぶ。組込検査は横はみ出し、可視imgの読込、JS例外、使用フォントのerror状態、画像比較、axeのWCAG A/AA指摘。背景画像・遅延処理すべての完了・必須CTAの存在は組込で保証せず、必要ならjourneyでassertする。マスクは変動要素だけに限定し理由を台帳へ記載。

### manual

必須: `id`, `title`, `reason`。`status`はreview（既定）またはnot_applicable。後者には適用外理由を記す。
人が確認した合格を設定へ書き込む機能はない。手動確認は証拠付きの別記録として公開判定に統合する。ハーネスは必須manualのreviewを消さない。

## 結果・終了コード

`results.json`には設定ハッシュ、実行ID、環境、revision、ランタイム、全項目と証拠の相対パスを保存する。`report.html`はCSS埋込で直接開ける。証拠リンクを渡す場合は実行フォルダー全体を渡す。

| 状態 | 意味 |
|---|---|
| pass | 実行して期待結果に一致 |
| fail | 期待結果と不一致、または期待状態の待機・テスト全体が時間切れ |
| blocked | 前提不足・HTTP/API通信不可（通信タイムアウト含む）・実行中断などで判定不能 |
| not_run | 未選択・未実施。成功扱いしない |
| not_applicable | 適用外。理由が必要 |
| review | 基準画像未承認・人による判断待ち |

終了コード: 0＝台帳の必須条件充足、1＝失敗検査あり、2＝未確認/環境障害/設定エラー。必須項目のpassまたは理由付きnot_applicable以外、ランナーエラー、0件を全体成功にしない。参考項目のfailも終了1で注意を促す。終了0でも台帳外の品質は保証しない。

## 管理設定

`admin` suiteで認証済みREST・管理画面の設定を読み取り、期待値と照合できます。UIの「管理設定」で実行し、項目を選ぶと期待値・取得値・証拠を確認できます。[設定方法と認証](admin-settings.md)を参照してください。
