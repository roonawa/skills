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
|init NAME [--template core/react/unity]|親ディレクトリ。子に共通設定と選択したテンプレートを配置。既定は core|
|skill list / skill validate NAME|任意の場所。同梱原本の名前・説明・版を取得|
|skill add NAME|プロジェクト直下。両ホストの Skill と .aidev/installed の版記録を作成|
|doctor|プロジェクト直下。Node、OS、設定版、Registry 件数を取得|
|verify|プロジェクト直下。登録した Skill の欠損・内容差・版差を検出。未登録なら空配列|
|check|プロジェクト直下。aidev.json の template に対応するアプリの検査結果を JSON で返す|
|workflow check TASK --review FILE|一つの実装タスクに対し、単体テスト・セキュリティ・仕様乖離と過剰実装のゲート結果と修正回数を記録して次の作業を決める|
|workflow status TASK|保存された直近の判定を表示する。検査実行や試行回数の加算は行わない|

すべて JSON を標準出力に返す。成功は終了コード 0、失敗は 1。check は失敗がなくても実行不能の項目がある場合に 2 を返す。init と add は末尾に --dry-run を付けると変更予定を返す。再実行で同じファイルはスキップする。既存内容と異なる場合は処理を止める。メタデータ検証は社内の単一 Markdown 配布形式に限定する。

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

初回の検査は修正0回。ゲートを通過しなければ実装へ差し戻し、人の確認なしで最大3回まで修正する。同じ失敗の再発は3回を待たずに止め、別の原因で失敗が続く場合は3回目の修正後に止める。実行不能と保護対象の変更でも止まる。止まると state は needs-human となり、試行ごとのゲート結果と指摘を並べた引継ぎ票を書く。引継ぎ票が既にある場合は上書きしない。同じ失敗の判定は、アプリの検査は検査項目とエラー署名、レビューは指摘の種類・ref・file の組で行い、summary の文言は使わない。review と needs-human に達した識別名を再指定すると記録済みの結果を返す。新規タスクには新しい識別名を使う。コードの編集と承認はホストと担当者が行う。CLI は同じタスクの検査履歴と停止条件を管理する。

履歴は `.aidev/runs/TASK/` に保存する。同じ試行を二重実行しないよう、各回の開始時に番号を予約し、完了後に結果を確定する。実行中または保存前の中断を検出した場合は、記録を保持してプロセスの状態を確認する。React の失敗判定には、ログの先頭と末尾から時刻や一時パスなどの変動部分を正規化して得たハッシュを使う。長大な出力の中央にしか現れない差異は識別できないことがある。

初回に見つかったテストファイルが消えた場合、または保護対象の検査スクリプトやセキュリティ設定が変わった場合は、人の確認へ引き継ぐ。型検査・Lint・テストランナーの設定（tsconfig*.json、biome.json、ESLint、vite/vitest/jest/playwright の設定、.editorconfig、Directory.Build.props、*.ruleset、.c8rc・.nycrc、package.json の eslintConfig・jest・mocha・c8・nyc）は、初回からの内容変更に加えて、2回目以降に新たに追加された場合も停止する。アプリの機能のために vite.config などを変える場合も停止するので、担当者が差分を確認して新しいタスク名で再開する。追加判定は、この版以降に開始したタスクに適用する。テストの追加や本文の編集は可能で、skip や期待値の緩和、仕様への適合性は aidev-code-review の観点で差分レビューが判断する。履歴はローカル作業の引き継ぎ用であり、作業者自身による改変を防ぐ監査台帳としては扱えない。

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

## 設計と次の開発
[構成](docs/architecture.md) / [技術選定と調査元](docs/technical-decisions.md) / [実装計画](docs/implementation-plan.md) / [バックログ](docs/initial-backlog.md)
