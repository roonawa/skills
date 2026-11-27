# aidev 開発基盤
Claude Code と Codex を使うチーム向けのローカル CLI。Phase 1 では、レビュー済み Skill の配布、版の記録、配布後の照合を行う。

## 最初のプロジェクトを作る
Node.js 22 以上と npm を用意する。このディレクトリで次を実行する。

```sh
npm ci --ignore-scripts
npm test
node dist/cli.js skill list
```

PowerShell で、プロジェクトを作りたいディレクトリへ移動して試す例。最初の行だけ基盤ディレクトリで実行する。

```powershell
$cli = (Resolve-Path ./dist/cli.js).Path
Set-Location $env:TEMP
node $cli init demo --template core --dry-run
node $cli init demo --template core
Set-Location demo
node $cli doctor
node $cli skill validate aidev-project-verification
node $cli skill add aidev-project-verification
node $cli verify
```

最後の出力は `{"ok":true,"skills":["aidev-project-verification"]}`。macOS と Linux ではビルド済み cli.js の絶対パスを node に渡す。package.json の bin 名は aidev。グローバルインストールは不要。

### プロジェクト内の AI から CLI を呼べるようにする

Skill の本文は CLI を `aidev …` と書く。各作業者は環境変数 AIDEV_CLI に、基盤の dist/cli.js の絶対パスを設定する。init が生成する AGENTS.md には、`node $env:AIDEV_CLI …`（PowerShell）または `node "$AIDEV_CLI" …`（bash/zsh）で呼ぶことと、未設定ならパスを推測せず担当者に確認することが書かれている。

```powershell
[Environment]::SetEnvironmentVariable('AIDEV_CLI', $cli, 'User')
```

CLI は既存プロジェクトの AGENTS.md を上書きしない。既存プロジェクトでは、新しく init したプロジェクトの AGENTS.md から「aidev CLI の呼び出し方」の節を手で追記する。

## コマンド
|操作|実行場所と結果|
|---|---|
|init NAME [--template core/react/unity/qa]|親ディレクトリ。子に共通設定と選択したテンプレートを配置。既定は core。qa は QA リポジトリの雛形|
|skill list / skill validate NAME|任意の場所。同梱原本の名前・説明・版・区分（core / qa）を取得|
|skill add NAME|プロジェクト直下。両ホストの Skill と .aidev/installed の版記録を作成|
|skill update NAME|プロジェクト直下。登録済みの Skill を同梱の版に置き換える。利用者が編集したコピーは置き換えない|
|doctor|プロジェクト直下。Node、OS、設定版、Registry 件数を取得|
|verify|プロジェクト直下。登録した Skill の欠損・内容差・版差を検出。未登録なら空配列|
|check|プロジェクト直下。aidev.json の template に対応するアプリの検査結果を JSON で返す。qa では knowledge/<製品>/profile.md ごとに、--skill なしの qa profile check と同じ検査（形式・秘密情報・product の有無）を行う。Skill ごとの必須項目は見ない。1件もなければ 2 を返す|
|qa profile check FILE [--skill NAME]|任意の場所。FILE は実行場所から下の相対パスで指定する（絶対パスや .. は使えない）。QA の案件プロファイルの形式と秘密情報らしい値を検査し、--skill を付けるとその Skill の必須項目も検査する|
|qa issue create --profile FILE --run RUNDIR --tc TC-ID [--dry-run]|QA リポジトリの直下。result.md の NG のケースを Gitea の Issue にする。詳細は「段階3で足したもの」|
|qa compare-report MANIFEST OUT [--link]|任意の場所。新旧の証跡を並べた自己完結の比較 HTML を作る。MANIFEST は比較マニフェスト（JSON）、OUT は .html か .htm で終わり、MANIFEST と別のファイル。MANIFEST と OUT はカレントディレクトリの下を指す相対パスにする（絶対パスや .. は使えない）。画像は png・jpg・jpeg・gif・webp で1枚20 MiB まで、マニフェストと同じディレクトリの下に置く。既定は画像を HTML に埋め込み、--link を付けると OUT のディレクトリの assets/ へ複製して参照する|
|qa trace DIR [--html FILE]|任意の場所。DIR は実行場所から下の QA リポジトリ。AC・TC・run の結果・Issue のつながりを読むだけで検査し、JSON で返す（QA リポジトリにも Gitea にも書き込まない）。エラーの指摘があれば 1 を返す。--html を付けると、つながりを1枚の自己完結 HTML にして FILE に書く。FILE は .html か .htm で終わる実行場所から下の相対パス。QA リポジトリの中も拒まないが、生成物がリポジトリに混ざらないよう、compare-report と同じく QA リポジトリの外に書くことを勧める|
|spec check FILE|任意の場所。FILE は実行場所から下の相対パスで指定する（絶対パスや .. は使えない）。実装ループに渡す仕様書の形式（受け入れ条件・やらないこと・判断待ち）を検査する|
|workflow check TASK --review FILE|一つの実装タスクに対し、単体テスト・セキュリティ・仕様乖離と過剰実装のゲート結果と修正回数を記録して次の作業を決める|
|workflow run TASK --spec FILE|実装・レビュー・ゲートを別々の Claude Code セッションで自動で回し、review か needs-human で止まる|
|workflow status TASK|保存された直近の判定を表示する。検査実行や試行回数の加算は行わない|

すべて JSON を標準出力に返す。成功は終了コード 0、失敗は 1。check は失敗がなくても実行不能の項目がある場合に 2 を返す。init・add・update は末尾に --dry-run を付けると変更予定を返す。再実行で同じファイルはスキップする。既存内容と異なる場合は処理を止める。メタデータ検証は社内の単一 Markdown 配布形式に限定する。

## React / TypeScript を検証する

Node.js 22.17.1 以上を用意し、前述の `$cli` を設定した PowerShell で実行する。

```powershell
node $cli init web --template react
Set-Location web
npm ci --ignore-scripts
node $cli check
```

check は信頼済みプロジェクトの npm scripts（typecheck、lint、test、test:coverage、build）を順に実行し、検査名 typecheck、lint、test、coverage、build で結果を返す。各項目の制限時間は5分。JSON には判定と再現用コマンドを返し、子プロセスの出力は含めない。詳細は失敗した項目を、例えば `npm run lint` で個別に確認する。生成・依存インストールからビルド成果物までを通して試すには基盤側で `npm run test:react` を実行する。

### テストの質の検査

