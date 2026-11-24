# Allcampusの調査箇所と接続

2026-10-08 に確認した構成に、2026-10-23〜26 の実行（履修題目登録・PT）で実証した内容を足したもの。実行時は現物を再確認する。リポジトリルートは利用者の環境から解決し、固定のユーザーパスを前提にしない。

## 調査箇所

| ファイル | 確認する内容 |
|---|---|
| desktop/Desktop/Desktop.csproj | net8.0-windows、WebView2/runtime、構成（PT・ST・Staging・Production・CP）と AssemblyName（ST・Staging・CP は `DesktopST`） |
| desktop/Desktop/MainForm.cs | 接続先の選択、一時プロファイル（`Path.GetTempPath()` 配下の固定フォルダ）、起動時 ClearBrowsingDataAsync、host object、UserAgent、`#if (PRODUCTION \|\| STAGING)` で `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` を消す処理、ClientCertMode |
| desktop/Desktop/LoginView.cs・CsAuthClient.cs | 証明書方式（mTLS）のネイティブのログイン画面 |
| desktop/Desktop/CommandLineOptions.cs | `--address` / `-a`、`--token` / `-t` |
| desktop/Desktop/app.PT.config・app.ST.config | `DefaultUrl`（PT＝allcweb1、ST＝allcweb3 の `/CS/`）、`ClientCertMode` |
| desktop/Desktop/Properties/PublishProfiles/ClickOnceProfile{PT,ST}.pubxml | 配布元（`http://allcweb1…/install/`・`http://allcweb3…/install/`） |
| frontend/gakumu/src/plugin/index.ts | CSアプリ判定（`window.chrome.webview.hostObjects`） |
| frontend/gakumu/src/router/routes.ts | 画面のルート |
| frontend/gakumu/src/Menu/ | メニューの階層（4種類のメニューモード） |
| frontend/share/src/services/index.ts | API クライアント（graphql-request が `POST /api` に `operationName` 付きで送る） |
| frontend/share/src/services/LoggingService.ts | クライアントログ `POST /api/v1/client/logs`（画面操作のたびに送られる。API母数に入れる） |

## CSアプリの入手と版

- PT・ST の CSアプリは ClickOnce で配布され、`%LOCALAPPDATA%\Apps\2.0\…` に入る。PT は `Desktop.exe`、ST は `DesktopST.exe`（別アプリ）。同じフォルダの `*.config` の `DefaultUrl` で PT/ST を見分け、`Desktop(ST).dll` の ProductVersion（`1.0.0+<commit>`）で版を記録する。
- **証明書方式（ClientCertMode=true）では `--address` は無視される**（MainForm が `!clientCertMode` のときだけ上書き）。PT の exe で ST に接続することはできない。ST を対象にするには ST の配布物が要る。
- ST の配布物が古い（証明書方式に未対応の版など）ときは、利用者にスタートメニューの「All-Campus(ST)」を一度起動して ClickOnce で更新してもらう（配布物のダウンロードをエージェントがしない）。
- Web版は画面右下の表示（例 `fc93f20987 2026/10/26 08:33`）で記録する。同じ日でも再デプロイで変わる。
- **どのリポジトリのコードか**：`ailesys-dev/allcampus-feat` は開発用のリポジトリ（開発用ブランチ → allcampus-feat/main → 自動PRで allcampus/main）で、サーバーの環境ではない。ST の配布物が allcampus-feat/main から作られることがある（2026-11-19 実測：DesktopST 1.0.0.326 ＝ `966a4ae`＝allcampus-feat の PR #49 のマージコミットで、allcampus/main には無い）。版の所属は `e2e-cs/identify-build.cjs` で確かめる（`build-<ENV>.json` に CSアプリ・Web版それぞれのコミットと、それを main に含むリポジトリを書く）。
- **配布物が古いかの確かめ方**：配布元の `.application`（PT＝`http://allcweb1.local.ailesys.co.jp/install/Desktop.application`、ST＝`http://allcweb3.local.ailesys.co.jp/install/DesktopST.application`）の `assemblyIdentity` の `version` と、インストール済みの `%LOCALAPPDATA%\Apps\2.0\…\manifests\` の同じ版の manifest があるかを比べる（`.application` は読むだけ。保存・実行しない）。`.application` の `dependentAssembly` の `size` は、インストールされた `.manifest` のサイズと一致するので、どのフォルダが何番の版かの対応付けに使える。

## テスト環境としての扱い（依頼者の確認）

- 社内PT（allcweb1）・社内ST（allcweb3）は、2026-11-20 に依頼者から「テスト環境のため、必要であれば既存データは消してしまって構わない」と確認を得ている。SKILL.md の「既存データの扱い」を適用してよい（変更・削除した既存データは記録する）。本番・顧客環境には適用しない。
- 依頼の画面一覧にあった「共通教育授業科目登録」（カリキュラム登録）は、存在しない画面と依頼者が確認した（2026-11-20）。母数に入れない。

## 起動と CDP（実証済み）

- PT/ST 構成は PRODUCTION/STAGING ではないので、`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<ポート>` が効く（Production・Staging のビルドでは MainForm が消すので効かない）。
- userDataFolder は `TEMP\DesktopSU\EBWebView` 固定。子プロセスにだけ専用の `TMP`/`TEMP` を渡すと、利用者の作業用インスタンスと分けられる。
- 起動は `frontend/gakumu/e2e-cs/launch-cs.ps1 -Env PT -RunDir <evidence/run-id>`。最新の配布物を選び、空きポート・専用TEMPで起動して `launch-PT.json`（PID・ポート・exe・版・時刻・ログイン方法）を書く。Windows PowerShell 5.1 は BOM なしの UTF-8 を SJIS と読むので、.ps1 は BOM 付きで保存する。
- 起動直後のページは `about:blank`（LoginView 表示中）。ログイン後に `https://<host>/CS/portal?token=…` へ遷移する。URL にトークンが付くので、記録では伏せ字にする。
- ログインの完了は `/json/list` に `/<host>/CS/` が出ることで待つ。PID の生存も一緒に見る。
- screenshot は CDP 接続で取れる。trace・video・download は未実証（この画面には帳票が無く、使っていない）。

