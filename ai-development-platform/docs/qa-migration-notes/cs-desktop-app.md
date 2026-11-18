# Allcampus の CS アプリ（WinForms と WebView2）の移行メモ

旧 Skill の cs-webview-regression-test（`references/allcampus-webview2.md` を含む）、cs-native-regression-test、automating-wpf-with-flaui から、この案件に固有の記述を抜き出したものです。担当者は、次の順に写します。

1. 「front matter の案」を `knowledge/<product>/profile.md` の先頭に貼り、`product` と環境変数の名前を実際の運用に合わせる。
2. 「観点」「落とし穴」「テストデータ」「到達手順」を中心に、残りの節も profile.md の本文か `knowledge/<product>/` の別ファイルに貼る。
3. `aidev qa profile check knowledge/<product>/profile.md` を流す。

構成の記述は、2026-10-08 に確認した内容に、2026-10-23 から 26 の実行（履修題目登録、PT）で確かめた内容を足したものです。実行のときは現物で確かめ直してください。リポジトリのルートは利用者の環境から見つけ、固定のユーザーパスを前提にしません。

## 案件の前提

Allcampus の CS アプリは、WinForms のアプリの中に WebView2 を持ち、`frontend/gakumu` の画面を表示します。WPF のアプリではありません。PT と ST の2つの環境で同じケースを流して比べるほか、同じ環境（社内 PT）で、セキュリティの強化のような設定の段階を入れる前（ベースライン）と後を比べる使い方もあります。

PT を常に新版、ST を常に旧版と決めつけません。比較元と比較先は、今回のビルドとデプロイの状態で決め、exe、プラグインの DLL、Web 版の識別情報を記録します。

テストは2つの区分に分け、同じ spec に混ぜません。

- WebView2 の中の操作と記録は、Playwright の CDP 接続で行います（aidev-qa-characterization の `references/webview2.md`）。
- WebView2 の外（保存、フォルダ選択、印刷のダイアログ、帳票のビューア、外部アプリ、IME、ネイティブのログイン）は、FlaUI で、PC を占有する別の実行にします（aidev-qa-desktop-gui）。

## front matter の案

```yaml
---
product: allcampus-cs
# ドメインは旧 Skill に省略形でしか書かれていないものがある。app.PT.config、app.ST.config の DefaultUrl で確かめる
environments:
  - {name: PT, url: https://allcweb1.local.ailesys.co.jp/CS/, purpose: 社内の検証環境。CS アプリの PT 構成の接続先}
  - {name: ST, url: https://allcweb3.local.ailesys.co.jp/CS/, purpose: ステージング。CS アプリの ST 構成の接続先}
# ログインのアカウントの区分と環境変数の名前は、旧 Skill に書かれていない。担当者が運用に合わせて決める
# roles:
#   - {name: <アカウントの区分>, user_env: <ID の環境変数>, password_env: <パスワードの環境変数>}
login:
  method: certificate
  # 旧 Skill に拇印は書かれていない。使う場合は certificate_thumbprint（40桁の16進数）を担当者が確認して書く
stack: [winforms, webview2, vue, graphql]
test_commands:
  - {name: cs-webview, run: bash frontend/gakumu/e2e-cs/run-cs.sh <launch-json> <specの相対パス>}
evidence: {method: external, retention: 90d}
---
```

書き写すときの注意は次のとおりです。

- `login.method` は証明書方式のネイティブのログイン画面（LoginView、mTLS）に合わせて `certificate` にしています。ただし、このアプリは OS の証明書ストアを使わず、証明書の選択ダイアログも出しません。ログインは、ログイン ID とパスワードを LoginView に入力する形です。設計書 5.9 は証明書方式のとき、証明書ストアの証明書を拇印で指定するとしていますが、このアプリには当てはまらない可能性があります。方式の選び方は担当者が確かめてください。
- `certificate` を選ぶと、aidev-qa-login-session と aidev-qa-desktop-gui は、証明書ストアにある拇印指定の証明書を必要とします。desktop-gui は最初に、その拇印の証明書が存在して有効かを確かめ、証明書の選択ダイアログが出ることを前提にします。このアプリは LoginView に ID とパスワードを入力する運用で、選択ダイアログも出ないため、存在しない証明書を新しい Skill が要求して止まるおそれがあります。実際の運用が ID とパスワードの入力なら、ログインの手順は本文の「ログイン」の節を正とし、profile の方式は担当者が選んでください（例：`none` にして、手順を本文に書く）。
- ホストの記述が旧 Skill で揃っていません。`app.PT.config` の `DefaultUrl` が PT は allcweb1、ST は allcweb3 の `/CS/` です。PT の Web 版の campus（`allcweb2`）とは別のホストです。
- `test_commands` の `run-cs.sh` は、旧 Skill の標準ハーネス（`frontend/gakumu/e2e-cs/`）のものです。新しい QA リポジトリで作り直す場合は、実際のコマンドに書き換えてください。
- `evidence` の方式は案です。個人情報が映る画面を扱うので、`lfs` は避けています。

