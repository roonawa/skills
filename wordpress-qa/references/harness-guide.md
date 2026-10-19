# ハーネスの実行手順

## ブラウザーの管理画面

セットアップ済みなら、ハーネスフォルダーで次を実行する。

```powershell
npm run ui
```

http://127.0.0.1:4310 に管理画面を開く。設定を省略した場合は、このPC内のデモサイトも起動する。検査実行、進捗、状態別の集計、履歴、項目詳細、画像・ログ・HTMLレポートを確認できる。デモも実際のハーネスを実行するため、最初の画像検査は「確認待ち」になる。

実サイトの登録は起動時に指定する。複数サイトは`--config`を繰り返す。各サイトのoutputDirは別々に設定する。

```powershell
npm run ui -- --config C:\projects\site-a\qa\site.json --config C:\projects\site-b\qa\site.json
```

ポート変更は`--port 4311`。サーバーは127.0.0.1だけで待ち受け、起動時に登録した設定だけを実行する。共有ホスティング・社外公開用のアプリではない。停止は起動したターミナルでCtrl+C（処理中の場合はその終了を待つ）。

画面の使い方:

1. 左上でサイト、上部で検査範囲を選び「検査を実行」。同時実行は1件。
2. 進捗は自動更新。項目を選択すると判定理由と証拠を確認できる。「要対応」で不合格・実行不能・確認待ちを絞り込める。
3. 画像を基準として採用する場合、候補画像を確認し、確認チェックを付けてから承認する。実行中・設定が変わった古い履歴は承認できない。
4. 承認後に再実行。過去の結果は書き換わらない。左側から過去の履歴を選んで確認できる。

UIはCLIと同じresults.jsonを読み、同じCLIで実行・承認する。手動確認のreviewや未実施をUIだけで合格へ変更しない。サーバー再起動前の未完了実行は、完了を確認できない履歴として表示する。設定編集と案件モジュール作成は引き続きファイル側で行う。

UI自身の検証は`npm run test:ui`。一時フォルダーで実ブラウザーを操作し、実行・進捗・承認・再実行・不具合表示・モバイル表示を確認する。

## セットアップ

Node.js 22以降を使用する。作業場所は `wordpress-qa/harness`。ライブラリはpackage-lock.jsonで固定する。

```powershell
Set-Location C:\Users\roonawa\.claude\skills\wordpress-qa\harness
npm ci
npx playwright install chromium
npm test
```

Windows以外のCIでは `npx playwright install --with-deps chromium`。OS・フォントが変わる場合はその環境で基準画像をレビューする。既存のWindows基準をLinuxへ流用しない。
audit/discoverのみを使う場合、ブラウザーバイナリのインストールは不要。

## ローカルで一通り試す

別ターミナルで `npm run demo` を実行すると http://127.0.0.1:4300 に検証用サイトが起動する。WordPress本体ではなく、フォーム・メールAPI・HTML応答の契約を検証するfixtureである。

```powershell
node bin/qa.mjs validate --config examples/site.demo.json
node bin/qa.mjs run --config examples/site.demo.json --suite all
```

初回は画像基準がないためreviewになり終了2。表示されたreport.htmlを開き、画像とreadiness証拠を確認する。意図した表示と確認できた画像だけ承認する。

```powershell
node bin/qa.mjs approve-baseline --config examples/site.demo.json --run <実行フォルダー> --id snapshot.home-mobile
node bin/qa.mjs run --config examples/site.demo.json --suite all
```

承認は以前の結果を書き換えない。設定変更後の古い候補は承認できない。ブラウザー版・OS・表示設定が変わると再レビューになる。基準画像は設定と同様に案件ごとに管理し、正常だと確認した履歴を残す。

ハーネス自身の結合検証は `npm run test:integration`。独立ポートにfixtureを起動し、初回review→明示承認→正常2回→auditのみの未実施記録→意図的不具合検出を自動検証する。fixtureに限り画像承認もテストコードが実行する。実サイトの画像自動承認には転用しない。

## 実サイトへ導入

確認済みのサイトマップURLから一覧を収集する場合は、最初のサイト設定を用意して次を実行する。サイトマップの子一覧も辿るが、同一origin、100サイトマップ・10000ページまで。既存出力は上書きしない。

```powershell
node bin/qa.mjs discover --config <absolute-site.json> --sitemap /wp-sitemap.xml --output inventory.json
```

この例のパスを固定値として扱わず、SEOプラグイン等の実設定に合わせる。inventory.jsonは観測したURL一覧であり、期待値や合格結果ではない。CMS公開一覧や移行対象表と照合し、孤立ページも追加する。

1. 案件フォルダーへ `site.demo.json` をコピーし、名前・URL・環境・ページ期待値・policy・代表ページを実仕様へ変更する。
2. `journeys[].module`には案件の操作モジュールを置く。デモのセレクタや`/send`、`/collect`、cleanup URLはデモ専用なので、そのまま本番へ向けない。
3. 利用できる検証用メールサーバーとAPIを設定する。Mailpit API非互換の場合は案件モジュール側で検証し、到達できなければblockedを返す。
4. デザインの意図・実メール到達・reCAPTCHA実設定・バックアップ等、必要な未自動化項目をmanualへ追加する。
5. validate→audit→journey→visualの順に単独確認し、最後にallで同一実行の結果を集約する。別実行結果の自動マージは実装していない。

HTTP認証等のヘッダーは、環境変数へJSONで渡して`headersEnv`に変数名を設定する。認証方法によってstorageStateやログイン処理が必要な場合はPlaywright構成を案件に合わせて拡張する。現状の組込認証はヘッダー方式のみ。

## スコープと証拠

`--suite audit|journey|visual|all`で実行範囲を選ぶ。他suiteは台帳から消えずnot_runになるため、単独実行は終了2になり得る。これは異常ではなく「全体判定は未完了」の意味。

各実行は出力フォルダーに `context.json`、`results.json`、`report.html`、必要な証拠を保存する。失敗時はスクリーンショットとPlaywright traceを保持。認証ヘッダー値はcontextに保存しないが、trace・画像・HTML断片・案件がattachしたデータには機密情報が入り得る。検証データを使い、共有前に確認し、案件の保管期限・アクセス制限を適用する。

使用ブラウザーはChromium、workers=1、再試行=0。長い一覧の全リンク検査はtimeoutMs×4のテスト時間を超える場合がある。案件に合わせてページ分割やランナー時間枠を調整する。外部リンク巡回、総合脆弱性診断、性能計測、実WordPressの起動・DB復元は組込対象外。

テストの拡張・修正時は、正常データだけでなく、検出したい不具合を入れたfixtureで失敗することを確認する。新しいテストを毎回生成するのではなく、検証済みの検査を保守する。