## 標準ハーネス（frontend/gakumu/e2e-cs/）

| ファイル | 役割 |
|---|---|
| playwright.cs.config.ts | `*.cs.spec.ts`、workers 1、retries 0、`actionTimeout` 60秒、結果を `CS_EVIDENCE_DIR` へ |
| csFixture.ts | CDP 接続の `page`（既存 context から対象ホストの `/CS/` を選び、host object を確認）、操作ヘルパー `act`（click・dblclick・fill・check。操作後に `CS_ACTION_WAIT_MS`＝500ms）、`Recorder`（checkpoint の撮影・値・時刻、`CS_RECORD_API=1` で API 記録） |
| run-cs.sh | `run-cs.sh <launch-json> <spec の相対パス> [grep]`。launch の JSON から接続先を決め、API 記録を既定で有効にし、`--list` で対象を出してから実行する。spec はファイル名まで指定する（部分一致で別の spec が走るのを防ぐ） |
| apiInventory.cjs | `node apiInventory.cjs <画面.vue> <出力json>`。import を再帰的にたどり、API の呼び出し箇所をファイル・行で一覧にする |
| makeReport.cjs | `CS_SCREEN_MANIFEST=<coverage/cs-screens/X.json> node makeReport.cjs <run-dir> <Screen> PT ST`。cases.json・各 result.json・judgements.json・manifest.json と画面マニフェストの `apis` から comparison.json と report.html（画像は run からの相対参照、API一覧、テスト×API対応表）を作る |
| launch-cs.ps1・wait-cs.ps1 | 起動（空きポート・専用TEMP・`launch-<ENV>.json`）と、ログイン完了待ち（`/json/list` に `/CS/`、PID の生存も見る。`login-handoff-<ENV>.json` を書く） |
| identify-build.cjs | `node identify-build.cjs <launch-ENV.json>`。CSアプリ（DLL の製品バージョン）と Web版（画面右下）のコミットが、allcampus・allcampus-feat のどちらの main に含まれるかを `gh api` の compare で判定し、`build-<ENV>.json` を書く（読み取りだけ。Web版はログイン後でないと読めない） |
| （スキル側）scripts/verify-report.cjs | `node verify-report.cjs <まとめ.html> [<不具合報告書.html>]`。全タブの切り替え・画像（遅延読み込みを eager にして decode）・コンソールのエラー・画面内リンク・390px のはみ出し・ダーク表示・不具合報告書の画像とリンク先を確かめる。2026-11-24 にカリキュラム登録（15タブ・714枚）で問題なし、壊した写しで検出することを確認済み |
| （スキル側）scripts/make-tabbed-report.cjs | ハーネスではなくスキルに置く。全 run の report.html を、まとめタブ付きのタブ切り替えの1つのHTMLにまとめる（SKILL.md「報告書は、全画面をタブでまとめた1つのHTMLにする」）。2026-11-20 のカリキュラム登録（13 run・画像560枚）で、全タブの画像・アンカー・スマホ幅・ダーク表示を確認済み |
| <Screen>/screen.ts・*.cs.spec.ts | 画面ごとの操作と spec（参照系と更新系を別ファイルにする） |

Playwright 本体は `frontend/node_modules`。実行は Volta の `node.exe` で `@playwright/test/cli.js` を直接呼ぶ（run-cs.sh が行う）。`node -e` の出力は Bash ツール経由で消えることがあるので、集計はスクリプトファイルにする。

## 通信の記録に出ない API（BatchBridge）