## 環境の入手と版

- PT と ST の CS アプリは ClickOnce で配布され、`%LOCALAPPDATA%\Apps\2.0\…` に入ります。PT は `Desktop.exe`、ST は `DesktopST.exe` で、別のアプリです。同じフォルダの `*.config` の `DefaultUrl` で PT と ST を見分け、`Desktop(ST).dll` の ProductVersion（`1.0.0+<commit>` の形）で版を記録します。
- 配布元は `ClickOnceProfilePT.pubxml` と `ClickOnceProfileST.pubxml` に書かれています。PT は allcweb1、ST は allcweb3 の `install/` です。
- 証明書方式（`ClientCertMode=true`）では `--address` が無視されます（`MainForm` が `!clientCertMode` のときだけ上書き）。PT の exe で ST に接続することはできません。ST を対象にするには ST の配布物が要ります。
- ST の配布物が古い（証明書方式に未対応の版など）ときは、利用者にスタートメニューの「All-Campus(ST)」を一度起動してもらい、ClickOnce で更新します。配布物のダウンロードはエージェントがしません。
- Web 版は、画面の右下の表示（例：`fc93f20987 2026/10/26 08:33`）で記録します。同じ日でも再デプロイで変わるので、実行のたびに画面から読みます。
- csproj の構成は PT、ST、Staging、Production、CP で、AssemblyName は ST、Staging、CP が `DesktopST` です。TargetFramework は net8.0-windows です。

## 調査する箇所（リポジトリ内）

| ファイル | 確認する内容 |
|---|---|
| `desktop/Desktop/Desktop.csproj` | 構成と AssemblyName、WebView2 と runtime |
| `desktop/Desktop/MainForm.cs` | 接続先の選択、一時プロファイル、起動時の `ClearBrowsingDataAsync`、host object、UserAgent、`PRODUCTION` と `STAGING` で `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` を消す処理、`ClientCertMode` |
| `desktop/Desktop/LoginView.cs`、`CsAuthClient.cs` | 証明書方式のネイティブのログイン画面 |
| `desktop/Desktop/CommandLineOptions.cs` | `--address`（`-a`）、`--token`（`-t`） |
| `desktop/Desktop/app.PT.config`、`app.ST.config` | `DefaultUrl`、`ClientCertMode` |
| `frontend/gakumu/src/plugin/index.ts` | CS アプリの判定（`window.chrome.webview.hostObjects`） |
| `frontend/gakumu/src/router/routes.ts`、`src/Menu/` | 画面のルート、メニューの階層（4種類のメニューモード） |
| `frontend/share/src/services/index.ts` | API のクライアント（graphql-request が `POST /api` に `operationName` を付けて送る） |
| `frontend/share/src/services/LoggingService.ts` | クライアントログ（`POST /api/v1/client/logs`）。画面の操作のたびに送られるので、API の母数に入れる |

## 起動と CDP

