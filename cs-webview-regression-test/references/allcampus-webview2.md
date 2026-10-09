# Allcampusの調査箇所と接続

以下は2026-10-08に確認した構成。実行時は現物を再確認する。リポジトリルートは利用者の環境から解決し、固定のユーザーパスを前提にしない。

| ファイル | 確認する内容 |
|---|---|
| desktop/Desktop/Desktop.csproj | net8.0-windows、UseWindowsForms、WebView2/runtime、ビルド構成 |
| desktop/Desktop/MainForm.cs | 接続先の選択、一時プロファイル、起動時ClearBrowsingDataAsync、host object、UserAgent、プラグイン起動 |
| desktop/Desktop/CommandLineOptions.cs | `--address` / `-a`、`--token` / `-t` |
| desktop/Desktop/app.PT.config | 設定上は `https://allcweb1.local.ailesys.co.jp/CS/` |
| desktop/Desktop/app.ST.config | 設定上は `https://allcweb3.local.ailesys.co.jp/CS/` |
| desktop/Desktop/JavaScriptInterface.cs | JavaScriptInterface、RequestLoadPlugin、SetOutputFolder、外部アプリ起動 |
| frontend/gakumu/src/plugin/index.ts | CSアプリ判定とhost object呼出し |
| frontend/gakumu/src/router/index.ts | desktopOnlyへの誘導と認証遷移 |
| frontend/gakumu/playwright.config.ts | 現状localhost:5174向け、通常ブラウザとstorageState |
| frontend/gakumu/e2e/auth.setup.ts | localhost向け認証。既存の資格情報を別環境へ流用しない |

MainFormはDefaultUrlを読み、指定されたaddressで上書きする構造。アプリとDLLのPT/STビルド差が必要なら、それぞれの配布物を使う。URL切替だけで実環境の配布物比較を代替しない。

WebView2は `AddHostObjectToScript("JavaScriptInterface", ...)` により実C#連携を持つ。存在確認は無害な評価で行う。存在確認のために帳票DLLをロードしたり外部アプリを起動したりしない。

`SetOutputFolder`があるだけでは帳票全体が無人出力できるとは限らない。対象プラグインの実装と実行結果で保存ダイアログ・外部起動の有無を確認する。UIにない設定を直接変更して経路を短縮する場合は、テスト準備として明記し、その設定操作自体は検証済みとしない。

## CDP接続の例

テストで新規に起動するCSアプリの子プロセス環境に限って、次を渡す。

```text
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<空きポート>
```

起動時引数で接続先を指定する例は `Desktop.exe --address <PTまたはSTのCS URL>`。秘密のtokenをコマンドラインに置くとプロセス情報へ露出するため、認証方法は既存運用と実装に合わせる。

以下はfixture内部の接続部分の例であり、そのまま実行する完成ハーネスではない。

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

起動直後はabout:blankや認証ページの可能性がある。実ハーネスでは期限付きでページの生成・遷移を待つ。別環境のページを拾わず、認証後に対象画面URLと見出しを確認する。attached contextとは別の `browser.newContext()` に画面を作らない。

アプリは一時userDataFolderを作り、起動時に閲覧データを消す。既存の通常ブラウザ向け認証setupとstorageStateをそのまま採用しない。環境変数によるprofile指定の優先順位は採用runtimeで実証し、コードにないプロファイル分離方法を仮定しない。

参考: [Playwright公式WebView2手順](https://playwright.dev/docs/webview2)、[connectOverCDPの制約](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)。採用バージョンの公式情報を確認する。CDPは通常のPlaywright接続より制約があり、trace/download等は事前実証する。