coverage は、テストに合格しても検証されていないコードを見つけるための検査。雛形の `test:coverage` は c8 の `--all` で src 配下を数えるため、どのテストからも読み込まれないファイルも 0% として扱う。行・分岐・関数・文の下限はそれぞれ 80%。テストファイルと起動用の src/main.tsx を除外する。下限と除外は script の引数に書いてあり、`test:` で始まる script と `.c8rc*`・`.nycrc*`・package.json の c8・nyc 設定は workflow の保護対象。AI が変更すると停止して担当者に引き継ぐ。下限や除外の見直しは担当者が行い、新しいタスク名で再開する。

カバレッジは、テストが値を正しく確かめているかまでは測らない。aidev-testing は各テストに「どの実装変更で失敗するか」（品質契約）を書かせる。aidev-code-review は、その変更で実際に失敗する具体的なアサーションになっているかを確認する。変異テストは実行時間と依存の重さを理由に未導入。

この版より前に作った React プロジェクトには test:coverage がないため、coverage が失敗する。雛形の package.json から script と devDependencies の c8（12.0.0）を手で追加し、.gitignore に coverage/ を加える。c8 12.0.0 は依存の glob・minimatch に中程度（moderate）の既知の脆弱性を含む（2026-11-12 時点の npm audit で4件、high 以上はなし）。開発時のみ固定パターンで使う。

## Unity / C# を検証する

`aidev init game --template unity` は C# のサンプルと EditMode テストを含むプロジェクトを配置する。プロジェクト直下で `aidev check` を実行すると、Editor 2022.3.62f1 と Test Framework 1.4.6 の設定を照合する。実機ランナーは未実装のため、設定が正しくても EditMode・PlayMode・ビルドの結果は unavailable、終了コードは 2 となる。Mock は基盤のテストからのみ使用する。

## 同梱する開発用 Skill

作業に必要なものをプロジェクト直下で個別に追加する。例えば `aidev skill add aidev-debugging` で障害調査の手順を配置できる。

|作業|Skill|引き渡す結果|
|---|---|---|
|期待動作を決める|aidev-requirements|事実・希望・仮定の分類、AC-ID 付きの受け入れ条件、やらないこと、判断待ち|
|設計を選ぶ|aidev-architecture|案の比較表、移行と切り戻しの手順、承認を求める決定記録|
|作業を分ける|aidev-task-planning|AC・先行・変更ファイル・完了の判定を持つタスク表、並行作業の確認|
|コードを変更する|aidev-implementation|AC 対応表、仮定と確認待ち、実行結果、残件|
|動作を確認する|aidev-testing|AC-ID・期待値の根拠・品質契約付きのテストケース表、破壊確認の記録、🐛実装疑義|
|失敗を追う|aidev-debugging|再現テスト、仮説と観測の表、修正と破壊確認、同じ原因の他経路|
|変更を審査する|aidev-code-review|判定、再現条件と根拠を伴う指摘、AC 対応表、テストの強さと弱体化の確認結果|
|手順を改善する|aidev-skill-evolution|記録の分類、機械的な対策案、旧版との比較結果、承認用の変更案と戻し方|

アプリの障害調査には aidev-debugging、配布された Skill 自体の改変・欠損の調査には aidev-project-verification を使う。

### 配置した Skill を新しい版にする

基盤の Skill が新しい版になると、配置済みのプロジェクトでは verify が版の違いを示して失敗する。プロジェクト直下で `aidev skill update aidev-NAME --dry-run` を実行して置き換えるファイルを確かめ、`--dry-run` を外して実行する。

update は、両ホストのコピーが登録時の版として配布された内容そのもの（改行コードの違いは同じとみなす）の場合だけ置き換え、最後に `.aidev/installed/NAME` の版を書き換える。どちらかのコピーを利用者が編集していた場合、または登録時の版の内容が記録にない場合は、何も変更せずに失敗する。そのときは変更を確認して必要なら退避し、そのファイルと `.aidev/installed/NAME` を削除してから `aidev skill add aidev-NAME` で入れ直す。途中で止まった場合は同じコマンドで再開できる。

配布した版の内容は `skills/history.json` に版ごとのハッシュで記録する。Skill の原本を変えて metadata.version を上げたら、`npm run build` の後に `node scripts/skill-history.mjs` を実行して記録を更新する（git の履歴からも過去の版を集める）。記録漏れはテストが検出する。aidev-implementation と aidev-repair-workflow の 0.4.0 は git に入る前の版で記録がないため、この2つを 0.4.0 で登録したプロジェクトは上の手順で入れ直す。

Skill 名には、利用者環境の汎用 Skill（code-review、debugging など）と衝突しないよう `aidev-` を付ける。0.1.0 までの旧名（接頭辞なし）で登録したプロジェクトでは verify が改名先を示して失敗する。`aidev skill add aidev-NAME` で新名を追加し、旧名の `.claude/skills/NAME`、`.agents/skills/NAME`、`.aidev/installed/NAME` を内容確認のうえ削除する。CLI は旧名の配置を自動では削除しない。

## 画面開発の標準フロー

プロジェクト直下で `aidev skill add aidev-ui-delivery` を実行する。Claude Code と Codex の両方で、次の順序を使える。[手順と予約画面の具体例](skills/core/aidev-ui-delivery/SKILL.md)

要件定義 → 仕様書・設計書 → 操作モックで UI/UX を決定 → 開発者が共通コードと利用例を実装 → AI が機能を実装 → 検証 → レビュー → 最終テスト。

モックで決まった操作と状態遷移を仕様書に反映する。開発者は共通部品の実際の呼び出し例と変更可能な範囲を渡す。AI はその契約に沿って画面固有の処理をつなぐ。

### 実装後の検証

各タスクには一つの識別名を付ける。実装が終わるたびに次の3つのゲートを通す。

|ゲート|判定|
|---|---|
|単体テスト|CLI がアプリの検査（React では typecheck・lint・test・coverage・build）を実行する|
|security|AI が差分をレビューし、脆弱性・危険な扱いの指摘を JSON に書く|
|spec|AI が差分を受け入れ条件と照合し、仕様乖離（deviation）と過剰実装（excess）の指摘を JSON に書く|

例として、React アプリの表示修正を実装し、差分をレビューした直後に `aidev workflow check counter-display --review .aidev/reviews/counter-display-0.json` を実行する。レビュー結果の形式は [aidev-repair-workflow](skills/core/aidev-repair-workflow/SKILL.md) にある。`--review` がない、または形式が不正な場合は試行番号を予約せずにエラーを返す。

