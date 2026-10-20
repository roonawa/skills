# 追加検査と運用

サイト設定の「追加検査」から項目を登録する。「全観点台帳を追加」は検査漏れを見えるようにするための台帳であり、完成したテストではない。ひな形のURL・セレクター・期待値を案件仕様に合わせる。未設定はblocked、実機等の人手確認はreviewとなる。対象外は理由と証拠を記録する。

## 検査範囲

| suite | kind | 確認内容 |
|---|---|---|
| publishing | wp-lifecycle | 専用投稿の下書き・編集・公開・非公開、匿名からの可視性、後片付け |
| authz | wp-authz | 管理者と別ロールの本人確認、他者投稿の読取・更新拒否、拒否後のデータ不変 |
| cache | wp-cache | 公開内容の更新反映、匿名に非公開内容が漏れないこと |
| scheduled | wp-scheduled | 未来日時の予約、予定前の非公開、予定後の公開 |
| scheduled | operation-drill / cron | 案件の定期処理を実行し、独立したURLから結果データを検証 |
| operations | operation-drill | 更新・復元処理の実行記録と前後データの独立検証 |
| delivery | browser-flow / mail-delivery | エラー表示・連打・添付・送信後状態・相関ID付きメール配送 |
| performance | performance-navigation | cold/warm各条件のロード時間・リソース数・転送量の複数回中央値と予算比較 |
| compatibility | compatibility-screen | Chromium / Firefox / WebKit、画面幅、表示内容・横はみ出し・JSエラー |
| accessibility | keyboard-sequence / human-review | キー操作ごとのフォーカス・表示、人による実機・読み上げ評価 |
| seo | seo-page / seo-robots / seo-sitemap / redirect | canonical・OGP・JSON-LD、robotsの明示ルール、URL掲載/除外、転送先とステータス |
| commerce | browser-flow | テスト決済・注文状態等のサイト固有シナリオ |
| membership | browser-flow | ロール別の会員画面・データ可視性と操作結果 |
| multilingual | browser-flow | 言語切替・表示文言・lang/hreflang等の期待値 |

操作範囲は登録した手順に限る。例えば1件の投稿試験だけでカテゴリー・画像・カスタム投稿型や全プラグインの互換性を保証しない。それらはbrowser-flowや既存journeyへシナリオを追加する。決済・会員・多言語の共通テンプレートに各製品固有の仕様は含まれない。

## 認証と実行条件

管理者のREST認証は設定画面で登録する。ロール別認証も同画面で名前を付けて登録し、必要なロールでWordPressへログインする。値は画面に再表示せず暗号化保存する。

- 管理者REST: `WPQA_UI_ADMIN_HEADERS`
- 管理者ブラウザー: `WPQA_UI_ADMIN_STATE`（投稿ライフサイクルとキャッシュ検査で必要。REST認証だけでは非公開HTMLを閲覧できない）
- ロールeditorのREST: `WPQA_ROLE_EDITOR_HEADERS`
- ロールeditorのブラウザー: `WPQA_ROLE_EDITOR_STATE`
- ハイフンを含むロール名は環境変数ではアンダースコアになる。

`wp-authz`は `role`、`expectedUserId`または`expectedRoles`、`readStatus/readCode`、`updateStatus/updateCode`を設定する。認証失敗そのものを権限制御の成功としない。

書込み系は検証環境と`allowTestWrites:true`が必要。本番では動作しない。WordPress共通検査は自分で作成した投稿だけをfinallyで削除する。browser-flowと運用アダプターの後片付けは案件の手順として定義する。ECには`sandbox:true`も必要だが、この指定だけで接続先の決済がテストモードに切り替わるわけではない。

予約投稿の標準待機は約150秒以上。サイトのタイムゾーン、WP-Cronの起動条件、実際の予約遅延を踏まえ`timeoutMs`や`maxWaitMs`を設定する。

## ブラウザー操作・メール

`browser-flow.options`には`steps`を置く。goto、fill、click、check、select、press、assertVisible、assertText、assertCount、assertURL、assertAttribute、waitForMailを組み合わせ、最後は明示的な期待結果にする。例:

```json
{
  "id":"member-only","suite":"membership","kind":"browser-flow",
  "options":{"roleEnv":"WPQA_ROLE_MEMBER_STATE","steps":[
    {"action":"goto","url":"/members/"},
    {"action":"assertText","selector":"h1","value":"会員ページ"}
  ]}
}
```

メールはMailpit互換APIの`source.url`と`expected`で宛先、件名、本文、通数、添付件数・ファイル名を照合する。件名または本文に`{{token}}`を含め、送信フォームにも同じ値を入れる。同じbrowser-flow内のwaitForMailで確認すると送信と配送を同一トークンで追跡できる。過去のメールを流用しない。Mailpit到着は本番受信箱への配送・迷惑メール判定の保証ではなく、実受信箱評価は別の接続処理または証拠付き手動確認が必要。

## 更新・復元・定期処理

サーバーごとに実行方法が異なるため、信頼済みのESMアダプターを管理者が起動時に登録する。UIから任意コードや任意シェルコマンドを登録する機能は設けない。