- 証明書方式の CSアプリでは、一括処理（`services.batch`、`/api/batch…` の REST。例 `batchRegistTblBukaikoubi`・`batchDeleteCascadeTblBusyozokukamoku`・取込の `batchRegistTblBusyozokukamoku`）を、画面が直接送らず C# の `BatchBridge`（host object）が中継して送る（`frontend/share/src/services/BatchService.ts:136`、`desktop/Desktop/BatchBridge.cs`。WebView2 の横取りでは進捗が完了まで動かなくなるため）。CDP の `page.on('request')` には出ない。
- 画面マニフェストの呼び出し箇所に `unrecordable` と `screenEvidence`（または `nativeEvidence`）を書けば、`makeReport.cjs` が根拠のケースの成功で「確認」と判定し、対応表で「1※」と数える（2026-11-24 から。それ以前の報告書では「記録なし（画面で確認）」「記録なし（native で確認）」と出ていた）。

## gakumu の UI 部品の扱い（実証済み）

| 部品・状況 | 起きること | 扱い |
|---|---|---|
| el-checkbox | 本物の `input[type=checkbox]` は隠れている。`setChecked` は actionable を待ち続ける | `.el-checkbox` 要素をクリックし、input の `isChecked()` で状態を確かめる（`act.check`） |
| el-select（AlComboBox・部局選択など） | 選択値は `innerText` に出ず、内側の `input` の value にある。未選択の表示はプレースホルダ | `locator('input').inputValue()` で読む。未選択は空文字 |
| el-pagination | 現在ページでない「1」の文字が `" 1 "`（前後に空白） | `li[aria-label="page N"]` で選ぶ |
| 左のスライドメニュー | 閉じても opacity 0・幅0 で残り、Playwright 上は visible | 親の `.slideMenu-list` の opacity で判定する。画面を開いた後は「教務」等をもう一度押して閉じる |
| ポータル表示直後 | `el-loading-mask` がメニューを覆いクリックが通らない | 読み込み表示の消失を待ってから操作する |
| 画面の開き直し | 同じルートへの遷移では作り直されない | ロゴ（`.menu-sysyemtitle a`＝`/CS/`）でポータルに戻ってからメニューで開く |
| AlConfirmDialog | 確認・警告・エラーが同じダイアログ。確認で「はい」を押すと閉じずにエラーへ切り替わることがある。警告・エラーはボタン「はい」1つ | 「はい」の後は閉じるのを待たず、次の文言を待つ |
| el-notification | 約4.5秒で消える | 出た直後に読む・撮る |
| 範囲指定（AlLectureCodeRangeSearch・AlTeacherCodeRangeSearch） | 終了側にフォーカスするまで、開始側の値が終了側に写る | 終了側の入力時の動作を見るときは、一度消してから入力する |
| 検索条件 | 中止やダイアログを閉じても条件は戻らない | 手順ごとに条件を明示的に設定する |
| 部局の選択肢（AlBukyoku1Search） | ログインユーザーの権限の部局だけが出る（`session.activeShozoku1`）。部局を指定しない検索も権限の部局で絞られる | 担当範囲のケースは「全行の部局が選択肢に含まれる」で確かめる |
| サブダイアログの一覧の列 | 同じ部局でも、画面によって正式名・略称（`ryakusyou`）が違う | 期待値は列の prop を読んで決める |

## API の記録（実証済み）

- CDP 接続の `page.on('request'/'response')` で、証明書方式の中継（WebResourceForwarder）を通る要求も見える。
- GraphQL は `POST /api`、本文の `operationName` が SDK の関数名と同じ（例 `getFilteredWrsRisyuudaimokuExtend`）。一覧取得はページごとに同じ操作名を複数回送る（100件ごと）。
- エラーは HTTP 200 で本文の `errors` に入る。画面はそれを表示せず「データは有りません。」になることがある。件数だけを記録して判定に使う。
- ログイン直後のポータルは `getInformationFromUniversityWithReadded`・`getFilteredDDocumentsBodies`・`getFilteredMstEnvironment`・`getUnconfirmedSyogakukinIdou`・`kigyouCodeMissingNotification` を呼ぶ。画面の母数ではないので「画面外」に分ける。

## CDP接続の例

```ts
import { chromium } from '@playwright/test';

const browser = await chromium.connectOverCDP(cdpUrl);
const context = browser.contexts()[0];
if (!context) throw new Error('WebView2 contextが見つからない');
const page = context.pages().find(p => {
  const url = new URL(p.url());
  return url.origin === targetOrigin && url.pathname.startsWith('/CS/');
});
if (!page) throw new Error('対象環境のCSページが見つからない');
```

attached context とは別の `browser.newContext()` に画面を作らない。`browser.close()` は接続を切るだけで、CSアプリは終了しない。

テスト用インスタンスの終了は、今回起動した PID に `CloseMainWindow()` で行う（強制終了しない。閉じるときに閲覧データの消去が走る）。

参考: [Playwright公式WebView2手順](https://playwright.dev/docs/webview2)、[connectOverCDPの制約](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)。