ホストへこの手順を追加するには `aidev skill add aidev-repair-workflow` を実行する。以前に配置した開発用 Skill と併用できる。

|返された state|次の作業|
|---|---|
|repair|失敗した項目を再現し、aidev-debugging に沿って原因を調べる。仕様・テスト・セキュリティ検査を維持して実装を1回修正し、同じコマンドを再実行する|
|needs-human|自動の差し戻しを止める。CLI が書いた `.aidev/runs/TASK/handoff.md`（引継ぎ票）と、AI の試したこと・残る仮説を担当者に渡す|
|review|コード差分・共通部品の使い方・確定モックとの一致をレビューする。指摘反映版で受け入れテストを実行し、対象版・結果・残件を報告する|

初回の検査は修正0回。ゲートを通過しなければ実装へ差し戻し、人の確認なしで最大3回まで修正する。同じ失敗の再発は3回を待たずに止め、別の原因で失敗が続く場合は3回目の修正後に止める。実行不能と保護対象の変更でも止まる。止まると state は needs-human となり、試行ごとのゲート結果と指摘を並べた引継ぎ票を書く。引継ぎ票が既にある場合は上書きしない。同じ失敗の判定は、アプリの検査は検査項目とエラー署名、レビューは指摘の種類・ref・file の組で行い、summary の文言は使わない。一つのゲートに同じ組の指摘が2件あるレビュー結果は拒否する。レビュー結果には、合否に影響しない確認事項を任意の notes（最大10件）として書け、結果の JSON と引継ぎ票に載る。review と needs-human に達した識別名を再指定すると記録済みの結果を返す。新規タスクには新しい識別名を使う。コードの編集と承認はホストと担当者が行う。CLI は同じタスクの検査履歴と停止条件を管理する。

履歴は `.aidev/runs/TASK/` に保存する。同じ試行を二重実行しないよう、各回の開始時に番号を予約し、完了後に結果を確定する。実行中または保存前の中断を検出した場合は、記録を保持してプロセスの状態を確認する。React の失敗判定には、ログの先頭と末尾から時刻や一時パスなどの変動部分を正規化して得たハッシュを使う。長大な出力の中央にしか現れない差異は識別できないことがある。

### 実装ループに渡す仕様書

1タスクにつき1つの Markdown を用意する。見出し（`## 受け入れ条件`）でも、C-HUB の依頼テンプレートの `受け入れ条件:` の形でもよい。

```markdown
# 商品レビュー一覧（タスク名: review-list）
## 受け入れ条件
- AC-001: レビューが2件以上あるとき、投稿日時の新しい順に表示する（出典: 要件定義書 3.2）
- AC-002: 取り下げ（AC-001 に統合）
## やらないこと
- 並べ替えの切り替え UI
## 判断待ち
なし
```

`aidev spec check docs/spec.md` は形式を検査する。`workflow run` も最初に同じ検査を行い、不備があればセッションを起動せずに止まる。

|区分|内容|
|---|---|
|止まる（errors）|受け入れ条件の節や `- AC-001: …` の行がない、AC-ID の重複、内容が空の AC、判断待ちの AC、⚠要確認 が残っている、やらないことの節がない、判断待ちの節に「なし」以外の項目がある|
|警告（warnings）|AC に判定できない語（適切・速やかに・短時間・など）がある、やらないことが空、AC が10件を超える（1タスクに大きすぎる可能性）|

番号を残して内容を「取り下げ」とした AC は数えない。検査は形だけを見る。受け入れ条件が正しいかは人とレビューのゲートが判断する。既存の要件定義書・仕様書から起こすときは、AI にこの節を形式として示し、「別の AI が人の確認なしで実装する前提」と伝えればよい。2026-11-17 の試行では、専用の Skill なしでも、矛盾する期限・曖昧な語・未承認の節・希望と将来の検討事項を、判断待ちとやらないことに振り分けた（急ぎだと伝えた場合も同じ）。各 AC に出典の節を付けることも依頼に含める。

### 実装ループを自動で回す

`aidev workflow run TASK --spec docs/spec.md` は、上の流れを人の操作なしで回す。プロジェクト直下で、Claude Code（`claude`）にログインした状態で実行する。

1. 実装担当のセッションが仕様を読んで実装し、ローカルで検査を通す（2回目以降は直前のゲート結果とレビュー結果を読んで1回修正する）
2. 別のレビュー担当のセッションが差分を読み、security と spec の結果を返す。前回までのレビュー結果も渡す。結果は CLI の検証を通ったものだけを `.aidev/reviews/TASK-N.json` に保存し、通らなければ1回だけやり直す
3. `workflow check` と同じ判定を行い、repair なら1に戻る。review か needs-human で止まる

