# QA Skill の移行メモ

旧 QA Skill（`~/.claude/skills` に直接置かれているもの）の知見のうち、特定の案件に固有の部分をまとめたメモです。段階1・2で作った `aidev-qa-*` は案件に依存しない書き方にしたため、環境の URL、体制、テスト用アカウントの扱い、IdP の設定、画面とリポジトリの対応、落とし穴、到達手順は Skill に入っていません。案件の担当者は、このメモを元に自分の QA リポジトリの `knowledge/<product>/profile.md` を書いてください。

案件ごとのメモは次の2つです。

- [university-campus.md](university-campus.md)：信州大学キャンパス情報システムのリニューアル（Web）
- [cs-desktop-app.md](cs-desktop-app.md)：Allcampus の CS アプリ（WinForms と WebView2）

このメモは旧 Skill の記述を移したものです。ファイル名と本文の案件名、ホスト名は旧 Skill の書き方のままにしてあります。ただし一部のホスト名（CS アプリの PT のドメインなど）は、旧 Skill に省略形でしか書かれていないため推定で補っています。確認の方法は cs-desktop-app.md の front matter の案に書いてあります。日付や環境の状態は記録した時点のもので、実行するときは現物で確かめ直してください。

## 旧 Skill と新しい Skill の対応

| 旧 Skill | 新しい Skill | 備考 |
|---|---|---|
| qa-strategy | aidev-qa-strategy | 段階1 |
| spec-test | aidev-qa-test-design | 段階1。設計書がある場合。同梱の HTML レポートのスクリプトは、後の段階で `aidev qa trace --html` に統合する予定で、まだない |
| dev-test | aidev-qa-test-design | 段階1。設計書がなくコードだけが手がかりの場合は `references/code-only.md` |
| （旧 Skill に相当なし） | aidev-qa-test-review | 段階1。ケースのレビュー |
| test-execute | aidev-qa-test-run | 段階2。結果は `runs/<YYYYMMDD>-<run-id>/result.md` に書く。旧版の `templates/report.html` は使わない |
| campus-playwright | aidev-qa-characterization | 段階2。画面マニフェストは `automation/web/manifests/<画面>.json` |
| capturing-playwright-evidence | aidev-qa-characterization | 証跡の撮り方、完全性の確認は `references/evidence.md` に移した |
| capi-saml-login | aidev-qa-login-session | 段階2。SAML は `references/saml.md` |
| capi-authz-test | aidev-qa-authz-test | 段階2。認可の表は `automation/web/authz/<機能>.json` |
| capi-regression-test | aidev-qa-regression-compare | 段階2。差異の分類は `references/diff-classification.md` |
| comparing-evidence-rounds | aidev-qa-regression-compare | 照合の結果は `compare.md` と `compare.json`。顧客に出す HTML は `aidev qa compare-report` で作る。旧版の `generate-report.js` の移行先 |
| cs-webview-regression-test | aidev-qa-characterization と aidev-qa-regression-compare | WebView2 の中の操作と記録は `references/webview2.md`。環境間の照合は regression-compare |
| cs-native-regression-test | aidev-qa-desktop-gui | WebView2 の外のダイアログとネイティブのログイン |
| automating-wpf-with-flaui | aidev-qa-desktop-gui | FlaUI の書き方は `references/flaui.md`、ダイアログは `references/dialogs.md` |
| orchestrating-capi-screen-verification | aidev-qa-screen-verification | 段階2 |
| cause-repro | aidev-qa-cause-repro（予定） | 後の段階で追加する予定で、まだない。旧 Skill を使い続ける |
| test-verify | aidev-qa-fix-verify（予定） | 後の段階で追加する予定で、まだない。旧 Skill を使い続ける |
| uat-verify | aidev-qa-fix-verify（予定） | 同上 |

予定の Skill が出るまで、cause-repro、test-verify、uat-verify は消さないでください。このメモの対象にも含めていません。

## 旧 Skill を消すかどうかは利用者が決める

旧 Skill は、各案件の移行が済んだ時点で、利用者がその案件について消すか残すかを決めます（設計書 5.7）。基盤の側で消したり、無効にしたりはしません。

- 新しい Skill は `aidev skill add` で、QA リポジトリのプロジェクト直下に入ります。旧 Skill は利用者全体の `~/.claude/skills` に残るため、移行期間中は発動条件が重なります。
- 重なっている間は、どちらが動いたかを作業の記録に残してください。同じ作業を両方で流す必要はありません。
- 旧 Skill のファイルには、実行者ごとに書き換えた実パスや、`git update-index --skip-worktree` を付けたローカルの変更が入っていることがあります。消す前に、必要な記述を案件のプロファイルへ写したかを確かめてください。
- 旧 Skill が作った画面マニフェスト、仕様書、証跡は新しい形式に変換しません（設計書 5.12）。新しい形式は、これから行う作業から使います。旧マニフェストのフィールド（`newOperationName`、`acceptedRisks` など）は、読み物として参照するだけにして、新しい `automation/web/manifests/` へ自動では移しません。必要な画面は、aidev-qa-characterization で記録し直します。