- PT と ST の構成は PRODUCTION でも STAGING でもないので、`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<ポート>` が効きます。Production と Staging のビルドでは `MainForm` が消すので効きません。
- アプリは WebView2 のプロファイルを `TEMP\DesktopSU\EBWebView` の固定の場所に作り、起動時に閲覧データを消します。起動する子プロセスにだけ専用の `TMP` と `TEMP` を渡すと、利用者の作業用のインスタンスと分けられます。起動時に配布フォルダ内のファイルを変更する処理があれば、テスト用のコピーや変更の範囲を確かめてから起動します。
- 起動は `frontend/gakumu/e2e-cs/launch-cs.ps1 -Env PT -RunDir <evidence/run-id>` です。最新の配布物を選び、空きポートと専用の TEMP で起動して、`launch-PT.json`（PID、ポート、exe、版、時刻、ログインの方法）を書きます。Windows PowerShell 5.1 は BOM のない UTF-8 を SJIS と読むので、この `.ps1` は BOM 付きで保存します。
- 起動の直後のページは `about:blank`（LoginView を表示中）です。ログイン後に `https://<host>/CS/portal` へ遷移し、URL にトークンが付きます。記録では伏せ字にします。
- ログインの完了は、CDP の `/json/list` に `/<host>/CS/` が出ることで待ちます。PID の生存も一緒に見ます。
- screenshot は CDP の接続で取れます。trace、video、download は、この画面に帳票がなく、使っていません（確かめていない）。
- テスト用のインスタンスの終了は、今回起動した PID に `CloseMainWindow()` で行います。強制終了はしません（閉じるときに閲覧データの消去が走る）。

## ログイン

CS アプリは、起動時に WebView2 の外のネイティブのログイン画面（WinForms の LoginView、証明書方式）を出します。ログインは、WebView2 の回帰とは別の認証の準備として行います。

1. 実行の前に、占有する時間の目安、起動するアプリ、入力するアカウントの区分を利用者に示します。
2. 専用の TEMP、CDP のポートを子プロセスにだけ渡して起動し、PID を記録します。
3. LoginView を AutomationId と ControlType で特定し、ログイン ID とパスワードを ValuePattern で入力し、ログインのボタンを InvokePattern で押します。資格情報は環境変数から受け取り、ログ、証跡、スクリーンショットに残しません。パスワード欄が写る撮影もしません。
4. 完了を期限付きで待ちます（LoginView が閉じる、CDP に `/CS/` のページが出る）。失敗のメッセージ（失敗、ロック、時刻のずれ、証明書の不具合）が出たら文言を記録して止め、同じアカウントで続けて再試行しません（ロックを招く）。
5. PID、CDP のポート、アカウントの区分、完了時刻を `evidence/<run-id>/login-handoff.json` に書き、FlaUI のプロセスを終えます。CS アプリのプロセスは終了しません。
6. 前処理が失敗したか、接続した先がログイン画面のままなら、その実行の全ケースを「未実施（認証準備失敗）」にします。

パスワードの自動入力が許されないホストでは、手動ログインに切り替えます。`allcweb1.local…` のように、名前で試験環境と分からないホストがこれに当たります。専用の TEMP と CDP のポートでテスト用のインスタンスを起動し、どのウィンドウ（PID）にどのアカウント区分でログインするかを利用者に示して、ログインしてもらいます。資格情報の値を会話に出させません。CDP に `/CS/` のページが出るまで期限付きで待ち（PID の生存も見る）、`login-handoff.json` に `login: manual`、アカウント区分、時刻を残します。利用者が作業用のインスタンスの方にログインしてしまうことがあります。どちらもウィンドウのタイトルが同じなので、PID で示し、ログイン後に CDP で確かめます。

証明書の選択やパスワードのダイアログが前処理の途中で出たら、選ばずに止め、ダイアログの種類と所有プロセスを記録して報告します（アプリの不具合の候補）。

## 標準のハーネス（`frontend/gakumu/e2e-cs/`）

| ファイル | 役割 |
|---|---|
| `playwright.cs.config.ts` | `*.cs.spec.ts`、workers 1、retries 0、`actionTimeout` 60 秒、結果を `CS_EVIDENCE_DIR` へ |
| `csFixture.ts` | CDP 接続の `page`、操作ヘルパー `act`（click、dblclick、fill、check。操作後に `CS_ACTION_WAIT_MS` の 500 ms 待つ）、`Recorder`（checkpoint の撮影、値、時刻。`CS_RECORD_API=1` で API を記録） |
| `run-cs.sh` | `run-cs.sh <launch-json> <specの相対パス> [grep]`。launch の JSON から接続先を決め、API の記録を既定で有効にし、`--list` で対象を出してから実行する。spec はファイル名まで指定する（部分一致で別の spec が走るのを防ぐ） |
| `apiInventory.cjs` | 画面の `.vue` から import を再帰的にたどり、API の呼び出し箇所をファイルと行で一覧にする |
| `makeReport.cjs` | `cases.json`、各 `result.json`、`judgements.json`、`manifest.json`、画面マニフェストの `apis` から `comparison.json` と `report.html` を作る |
| `<Screen>/screen.ts`、`*.cs.spec.ts` | 画面ごとの操作と spec（参照系と更新系を別のファイルにする） |