- 各セッションは `claude -p` で起動する。MCP サーバーは読み込まない。使える道具は、実装担当がファイルの読み書きと決まった検査（`npm run typecheck`・`lint`・`test`・`test:coverage`・`build`）、レビュー担当が読み取りだけ。git は両者とも `git status`・`git diff`・`git diff --stat`・`git ls-files --others --exclude-standard` に限る。C-HUB や Gitea への接続、git のコミットや push はしない
- 実装担当は package.json・package-lock.json・.npmrc・.yarnrc・.env*（いずれもサブディレクトリを含む）・検査設定（tsconfig・biome・ESLint・vite/vitest/jest/playwright・c8/nyc）・`.aidev/`・`.claude/`・`.agents/`・AGENTS.md・CLAUDE.md・aidev.json・`.git/`・.gitattributes・.gitmodules を編集できない。検査スクリプトや npm・git の設定を書き換えて、検査やレビューの git 呼び出しのときに別のプログラムを実行させることを防ぐため
- セッションの環境変数からは、Claude Code 自身の認証情報（ANTHROPIC_API_KEY など）を除き、TOKEN・SECRET・PASSWORD・API_KEY などを名前に含む変数を外す。セッションが書いたテストやビルドもこの環境で動く
- ゲートの検査（`check` と `workflow check` が実行する npm scripts）は、Claude Code の認証情報も含めて、こうした変数をすべて外した環境で動かす。AI が書いたコードを実行するため
- セッションはプロジェクトのコード（テスト・ビルド）を実行するため、ネットワークへの接続や Claude の認証情報の読み取りまでは防げない。夜間などの無人実行では、プロジェクトだけを置いた専用のランナー（コンテナや専用のマシン）で動かす
- 上限は環境変数で変えられる。AIDEV_SESSION_BUDGET_USD（1セッションの費用、既定 5 ドル）、AIDEV_SESSION_TIMEOUT_MIN（1セッションの時間、既定 30 分）、AIDEV_MODEL（モデル）、AIDEV_CLAUDE（claude の場所）
- 各セッションの報告は `.aidev/runs/TASK/reports/` に残る。needs-human のときは引継ぎ票と合わせて担当者が読む
- レビュー担当には実装担当の報告も渡す。受け入れ条件どうしの矛盾や曖昧さを実装が解釈で解決した場合、レビュー担当は合否とは別に、その解釈を notes に書く。review で止まったときも結果の notes に残るので、人のレビューで解釈を承認する（試行では、矛盾する2つの AC を AI が解釈で両立させ、その解釈が実装の報告にしか書かれていなかった）
- 実装担当のセッションが作業ツリーを変えずに終わった場合は、1回だけやり直す。それでも変わらなければ、そのままレビューとゲートに進む。比較はファイルのパスと内容を直接読んで行い、`.aidev/`・`.git/`・依存とビルド出力（node_modules・dist など、修正ガードと同じ対象）は含めない。git の設定が外部プログラムを起動しうるため、比較に git は使わない
- notes が「なし」「特になし」だけの場合は、空として扱う
- セッションが失敗した場合（時間切れ・上限超過・レビュー結果が2回とも不正）は、ゲートを実行せずに終了コード 2 で止まる。試行回数は消費しないので、原因を直して同じコマンドで再開できる
- 差分をレビューに見せるため、仕様書を含めた作業前の状態を git にコミットしておく

初回に見つかったテストファイルが消えた場合、または保護対象の検査スクリプトやセキュリティ設定が変わった場合は、人の確認へ引き継ぐ。型検査・Lint・テストランナーの設定（tsconfig*.json、biome.json、ESLint、vite/vitest/jest/playwright の設定、.editorconfig、Directory.Build.props、*.ruleset、.c8rc・.nycrc、.npmrc・.yarnrc、package.json の eslintConfig・jest・mocha・c8・nyc）は、初回からの内容変更に加えて、2回目以降に新たに追加された場合も停止する。アプリの機能のために vite.config などを変える場合も停止するので、担当者が差分を確認して新しいタスク名で再開する。追加判定は、この版以降に開始したタスクに適用する。テストの追加や本文の編集は可能で、skip や期待値の緩和、仕様への適合性は aidev-code-review の観点で差分レビューが判断する。履歴はローカル作業の引き継ぎ用であり、作業者自身による改変を防ぐ監査台帳としては扱えない。

## 運用上の境界

### Skill を評価する

評価結果を置きたいディレクトリで `aidev skill eval aidev-debugging` を実行する。全同梱 Skill に対応する。CLI は一時プロジェクトを生成し、両ホストへの配置、原本との一致、verify の成功、改変検出を検査する。モデル呼び出しは別途行う。標準出力の report が結果ファイルの相対パス。評価のたびに新しいフォルダを作る。

同フォルダの prompts.json には、正常・曖昧・設計衝突・テスト失敗・適用外の5件の架空の依頼が入る。比較は次の手順で行う。

1. ケースごとに対象 Skill あり・なしの独立したセッションを用意する。両方で同じホスト、モデル、予算、プロンプトを使い、前ケースの回答は持ち込まない。実装ファイルや本番データは不要。対象は依頼を受けたときの判断と作業方針。
2. モデルには prompts.json の該当する依頼だけを提示する。採点者は回答を受け取ってから report.json の expected と rubric を参照する。decision には回答で実際に選んだ行動を proceed（進行）、clarify（確認）、escalate（承認へ）、stop（停止）、skip-skill（適用外）、other（その他）のいずれかで記録する。rubricMet は具体的な説明が採点基準を満たすかを表す。
3. observations-template.json を評価作業ディレクトリ直下の paired.json にコピーする。host、model、budget の識別名と、各ケースの両群の実測値を入力する。taskSucceeded は依頼への応答が目的を達したかの採点、testsPassed/testsTotal は実行したテスト数、reviewFindings はレビュー指摘数、elapsedMs は所要時間、retries は再試行数、selectedSkills は実際に使った Skill 名。reused/reuseOpportunities は既存の実装・手順を再利用した件数とその機会数。テストや再利用機会がなければ分母と分子を0、コストが不明なら costUsd を null とする。未観測のケースには数値を推定入力しない。
4. `aidev skill eval aidev-debugging --observations paired.json` で再採点する。対象 Skill の内容・ケース・評価形式を識別するハッシュが一致する観測のみ受け付ける。ログや回答本文は入力しない。レポートには両群の指標、判断と rubric が一致した件数の差、改善候補を保存する。改善は差分と根拠を人が確認してから共通原本に反映する。

観測未入力の結果は behaviorStatus が not-run で、終了コード0はローカル検査の合格を示す。観測入力時は scored となり、対象 Skill 側で判断または rubric の不一致があれば、結果を保存して終了コード1を返す。観測は評価者の申告値。入力 JSON の整合性は CLI が検査するが、モデルや予算が実際に同じだったかは実行記録で確認する。
利用者が管理するローカルディレクトリで実行する。書き込み途中に停止した場合は dry-run で不足と競合を確認する。通常はハードリンクで完成済みファイルを確定する。リンク制限がある環境では排他的な新規作成を使うため、異常終了で残った不完全なファイルは手動で内容を確認してから復旧する。利用者が配置内容と版記録をすべて削除した場合の復元には Git の履歴を使う。verify の対象は登録済み Skill の配布内容。アプリの型検査・テストは各プロジェクトで実行する。

CI は親リポジトリの .github/workflows/aidev.yml にある。依存監査、strict ビルド、単体・CLI テストを3 OSで実行する設定。リリースや本番への配布は手動。リンク拒否の結合テストにはテスト用ディレクトリにリンクを作成できる環境が必要。

## C-HUB の読み取りと無人実行ランナー（段階1）

[設計書（案）](docs/autonomous-runner-design.md) の段階1として、C-HUB を読むだけの部品を置く。C-HUB と Gitea には書き込まない。`src/chub.ts` は GET しか送らず、書き込みの関数を持たない。段階2以降も C-HUB のタスクには書き込まず、結果は Gitea の PR と本人の相棒への通知で知らせる（2026-11-26 改訂）。