## 案件の移行の始め方

1. QA リポジトリを作ります。

   ```bash
   aidev init qa-<案件> --template qa
   ```

   作られる構成は次のとおりです。旧 Skill の置き場所とは違うので、既存のファイルを移す必要はありません。

   ```text
   qa-<案件>/
     plan/strategy.md、plan/acceptance.md
     cases/<機能>.md
     runs/<YYYYMMDD>-<run-id>/result.md、evidence/<TC-ID>/
     runs/<比較先の run>.compare.json    （環境間の照合のマニフェスト）
     knowledge/<product>/profile.md
     knowledge/<product>/*.md
     automation/web/                     （Playwright。tests、manifests、authz、.auth）
     automation/desktop/                 （FlaUI の C# テスト）
     reports/
   ```

   - `automation/web/.auth/` には Cookie が入るので、コミットしません（雛形の `.gitignore` が除外しています）。
   - `runs/<YYYYMMDD>-<run-id>/` は実行ごとに1つ作ります。証跡の保存方式（`lfs`、`external`、`local`）は、プロファイルの `evidence` で決めます。個人情報が映る案件では `lfs` を選ばないでください。
   - 環境間の照合の結果の正本は `runs/<比較先の run>/compare.md` です。顧客に出す HTML の元になるマニフェストは `runs/<比較先の run>.compare.json` に置きます。

2. 案件のメモを開き、front matter の案を `knowledge/<product>/profile.md` の先頭に、本文の節を同じファイルの本文に書き写します。`product` は小文字・数字・ハイフンで、`knowledge/` の下のディレクトリ名と揃えます。

3. 環境変数の名前だけを確かめます。値はメモにも profile.md にも書きません。作業者の PC の環境変数、または各自の `.env` に入れます。

4. プロファイルを検査します。

   ```bash
   aidev qa profile check knowledge/<product>/profile.md
   aidev qa profile check knowledge/<product>/profile.md --skill aidev-qa-authz-test
   ```

   `--skill` を付けると、その Skill が必要とする項目（例：authz-test はロールが2つ以上と login）が揃っているかも検査します。使う予定の Skill ごとに流してください。

5. `aidev skill add` で使う Skill を入れ、段階2の順（login-session、characterization、必要なら authz-test、regression-compare、screen-verification）で始めます。

## 書き写すときの決まり

- 秘密情報の値は書きません。profile.md には環境変数の名前（`*_env`）だけを書きます。旧 Skill の中に値が書かれていた場合は、写さずに「旧 Skill に値が書かれているため、担当者が確認して secrets へ移すこと」と記します。このメモを作るときに調べた範囲では、旧 Skill にパスワードやトークンの値は見つかりませんでした。ただし、テスト用アカウントの ID らしい文字列が数件あります（university-campus.md に所在だけ書いてあります）。ID もプロファイルに書かず、環境変数に入れてください。
- 内部のホスト名や URL は案件の事実なので、プロファイルに書いてかまいません。ユーザー名やパスワードを含む URL、クエリ付きの URL は書けません（`qa profile check` が拒否します）。
- 環境の状態（どの環境が旧版か、どの IdP を使うか、ログインが通るか）は変わります。メモの日付を見て、実行の前に確かめてください。

## 共通の補足（言語別の実行メモ）

旧 test-execute にあった、案件に依存しない実行の覚え書きです。aidev-qa-test-run には細かい手順を入れていません。

- Java（Spring、Mockito、JUnit5）では、`protected` のフィールドと同じパッケージへの配置で、リフレクションなしに差し替えられます。マルチモジュールで依存モジュールが `.m2` にないときは、先に `mvnw install`（Gradle なら `./gradlew publishToMavenLocal`）します。Maven は PowerShell から実行し、`JAVA_HOME` は対象プロジェクトが求める JDK に合わせます。
- C#（.NET、xUnit）では、`private static` のメソッドでも、`MethodInfo` のリフレクションでソースを変えずに呼べます。テストプロジェクトがないモジュールは、`ProjectReference` で対象を参照する最小の csproj を新しく作ります。
- 本番と同じ DB に届かないときだけ、使い捨ての Docker コンテナ（既存と名前・ポートを分ける）に、対象の SQL が参照するテーブルとカラムだけの最小のスキーマを作って、合成データで実行します。終わったら必ずコンテナを消します。
- テストデータは、ルートフォルダ直下の `QA/test-data` にまとめる運用でした。QA リポジトリでは `automation/` の下の置き場所を案件で決めてください。