```powershell
npm run ui -- --adapters C:\qa\adapters.json
```

`adapters.json`は`{"staging-ops":"./staging-ops.mjs"}`のような別名対応表。UIのoptionsには`adapter:"staging-ops"`だけを指定する。モジュールは`execute({operation,token,baseURL,runDir})`をexportし、実行後に`{performed:true,operation,evidence:["相対パス"]}`を返す。証拠はrunDir配下の実ファイルで、今回のtokenを含む必要がある。

`before`と`after`は同じURLに対し`status`と`bodyIncludes`を検証する。afterには`{{token}}`を含む、処理前に存在しない結果を要求する。ファイルのハッシュと独立したHTTP検証で、何もしていないアダプターの自己申告だけによる合格を防ぐ。ただし、そのURLだけでDB全体の復元を保証するものではない。アダプターは隔離環境の更新/復元、バージョン・主要データ件数・添付実体・整合性・後片付けを検証して証拠に残し、その後に重要導線と表示の全suiteを再実行する。

## 人による確認

kindを`human-review`にして`options.instructions`へ実施手順を記載する。実行後の結果詳細から判定者、結果、具体的な確認内容、証拠参照を登録する。元の自動結果と追記履歴を保存する。自動検査の失敗はこの操作で合格へ上書きできない。設定が変わった古い実行にも判定を追記できない。

実機・スクリーンリーダーは実際の端末/支援技術名とバージョン、操作手順、観察結果を残す。WebKit成功を実機Safari成功とは表現しない。Navigation Timingの計測値をLighthouseスコアや実ユーザーのCore Web Vitalsと呼ばない。必要ならそれぞれ専用の測定証拠を手動確認に添付する。

Firefox/WebKitの実行環境がなければblocked。必要な環境で `npx playwright install firefox webkit` を実行する。sitemap indexは子のurlsetごとにチェックを登録する。robotsは指定ルールの存在照合であり、検索エンジンでの実インデックス反映を保証しない。

## 入力・失敗調査・停止と回収

UIの各検査には日本語の対象・期待値フォームがある。操作手順や期待値の配列も追加・削除できる。詳細JSONは複雑な設定や既存設定との互換性のために残す。「実行前の確認」で未登録認証、未設定項目、書込み条件、ブラウザー不足、アダプター不足を確認する。この確認はネットワーク認証の成功判定ではない。

拡張検査は開始・操作・照合・失敗を `diagnostics/<id>.jsonl` に逐次保存する。結果詳細とHTMLレポートから期待値・取得値・途中経過を確認する。フォーム入力値と認証値は秘匿し、操作結果は件数・真偽・ハッシュなどで記録する。秘密情報を含む画面のスクリーンショットを自動で追加しない。

「検査を停止」は協調停止。進行中の通信などはタイムアウトまで待つ場合があり、投稿のfinallyによる後始末を優先する。停止した実行の台帳は未達のまま保持する。強制終了で残った投稿は作成前から保存した回収台帳で追跡し、履歴の「残ったテストデータを回収」から削除する。同一サイト・認証ユーザー・投稿所有者・固有slug・投稿IDを照合し、既存投稿をIDだけで削除しない。未回収があればUIの次の検査開始を拒否する。

CLIでも `npm run qa -- recover --config <site.json> --run <実行ディレクトリ>` を利用できる。実行時と同じREST認証を用意する。browser-flowや外部運用処理のデータは、このWordPress投稿回収の対象ではなく案件の後始末手順で扱う。

## 投稿・権限・キャッシュの対象を広げる

`postType`にはRESTのコレクション名（例: `posts` / `pages`）を指定する。`wp-authz`の`ownership`は`own` / `other`、`expectations.read`と`expectations.update`は`{status,code?}`。所有者別・ロール別に検査を複製し、個別の期待値を定義する。標準の購読者一件だけで全ロールを保証しない。

`wp-cache`は`listingURLs`と`searchURLs`へ一覧・検索URLを追加し、公開、更新、非公開化の反映を確認する。`cacheRoles:[{role,storageStateEnv,canReadPrivate}]`でロール別の非公開閲覧可否も照合する。指定したURLとロールが検査範囲であり、CDNの全拠点・全TTLの保証ではない。

予約投稿は予約更新直後の早期publishを不合格にし、予定時刻に達するまで匿名側に公開されないことも繰り返し確認する。公開後の照合と後始末も実施する。

## 外部CDN・テスト決済

browser-flowには`allowedResourceOrigins`、`allowedNavigationOrigins`、`allowedInteractionOrigins`を別々に登録する。完全なorigin（例: `https://sandbox.example.com`）で指定し、ワイルドカードは受け付けない。外部遷移・操作には検証環境・変更許可・`sandbox:true`が必要。リソース許可はGET/HEADだけで、サイトの認証情報は転送しない。

外部操作のCookieはoriginごとに分離し、外部のHTTPセッションだけを継続する。外部画面の`document.cookie`依存動作は対応範囲外。実際の決済テストモード、注文取消しや返金などの後始末、メールの宛先制限は案件側で設定・検証する。