### 設定

接続先とトークンは環境変数で渡す。設定ファイルにも書けるが、環境変数が優先する。どちらの値も出力・エラー文に出さない。

|環境変数|内容|
|---|---|
|CHUB_BASE_URL|C-HUB の URL（https:// のみ。例 `https://chub.ailesys.co.jp`）|
|CHUB_TOKEN|`task-manager:read` を付けた API キー。C-HUB の「プラグイン > AI とつなぐ」で申請する。`--once` で相棒に通知するときは `sugar-forum:digest` も付ける。書き込みの権限は付けない|
|AIDEV_CHUB_CONFIG|設定ファイルのパス（`--config FILE` でも指定できる）|

設定ファイル（JSON）の例。リポジトリに置く場合は token を書かない。

```json
{
  "boards": ["tp-1794804787123-7gx3d"],
  "sections": {"ready": "AI実装待ち", "review": "人のレビュー待ち", "needsHuman": "人の確認待ち"},
  "allowedRepositories": ["org/app"],
  "stateDir": "D:/aidev-runner/state"
}
```

boards にはボード（プロジェクト）の ID（`tp-...`、C-HUB の URL の `projectId`）か名前を書く。ID のほうが名前の変更に影響されない。sections を省略すると上の名前を使う。ランナーが読むのは ready だけで、review と needsHuman は通知の「カードを移す先」に使う。stateDir は実行記録を置くランナーのホスト上の絶対パスで、ジョブごとに作り直される作業フォルダの外にする。API の呼び方は C-HUB の公開の API 定義（`https://chub.ailesys.co.jp/openapi.json`）に合わせている。実際の接続は未確認。

### ランナーの dry-run

```powershell
npm run build
node dist/runner.js --dry-run --config runner.json
```

各ボードの「AI実装待ち」のタスクを作成日時の古い順に読み、単一取得した本文で着手条件を判定して JSON を返す。`--dry-run` 以外の起動は受け付けない。

|項目|内容|
|---|---|
|tasks[].eligible / reasons|着手の可否と理由。理由のコードは missing-repository、invalid-repository、repository-not-allowed、missing-base-branch、invalid-base-branch、missing-acceptance、invalid-task-id、section-changed と、`aidev spec check` のエラーに `spec-` を付けたもの（spec-missing-out-of-scope、spec-open-questions など）。「やらないこと」の節も必須になる|
|tasks[].taskName|aidev のタスク名 `<タスクID>-<本文の版>`。版は本文の SHA-256 の先頭8桁で、本文を直すと変わる|
|tasks[].processed|stateDir に同じ版の実行記録があるか。処理済みの版は、カードが AI実装待ちのままでも再実行しない|
|next|次の起動で着手する予定のタスク（着手可能で未処理のうち最古）|
|interrupted|stateDir の実行記録のうち、開始だけで結果の無いもの（前回の実行が中断した）|
|boards|ボードとセクションが見つかったか、件数|

依頼テンプレートの必須項目は「対象リポジトリ」（org/repo）、「基準ブランチ」、「受け入れ条件」（`- AC-001: 説明` の行が1件以上）、「やらないこと」。本文は `aidev spec check` と同じ検査も受けるため、⚠要確認や未解決の「判断待ち」があると着手しない。「参考」は判定に使わない。成功は終了コード 0、設定や通信の失敗は 1。

### ランナーの本体（段階2）

```powershell
node dist/runner.js --once --config runner.json
```

`--once` は1回の起動分の処理を行い、結果を JSON で出す（`src/runner.ts` の `runOnce`）。処理の順番は次のとおり。

1. stateDir の実行記録のうち結果の無いものを「中断」として閉じ、通知する。同じ版は再実行しない
2. 未処理の版のうち着手条件を満たさないものを記録し、足りない項目を通知する
3. 着手可能で未処理の最古の1件について、作業フォルダを用意し、本文を `.aidev/specs/<タスク名>.md` に書いて `aidev workflow run` と同じループを回す。結果（review・needs-human・実行不能）を記録し、PR の URL とカードを移す先を通知する

C-HUB は読むだけで、カードは通知を見た人が移す。通知の本文はテンプレートからだけ作り、AI の出力や指摘の内容は入れない。実行不能のときは止まった段階（workspace・spec・loop・publish）だけを記録する。通知の本文は出力の `notifications` にも出る。

相棒への通知（`src/notify.ts`）:

- 1回の起動の通知を1通にまとめ、キーの持ち主本人の相棒に `POST /api/plugin/sugar-forum/digest` で送る。届くのは本人の相棒だけ
- 1日（日本時間）5通まで。4通目までは結果ごとに送り、5通目に「以降は翌日にまとめる」と添える。それ以降の結果は stateDir の `notify.json` にためて、翌日の最初の起動でまとめて送る（結果が無い起動でも送る）
- 1通は4000字まで。入りきらない通知は次の起動に回す。送れなかった通知も消さずに次の起動で送り直す。送れなくてもランナーは止まらず、出力の notifyError に理由が出る
- 送る形式 `{ content }` は未確認（公開の資料にあるのは隣の窓口 digest/work-status の形だけ）。最初の実際の送信で確かめる。400 が返る場合は形式が違う
- 通知用の通信処理は、この1つの窓口への POST しか送らない。タスクを読む通信処理は GET だけのまま
- 設定の `notify` を false にすると送らない（キーに `sugar-forum:digest` が付くまでの間など）

Gitea Actions で動かすためのワークフローと設定の見本は [examples/runner](examples/runner/README.md) にある。

`--once` に要る設定は、dry-run の設定に次を足したもの。

|設定|内容|
|---|---|
|stateDir|必須。実行記録の場所|
|gitea.baseUrl（または環境変数 GITEA_URL）|Gitea の URL。リポジトリは `<baseUrl>/<org/repo>.git` から取得する|
|GITEA_TOKEN（環境変数だけ）|Gitea の AI 専用アカウントのトークン。対象リポジトリへの書き込み権限だけを付ける。設定ファイルには書かない|
|workDir|作業フォルダの場所（絶対パス）。省略すると `<stateDir>/work`|
|gitea.author|コミットの作者（name・email）。省略すると aidev-runner|
|gitea.noRevocationCheck|true にすると、Windows の git で証明書の失効確認を省く（社内の認証局で失効情報を取れない場合だけ）|
|notify|false にすると相棒に通知しない（既定は通知する）|

Gitea での動き:

- 基準ブランチを浅く取得し、package-lock.json があれば `npm ci --ignore-scripts` を実行する。npm と git には認証情報を外した環境を渡す
- トークンは git コマンドごとの環境変数（`http.extraHeader`）でだけ渡し、作業フォルダの `.git/config` には書かない。資格情報の保存（credential.helper）とリダイレクトの追従は止める
- 作業後の作業フォルダは信用しない。AI やゲートの npm scripts が `.git` を書き換えられるため、コミットと push は取得し直した別のフォルダで行い、ファイルだけを写す（`.git`・`node_modules`・シンボリックリンクは写さない）
- push 先は `aidev/<タスク名>` だけで、強制 push はしない。PR は基準ブランチ向けに作り、needs-human のときは題名に `WIP: ` を付けて引継ぎ票を本文に載せる（引継ぎ票やその親フォルダがリンクになっていれば読まない。作業フォルダの外のファイルを PR に載せないため）。マージはしない
- review の PR には、そのタスクの記録（`.aidev/runs/<タスク名>`・`.aidev/reviews/<タスク名>-N.json`・`.aidev/specs/<タスク名>.md`）を含めない。マージしても基準ブランチに記録がたまらないようにするため。代わりに、各回の結果・確認事項・最後の回の実装の報告を PR の本文に載せる。needs-human の WIP の PR には、引継ぎ票のために記録を含める。基準ブランチにすでにある記録には手を付けない
- 同じ名前の作業ブランチが Gitea にあれば、実行記録が無くても処理済みとみなす
- 対象リポジトリに aidev の Skill（aidev-implementation・aidev-testing・aidev-repair-workflow・aidev-code-review の `.claude/skills/<名前>/SKILL.md`）が無ければ、AI を動かさずに needs-human（skills-missing）にする。実装とレビューの指示がこれらの Skill を前提にしているため。リポジトリで `aidev skill add <名前>` を実行して入れる
- Windows で `.git` と同じ場所を指す名前（`.git.`・`GIT~1` など）は写さない。予約されたデバイス名（NUL・CON・COM1 など）も写さない。ランナーの git は、フックを、ファイルの下でフォルダを作れない場所（`/dev/null`、Windows では `System32\kernel32.dll\nohooks`）に向け、`core.protectNTFS` を有効にする
- ランナーの git は、ユーザーとシステムの git 設定（`~/.gitconfig` など）と、環境変数による git の設定を読まない。プロジェクトのコードが同じユーザーで先に動くため、`url.*.insteadOf` などでトークンの送り先を変えられないようにする。Windows では証明書に Windows の証明書ストア（`http.sslBackend=schannel`）を使う
- 実装が CI の設定（`.gitea`・`.github`・`.forgejo`）を変えていたら push せず、needs-human（ci-config-changed）にする。push したブランチで、リポジトリの secrets を使うワークフローが動くのを防ぐため。実装担当はこれらのファイルを編集できない

### 対話で C-HUB を読む（公式 MCP）

対話用には C-HUB 公式の MCP を使い、自作の MCP サーバーは置かない。ターミナルで次を実行し、ブラウザで許可する。

```powershell
claude mcp add --transport http c-hub https://chub.ailesys.co.jp/api/mcp
claude mcp login c-hub
```

公式 MCP の書き込み系の道具は、権限があれば確認なしで実行される。許可の画面では `task-manager:read` だけを与え、書き込みの権限が付いたキーやトークンを対話に使わない。Claude Code 側でも書き込み系の道具を「常に許可」にしない。キーを使う場合も、コマンドの引数や共有の設定ファイルに書かない。

## QA Skill

テスト戦略・テスト仕様書・仕様書のレビューを支える Skill は `skills/qa/` に置く。aidev-qa-strategy、aidev-qa-test-design、aidev-qa-test-review の3つで、core の Skill と同じく `aidev skill add NAME` で配布する。`skill list` は区分（core / qa）を返す。qa の Skill は `references/*.md` を持てる。`skill update` は複数ファイルの Skill も置き換え、途中で止まった場合は `.aidev/updating/NAME` の印から同じコマンドで再開する。

`aidev init NAME --template qa` は QA リポジトリの雛形（plan/、cases/、runs/、reports/、knowledge/profile.template.md）を作る。製品ごとのプロファイルは `knowledge/<製品>/profile.md` に置き、`aidev qa profile check FILE [--skill NAME]` で検査する。検査するのは形式、Skill ごとの必須項目、秘密情報らしい値で、`*_env` の項目に書く環境変数名と証明書の拇印だけは許可する。qa プロジェクトの `aidev check` は、すべての profile.md に --skill なしの検査（形式・秘密情報・product の有無）を行い、Skill ごとの必須項目は見ない。

設計は [QA Skill 汎用化の設計書](docs/superpowers/specs/2026-11-18-qa-skills-generalization-design.md)、段階1の確認結果は [qa-phase1-verification](docs/qa-phase1-verification.md)、段階2の確認結果は [qa-phase2-verification](docs/qa-phase2-verification.md)、段階3の確認結果は [qa-phase3-verification](docs/qa-phase3-verification.md) にある。

### 段階2で足したもの

段階2では、新しい7つの Skill、比較レポートのコマンド、動作確認用の見本アプリ、QA リポジトリの automation/ を足した。