Playwright の本体は `frontend/node_modules` にあります。実行は Volta の `node.exe` で `@playwright/test/cli.js` を直接呼びます（`run-cs.sh` が行う）。`node -e` の出力は Bash のツール経由で消えることがあるので、集計はスクリプトのファイルにします。画面マニフェストの置き場所の `coverage/` は、Allcampus のリポジトリで `.gitignore` の対象です。コミットできないので、置き場所を利用者に確かめます（強制的に追加したり、ignore を変えたりしません）。

## gakumu の UI 部品の扱い

| 部品、状況 | 起きること | 扱い |
|---|---|---|
| `el-checkbox` | 本物の `input[type=checkbox]` が隠れていて、`setChecked` が actionable を待ち続ける | `.el-checkbox` の要素をクリックし、input の `isChecked()` で状態を確かめる |
| `el-select`（AlComboBox、部局選択など） | 選択値が `innerText` に出ず、内側の `input` の value にある。未選択の表示はプレースホルダ | `locator('input').inputValue()` で読む。未選択は空文字 |
| `el-pagination` | 現在のページでない「1」の文字が、前後に空白の付いた形になる | `li[aria-label="page N"]` で選ぶ |
| 左のスライドメニュー | 閉じても opacity 0、幅 0 で残り、Playwright では visible のまま | 親の `.slideMenu-list` の opacity で判定する。画面を開いた後は「教務」などをもう一度押して閉じる |
| ポータルの表示の直後 | `el-loading-mask` がメニューを覆い、クリックが通らない | 読み込み表示が消えるのを待ってから操作する |
| 画面の開き直し | 同じルートへの遷移では作り直されない | ロゴ（`.menu-sysyemtitle a`、`/CS/`）でポータルに戻り、メニューから開く |
| `AlConfirmDialog` | 確認、警告、エラーが同じダイアログ。確認で「はい」を押すと、閉じずにエラーに切り替わることがある。警告とエラーはボタンが「はい」1つ | 「はい」の後は閉じるのを待たず、次の文言を待つ |
| `el-notification` | 約 4.5 秒で消える | 出た直後に読む、撮る |
| 範囲指定（AlLectureCodeRangeSearch、AlTeacherCodeRangeSearch） | 終了側にフォーカスするまで、開始側の値が終了側に写る | 終了側の入力の動作を見るときは、一度消してから入力する |
| 検索条件 | 中止やダイアログを閉じても条件が戻らない | 手順ごとに条件を明示的に設定する |
| 部局の選択肢（AlBukyoku1Search） | ログインしたユーザーの権限の部局だけが出る（`session.activeShozoku1`）。部局を指定しない検索も、権限の部局で絞られる | 担当範囲のケースは「全行の部局が選択肢に含まれる」で確かめる |
| サブダイアログの一覧の列 | 同じ部局でも、画面によって正式名と略称（`ryakusyou`）が違う | 期待値は列の `prop` を読んで決める |

## API の記録

- CDP 接続の `page.on('request'/'response')` で、証明書方式の中継（WebResourceForwarder）を通る要求も見えます。
- GraphQL は `POST /api` で、本文の `operationName` が SDK の関数名と同じです（例：`getFilteredWrsRisyuudaimokuExtend`）。一覧の取得は、ページごとに同じ操作名を複数回送ります（100 件ごと）。
- エラーは HTTP 200 で、本文の `errors` に入ります。画面はそれを表示せず「データは有りません。」になることがあります。件数だけを記録して、判定に使います。
- ログイン直後のポータルは、`getInformationFromUniversityWithReadded`、`getFilteredDDocumentsBodies`、`getFilteredMstEnvironment`、`getUnconfirmedSyogakukinIdou`、`kigyouCodeMissingNotification` を呼びます。画面の母数ではないので「画面外」に分けます。
- コンポーネントも母数にする依頼では、`frontend/gakumu/src/components` の `.vue` から母数を作ります。呼び出しは `services.api.X`、`services.batch`、`pagingRequestIterator`、`pollableRequestIterator`、`SkdWithBearer`、`GraphQLClient`、store や composable の経由で数えます。`useApiService` の import や client の生成だけでは数えません。一覧画面（コンポーネントを並べた検証用の画面、例：`ComponentCatalog2`）が、そのビルドにない環境では「未実施（一覧画面なし）」にし、一覧画面を作らず、実施する手段を添えます。