|Skill|用途|
|---|---|
|aidev-qa-login-session|ロールごとに Playwright でログインし、認証済みのセッション（storageState）を automation/web/.auth/ に作る。SAML・OIDC・フォーム認証を扱い、証明書方式は拇印の確認まで行う|
|aidev-qa-characterization|改修の前に、既存の画面の今の挙動を Playwright の特性テストとして記録する。画面マニフェストで網羅の分母を決め、画面表示・API の応答・帳票の3点を runs/ に残す|
|aidev-qa-test-run|cases/*.md のテストケースを実行し、runs/<YYYYMMDD>-<run-id>/result.md に OK・NG・実行不能で記録する。実行方法は案件プロファイルの test_commands から読む|
|aidev-qa-desktop-gui|Windows のデスクトップアプリを FlaUI（UIA3）で操作するテストを automation/desktop/ に書いて流す。メッセージボックスや保存・印刷のダイアログも扱う|
|aidev-qa-regression-compare|旧版と新版、または設定段階の前後を照合し、差異を「一致／意図した差分／要確認」に分けて runs/<run>/compare.md に残す。顧客向けの横並び HTML は `aidev qa compare-report` で作る|
|aidev-qa-authz-test|ロールと操作の可否、行レベルの所有者の検証を、画面を通さない直接の HTTP リクエストで確かめる。認可の表は automation/web/authz/<機能>.json に置く|
|aidev-qa-screen-verification|改修が終わった画面について、基準の確認、認可の検証、新旧の照合、証跡の確認、画面ごとのまとめを順に回す。各工程の手順は上の Skill に任せる|

共通の決まりは次のとおり。

- 実行する環境と対象は環境変数で渡す。QA_ENV は案件プロファイルの環境名、QA_BASE_URL は対象の URL、QA_RUN_DIR は証跡の出力先の run ディレクトリ。
- 証跡は最終の実行の分だけを残す。複数回の実行を比べるための round1・round2 のようなフォルダは作らない。
- storageState は automation/web/.auth/ に置き、コミットしない。init が作る .gitignore がこのフォルダを除外している。
- 資格情報はプロファイルに書かず、プロファイルにある `*_env` の名前の環境変数から読む。

`aidev init NAME --template qa` は、段階1の雛形に automation/（README.md）と .gitignore を加える。

### 見本アプリで動作を確かめる

templates/qa/samples/ に、Skill の動作確認用の見本アプリを置く。各フォルダの EXPECTED.md は Skill には渡さず、人が結果を答え合わせするために使う。

- web: 貸出の一覧と詳細を持つ Web アプリ。`node templates/qa/samples/web/app/server.mjs --version old --port 4101` で旧版、`--version new` で新版を起動する。`--port` を省略すると旧版は 4101、新版は 4102 を使う。ログインの資格情報は、見本のプロファイル（knowledge/sample-web/profile.md）の user_env・password_env に書かれた環境変数（SAMPLE_STAFF_USER、SAMPLE_STAFF_PASSWORD など）で渡す。
- desktop: 在庫を表示する Windows のデスクトップアプリ。`dotnet build templates/qa/samples/desktop/app` でビルドする。基盤のテストは、Windows で環境変数 `AIDEV_TEST_DESKTOP=1` を設定したときだけこのビルドを確かめ、設定しなければ skip する。

### 段階3で足したもの

段階3では、NG の起票、修正後の確認、原因の調査の3つの Skill と、Gitea に Issue を作るコマンド、確認用の偽の Gitea サーバーを足した。

|Skill|用途|
|---|---|
|aidev-qa-bug-ticket|result.md に記録した NG のケースを Gitea の Issue に起票する。起票の前に、NG が製品の不具合であることを確かめ、同じ原因の NG は1件にまとめる。まず --dry-run で題名と本文を作業者に見せ、了承を得てから送る|
|aidev-qa-fix-verify|直ったという主張（Issue、修正の説明、コミット）を受け、修正コミットを特定して主張をコードで裏取りする。作業用の複製で修正だけを戻し、テストが症状どおりに失敗し、修正の入った版で成功することを確かめて、新しい run の result.md に残す|
|aidev-qa-cause-repro|症状だけがある不具合について、実装のコードを読んで原因を特定し、人が追える再現手順を reports/cause-<Issue番号 または TC-ID>.md に書く。情報が足りないときは、IT に詳しくない人にも答えられる追加の質問の文面を作る|

#### aidev qa issue create

```sh
aidev qa issue create --profile knowledge/<製品>/profile.md --run runs/<YYYYMMDD>-<run-id> --tc TC-001 --dry-run
aidev qa issue create --profile knowledge/<製品>/profile.md --run runs/<YYYYMMDD>-<run-id> --tc TC-001
```

- 送り先は環境変数で渡す。GITEA_TOKEN は作業者個人のトークン（Issue の書き込み権限が要る）、GITEA_URL は Gitea の URL。トークンは出力・エラー文・本文に出さない。AI 専用のアカウントは使わない。
- プロファイルの `issue_tracker`（type は gitea、url、repo は owner/name の形）の接続先（スキーム・ホスト・ポート）が GITEA_URL と一致しなければ、トークンを送らずに止める。url は https:// のみ（http:// は localhost と 127.0.0.1 だけ）。
- --dry-run は何も送らず、何も書かない。送り先と、組み立てた題名と本文を返す。トークンも要らない（GITEA_URL は要る）。
- Gitea の証明書を社内の認証局が出している場合、Node は標準ではその証明書を受け入れず、`Gitea に接続できません（UNABLE_TO_GET_ISSUER_CERT_LOCALLY）` で止まる。このときエラー文に案内が付く。`NODE_OPTIONS=--use-system-ca`（Node 22.15 以上）を設定すると、ブラウザと同じ OS の証明書ストアを使う。証明書の検証を切る設定（`NODE_TLS_REJECT_UNAUTHORIZED=0`）は使わない。
- 題名では、記号 ``@ # ! < > [ ] ( ) \ ` : /`` を全角にする（URL や owner/repo の形を残さないため）。
- 題名と本文は送る前に秘密情報の検査を通す。引っかかると送らずに止まる。
- 本文の1行目の目印（製品と TC-ID）で重複を調べる。重複とみなすのは、トークンの持ち主自身が作った、開いている Issue だけ。閉じた Issue や別のユーザーの Issue は無視して返す。検索は 50 件ずつ、最大 5 ページ（250 件）まで続けて読む。それでも見つからない場合がありうるので、同じ不具合の Issue がないかは Gitea の画面でも確かめる。
- 起票したら、その TC の行の Issue の列に `#番号` だけを書く。result.md の他の部分は変えない。Issue の列にすでに `#番号` があるときは、その番号がトークンの持ち主自身の、目印のある開いた Issue の中にあれば、既存の Issue として返し、何も書かない。見つからなければ書き換えずに止まる。`#番号` 以外が書かれている行も止まる。trace は `#3, #4` のように番号が2つ以上ある Issue の列も読むが、このコマンドはそういう行でも止まるので、2つ目の番号は手で足す。
- Gitea への書き込みは Issue の作成だけで、読むのは `GET /api/v1/user` と Issue の検索だけ。コメント、編集、クローズ、ラベルの付与はしない。

案件プロファイルでは、`aidev qa profile check FILE --skill aidev-qa-bug-ticket` が product と issue_tracker を必須として検査する。

#### ログイン方式 native-form

`login.method` に `native-form` を指定できる。デスクトップアプリ自身のログイン画面（WPF や WinForms）に ID とパスワードを入れる方式で、ブラウザを通らないので storageState は作らない。入力は aidev-qa-desktop-gui が、プロファイルの `*_env` にある環境変数から読んで行う。

### 偽の Gitea サーバーで試す

templates/qa/samples/gitea-fake/ に、Issue の作成と検索（`POST`・`GET /api/v1/repos/:owner/:repo/issues`）、`GET /api/v1/user`（トークンの持ち主の確認）の3つの経路に答え、確認用に `GET /__issues` も返す偽の Gitea サーバーを置く。実際の Gitea には何も送らない。Issue はメモリ上にだけ持つ。利用者のプロジェクトには配らない。

```sh
GITEA_FAKE_TOKEN=確認用の任意の値 node templates/qa/samples/gitea-fake/server.mjs --port 3000
```

`aidev qa issue create` を試すときは、GITEA_TOKEN にサーバーと同じ値を、GITEA_URL に `http://127.0.0.1:3000` を設定し、プロファイルの issue_tracker.url も同じ接続先にする。localhost ではなく 127.0.0.1 を使う（IPv6 に解決される環境では届かない）。--port 0 なら空いているポートを使い、起動時に `listening http://localhost:N` を出す。N を GITEA_URL に使う。

### 段階4で足したもの

段階4では、QA リポジトリのつながりを検査する `aidev qa trace DIR [--html FILE]`（使い方は上の表）と、報告の Skill を足した。

|Skill|用途|
|---|---|
|aidev-qa-report|`aidev qa trace` の JSON から数えた数字で、日次のまとめ（reports/<YYYYMMDD>-daily.md）と品質レポート（reports/quality-<YYYYMMDD>.md）を書く。品質レポートでは plan/strategy.md のリスクの評価と未解決の NG・未確認の Issue を突き合わせる。trace にエラーの指摘があれば先頭に書く。Gitea と C-HUB には書き込まない|

aidev-qa-test-design、aidev-qa-test-run、aidev-qa-bug-ticket、aidev-qa-fix-verify は、成果物を書いた後に `aidev qa trace .` を流して指摘を直す手順になった。

#### aidev qa trace

```sh
aidev qa trace .
cd .. && aidev qa trace qa-<案件> --html qa-<案件>-trace.html
```

- 読むのは `plan/acceptance.md`、`cases/*.md`、`runs/<YYYYMMDD>-<run-id>/result.md` だけで、README.md とコードの囲みの中は読まない。リンクはたどらず、QA リポジトリの外も読まない。Gitea にも C-HUB にも問い合わせない。
- JSON は `ok` のほか、`acs`・`cases`・`runs`（件数）、`runDetails`（run ごとの OK・NG・実行不能の数、表の行 `rows`（TC-ID・結果・Issue 番号だけ）、改修確認の判定）、`coverage`（AC ごとの TC、最新の結果 `latest`、未実行 `notRun`。どちらにもケースの優先度 `priority` と実行の種類 `execution`）、`issues`（Issue ごとの TC と状態）、`findings`（指摘）を持つ。
- run は日付、次に run-id の文字列の順に並べ、後ろの run の行をその TC の最新の結果とする。同じ日に2つ以上の run を作るときは、実行した順に run-id が並ぶよう、日付の後に2桁の連番か開始の時刻（HHMM）を置く（例：`20261119-01-detail`、`20261119-02-fix`）。同じ日の run で、冒頭の実行日時の開始（先頭の `YYYY-MM-DD HH:MM[:SS]`）の順が run-id の順と逆なら `run-order` の警告を出す。開始が読めない run は比べない。
- Issue の列には `#3, #4` のように複数の番号を書けて、trace はどれも読む。`aidev qa issue create` が書き込むのは Issue の列が空の行だけで、番号が2つ以上ある行では止まる。
- Issue の状態は result.md の記録だけで決める。確認済みになるのは、改修確認の run の冒頭に `- 改修確認: #N 確認済み` があるときだけ。その run 自身か後の run でその Issue の TC が NG になれば要確認に戻す。
- 指摘の level が error になるのは、記録が抜けていて数字が信用できないとき（どの TC も参照しない AC、acceptance.md にない AC を参照する TC、Issue のない NG、理由のない実行不能、重複した ID、形が崩れて読み飛ばされた AC の行・ケースの見出し・result.md の表の行、読めないファイル）。error が1つでもあれば終了コードは 1 になる。改修確認や修正コミットの行の形、ケースの AC と実行の行、Issue の列の `#番号` 以外の値、名前が `YYYYMMDD-run-id` でない runs/ の下のフォルダ、同じ日の run の順（run-order）、未実行のケース、未確認の Issue は warning で、終了コードに響かない。
- テストしないと決めた AC は、`plan/acceptance.md` から消さず、ケースも作らない（aidev-qa-test-design の手順と同じ）。trace はその AC に `ac-uncovered` の error を出し続け、終了コードは 1 のままになる。わざとそうしている。消すと AC の記録が失われ、決めたことを記録するだけのケースを作ると未実行の数が水増しされる。テストしない理由は `plan/strategy.md` の対象外の節に AC-ID と一緒に書き、trace の結果を伝えるときは、その AC の `ac-uncovered` が対象外にしたものだと添える。
- HTML は求められたときだけ作る生成物で、報告の正本は reports/*.md（aidev-qa-report）とする。設計書 5.10 では HTML を trace と qa-report で作る想定だったが、HTML は `--html` だけが書き、aidev-qa-report は作業者に求められたときにそれを使う。HTML には TC-ID、結果、Issue 番号、run のディレクトリまでを載せ、result.md の自由記述（実際の結果、証跡の欄）は載せない。外部のファイルやスクリプトを読まない自己完結の1枚で、error があっても書き出す。

## 設計と次の開発
[構成](docs/architecture.md) / [技術選定と調査元](docs/technical-decisions.md) / [実装計画](docs/implementation-plan.md) / [バックログ](docs/initial-backlog.md) / [無人実行ランナーと C-HUB 連携（案）](docs/autonomous-runner-design.md) / [QA Skill 汎用化の設計書](docs/superpowers/specs/2026-11-18-qa-skills-generalization-design.md) / [QA Skill 段階1の確認結果](docs/qa-phase1-verification.md) / [QA Skill 段階2の確認結果](docs/qa-phase2-verification.md) / [QA Skill 段階3の確認結果](docs/qa-phase3-verification.md) / [旧 QA Skill の案件固有の知見の移行メモ](docs/qa-migration-notes/README.md)