## PC の占有、ネイティブの操作

- `native-required` になる例は、Windows の「ファイルを開く」、保存、フォルダの選択、印刷のダイアログ、外部の Excel や PDF のアプリ、IME の操作です。WebView2 回帰からは「未実施」として、`native-handoff.md` に書いて aidev-qa-desktop-gui へ引き継ぎます。引継ぎ先は自動では実行しません。
- 事前に設定した専用フォルダへ、無人で出力できる帳票は、条件を確かめられたときだけ WebView2 の側で実行して比べます。
- 起動と停止の対象の PID、開始時刻、exe のパスを記録します。既存の作業用の CS アプリや Excel には接続しません。利用者のプロセスを勝手に終了しません。
- 更新や帳票の処理が進行中、未保存の変更がある、処理の状態が不明なときは強制終了しません。ケースを保留し、利用者に状態と必要な対応を伝えます。
- 出力処理（帳票や CSV のファイル出力）の保存先は `\\nas01\Public\GAKUMU-NAS\学務共有テスト\学務部\t\` としていました。NAS に届かないときは、代わりの場所に切り替えず、利用者に報告します。この保存先はプロファイルの `evidence` の保存方式に合わせて、担当者が見直してください。
- FlaUI のテストは、対話セッションの中で `workers: 1` 相当の逐次実行にします。CS アプリ、WebView2、ハーネスの権限レベルを揃え、権限の拒否をアプリの不具合と取り違えません。勝手に管理者権限で動かしません。
- 実プリンタへの印刷や外部への送信は、一般的な回帰の依頼に含めません。印刷は承認済みの仮想プリンタか出力先を使います。
- 保存の操作のケースの例は、実アプリから帳票を出力し、Windows の保存ダイアログを確かめ、専用の空フォルダへ保存し、ダイアログの閉鎖と新しいファイルの書き込みの完了を確かめ、原本と内容を比べる流れです。保存ボタンを押しただけ、ファイルが存在するだけでは成功にしません。

## 同じ環境の段階比較

同じ環境（社内 PT）で、設定や機能の段階を入れる前後を比べるときの決まりです。

- ST と PT、両環境の記述は、ベースライン（例：`R-0`）と比較先の段階（例：`R-2`）に読み替えます。ラベルは依頼の段階名をそのまま使います。段階の例は、許可リストを enforce にした後です。
- 証跡は `<段階ラベル>/` に置きます（`ST/`、`PT/` の代わり）。1つの `evidence/<run-id>/` に1つの段階を入れ、ベースラインの run-id を manifest の `baselineRunId` に書きます。
- 段階の切り替え（サーバーの設定の変更と戻し）はテストの側で行いません。依頼側の担当者が行い、その設定を受け取ります。manifest に、段階ごとのサーバー側の設定と切り替えた日時を記録します。設定を確かめられない段階は比べません。
- 段階の切り替えはサーバーの設定なので、ケースごとに両方を交互に流すことはできません。ベースラインを全件取ってから切り替えます。更新系のケースで作ったデータを残さないよう、後始末を確かめます。
- ベースラインは、比較先と同じテストコード、同じ母数（マニフェスト）で取ります。画面やコンポーネントを母数に足したら、比較の前にベースラインを取り直します。
- 実行の前のデータの状態が、ベースラインと比較先で同じであることを、代表のキーと件数で画面から確かめます。ずれていれば「比較不能（データ変化）」です。
- 「意図した差分」は、その段階の設計で決まっている変化（例：エラー文言の固定化）だけにします。根拠の文書と該当箇所を記録します。
- サーバーの監査ログに拒否やエラーがないことが合格の条件に入る依頼では、ログは読みません。ケースごとの開始と終了の時刻（Asia/Tokyo、ミリ秒）、チェックポイント名、段階ラベル、アカウント区分を `cases.json` に記録し、PC とサーバーの時刻の差（応答の `Date` ヘッダーと PC の時刻）を manifest に書きます。集計は依頼側の担当者が行い、集計がないケースは「一致」にせず「未実施（ログ集計待ち）」にします。
- `ST/` と `PT/` のラベルと、比較元と比較先の対応は manifest に記録します。URL に付くトークンは伏せ字にします。

## 観点

- 画面の表示、操作の結果、占有なしで取れる出力ファイルを、両環境で比べます。ブラウザだけで動かした結果を、CS アプリの E2E の成功として扱いません。
- 人が実機の CS アプリで画面を確かめる作業の代替（スモークテスト）が目的です。境界値や全分岐のテストは目的にしません。必須入力のあるフォームだけ、必須あり（成功）と必須なし（バリデーションエラー）の2つを足します。
- 画面マニフェストの全項目が「実行済み」か「理由付きで除外」に決まっている状態を、網羅とします。母数は `frontend/gakumu/src/router/index.ts` などから、CS アプリで届く画面を機械的に出します。`desktopOnly` で誘導される画面も含めます。
- 画面が呼ぶ API の網羅も、成果物に含めます。画面から届く API の呼び出し箇所を一覧にし、呼び出し箇所を、それを呼ぶ操作のケースに対応づけ、実行中に送られた操作名、状態コード、GraphQL のエラーの件数を記録します。報告書に「API の一覧」と「テストと API の対応表」を載せます。利用者の関心は、画面内の API がすべて適切に呼ばれることにあることが多く、ケースの網羅だけでは答えにならないためです。
- 記録の深さは、ロール制御のみ、本人限定、全件参照の操作は軽く、個人情報、担当範囲による行レベルの制御、帳票、更新を伴う操作はフルです。迷うときはフルにします。
- 担当範囲のケースでは、部局の選択肢に、全行の部局が含まれることを確かめます（上の `AlBukyoku1Search` の挙動）。
- 一覧は、人が選んだ列だけでなく全列を検査します。詳細画面の一致は、一覧の一致を保証しません。
- 検索、一覧、帳票のケースで、0件の状態をそのまま証跡にしません。
- 更新の操作（登録、修正、削除）では、成功のメッセージだけで保存の成功としません。接頭辞で識別できない既存のデータを、修正や削除の対象にしません。更新のテストが失敗しても後始末をします。結果が不明のまま再実行して二重に登録しません。両環境のデータが同じことを確かめてから実行します。
- テストデータの候補を、区分名などの思い込みで決めません（その年度に前期の登録がある、など）。実行のときに画面から選びます。

## 落とし穴

- 利用者の作業用の CS アプリのインスタンスと、テスト用のインスタンスを混ぜません。ウィンドウのタイトルは同じなので、PID で区別します。
- 帳票は、通常の画面操作から、ネイティブの UI と外部のアプリなしで専用フォルダへ出力できる場合だけ、WebView2 の側で扱います。ダウンロードのイベントは操作の前に登録し、前回のファイルを今回の成果物と取り違えません。出力のボタンを押した時点で成功とせず、ファイルの完成と内容まで確かめます。ダウンロードの API を直接叩いて代替しません。
- CSV は列、値、件数（順序が仕様なら順序も）を、PDF は文字の内容と必要なレイアウトを比べます。生成日時のような既知の揺らぎだけを、規則を明示して正規化し、原本を残します。
- 実行中にネイティブのログイン画面へ戻された（セッション切れ、証明書のエラー）ら、そのケースを止め、前処理からやり直します。戻されたこと自体を、そのケースの結果にします。
- 外部のビューアは、対象のファイルを開いていることを、タイトル、対象の文書、表示の内容で確かめます。前回の文書や既存の Excel のブックを検証しません。
- Windows の UI の証跡は、対象のウィンドウを中心に撮り、画面全体のキャプチャが要るときも、対象のモニターや領域を限ります。他の作業ウィンドウの個人情報を混ぜません。
- 証跡、認証のファイル、生成した帳票は git の管理の対象外にします。個人情報やトークンを含む画像、trace、HTML を、確認なしに公開しません。
- 画面が正常に見えるからと「一致」にして、API の GraphQL エラー（HTTP 200）を見落とさないようにします。ボタン1つ奥の API（サブダイアログ、コード入力時の照会、選択肢の読み込み）にも、ケースを対応づけます。
- 実データやアカウントがそろわないことを理由に、ケースを保留のまま残しません。未実施や比較不能の理由だけを書かず、実施する手段の提案を添えます。
- CDP や download、trace の可否を確かめる前に、全画面のテストを書き始めません。小さな代表のケースで、フォーカス、ネイティブのダイアログ、外部の起動の有無を最初に確かめます。
- 操作後の 0.5 秒の固定待機は、遷移の途中のダイアログを撮らないために入れます。ただし、固定待機だけで完了とみなさず、DOM の条件の検査も入れます。
- 旧 Skill が、campus の Web 版のテスト（campus-playwright など）の API 比較、認証の経路、強制的な CSS の変更、ヘッダーの非表示、固定待機を、そのまま取り込まない方針としていた点にも注意してください。CS アプリの記録では、これらを持ち込みません。

## WPF の旧 Skill（automating-wpf-with-flaui）の例の扱い

この Skill には、別の WPF アプリの例が書かれています。新しい aidev-qa-desktop-gui では案件に依存しない形にし、名前を落としました。Allcampus の CS アプリは WPF ではないので、次は参考です。

- 設定ファイル（例：`%APPDATA%\<アプリ名>\settings.json`）を一時退避し、隔離したデータフォルダを指す設定に差し替えてから起動する例がありました。`DataRoot` を書き換えます。実行の前に、対象のアプリの既存のプロセスが動いていないか確認し、動いていれば起動を断ります。Allcampus では、固定の `settings.json` があると決めつけないでください。
- ダイアログの名前（`RenameScenarioWindow` など）と、「未保存の変更」の3択の確認ダイアログの例がありました。行を選ぶと、イベントのハンドラの中で同期的にネイティブの `MessageBox.Show` が開く画面は、素朴に `Select()` から `WaitForNewWindow` へ書くと、UIA 全体が止まります。Win32 の API で、最前面のウィンドウを待つ手順が `references/dialogs.md` に入っています。
- スクリーンショットは案件の証跡用のフォルダ（例：`QA\エビデンス\<機能ID>\`）に置いていました。QA リポジトリでは `runs/<YYYYMMDD>-<run-id>/evidence/<TC-ID>/` です。

## 到達手順

1. リポジトリ（`desktop/` と `frontend/gakumu/`）を取得し、`frontend/gakumu/e2e-cs/` のハーネスがあることを確かめます。
2. 対象の環境（PT か ST）の CS アプリを、ClickOnce の配布物から選びます。版と Web 版の識別情報を記録します。
3. WebView2 回帰の前に、ログインの前処理（または手動ログイン）を行い、`login-handoff.json` を作ります。占有の時間は、実行の前に利用者へ示します。
4. `launch-cs.ps1` で起動し、`run-cs.sh <launch-json> <spec>` で WebView2 の側のケースを流します。
5. `native-required` のケースは、別の枠（PC の占有）で aidev-qa-desktop-gui を使って流します。
6. 終わったら、今回起動した PID だけを `CloseMainWindow()` で終了し、更新系のデータの後始末の結果（`update-state.json`）を確かめます。

証跡の置き方（旧版）は次のとおりでした。新しい QA リポジトリでは `runs/<YYYYMMDD>-<run-id>/` の形に合わせます。

```text
evidence/<run-id>/
  manifest.json
  cases.json
  launch-<ENV>.json
  ST/<screen>/<TC-ID>/<checkpoint>.png
  PT/<screen>/<TC-ID>/<checkpoint>.png
  PT/<screen>/<TC-ID>/result.json
  PT/update-state.json
  judgements.json
  comparison.json
  native-handoff.md
  report.html
```

## 値が書かれていた箇所（担当者が確認すること）

旧 Skill に、パスワードやトークンの値は見つかりませんでした。アカウントの ID らしい文字列もありません。資格情報は、旧 Skill の運用では環境変数から受け取る決まりで、変数の名前も書かれていませんでした。担当者が、使うアカウントの区分と環境変数の名前を決めて、profile.md の `roles` に書いてください。
