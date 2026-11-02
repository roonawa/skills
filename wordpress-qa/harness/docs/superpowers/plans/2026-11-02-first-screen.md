# 結果画面の「次にやること」整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 結果画面を「件数カード → 次にやること（その場で入力・保存・増えた検査だけ実行）→ 分かったこと → まだ確認していないもの」に整理する。あわせて、このサイトに関係しない検査を、根拠付きで自動的に「対象外」にする。

**Architecture:**
- 振り分けは新しいモジュール `ui/todo-triage.mjs` の純粋関数で行う。
- 自動の対象外は、保存時に `ProjectStore.save` が config の `autoNotApplicable` に書き込む。`lib/config.mjs` の `catalog` が、それを理由付きの `not_applicable` 行に変える。
- 結果画面は、新しい読み取りAPI `GET /api/projects/:id/todo` の結果を描画し、既存の設定保存APIで入力を保存する。そのうえで、拡張した実行API（`ids` 指定）で増えた検査だけを実行する。

**Tech Stack:** Node.js 22（ESM）、`node:test`、Playwright（ブラウザーテスト）。

**Spec:** `docs/superpowers/specs/2026-11-02-first-screen-design.md`（承認済み）

## Global Constraints

- 画面の順序は、件数カード（不合格・注意・合格・やること。実行不能・未確認は下に小さく）→ 次にやること → 分かったこと（不合格 → 注意。合格は折りたたみ）→ まだ確認していないもの（折りたたみ・3区分）とする。
- 次にやることの項目は、次の4つだけ。
  - テスト投稿の許可（`profile.writes`、検証・ローカルのみ）
  - フォーム送信の許可＋テスト用メールアドレス（`profile.submit`＋`profile.testEmail`。検証・ローカルで、フォームを検出済みの場合）
  - 表示上限（`profile.performanceMs`。画面では秒）
  - 機密ファイル確認の許可（`sensitivePaths`。`auto-security-exposure` が設定が必要のとき）
- 各項目が動かす検査は、次の対応表で決める。
  - writes → `coverage-publishing`・`coverage-cache`・`coverage-scheduled`
  - submit → `coverage-contact-success`
  - performance → `coverage-performance`
  - sensitivePaths → `auto-security-exposure`
- 「重要」の点滅は、次にやることの項目だけに付ける。
- 自動の対象外は、`profile.automation.pluginInventory.observed===true` のときだけ判定する。
  - 判定する範囲は、注文4件（`coverage-order`・`order-record`・`order-cleanup`・`order-notification`）と、会員（`coverage-membership`）。
  - 本番環境の投稿・キャッシュ・予約・フォーム送信は、プラグイン一覧の取得に関係なく常に対象外にする。
  - 多言語は判定しない。
- 自動の対象外の行には `status:'not_applicable'`、`autoNotApplicable:true`、根拠を書いた `reason` を付ける。既存の `releaseGate` は変えない。
- 「関係ありに戻す」の選択は `profile.automation.relevantOverrides`（検査IDの配列）に保存する。本番環境の投稿・送信の4件は戻せない。
- 保存は既存の `POST /api/projects/:id/settings`（`profile`・`sensitivePaths`・`version`）を使う。`validateProfile` と許可の決め方（`allowSensitivePaths` の規則）は変えない。
- 画面に出す文言に、`browser-flow`・`waitForMail`・`adminに登録`・`信頼済みアダプター`・`additionalChecks` を含めない。
- コードはこのリポジトリの書き方に合わせる（1行に詰めた式、日本語、コメントは少なめ）。
- 作業ブランチは `feature/first-screen`。作業中は `git remote set-url --push origin no_push` で自動 push を防ぎ、終わったら元に戻す。

## Review Focus

1. **管理画面にログインせずに登録したサイト**：プラグイン一覧を取得できないので、注文と会員を対象外にしない。→ Task 2 のテスト
2. **通販プラグインがあるのに一覧が途中までしか取れないサイト**：プラグイン一覧が複数ページに分かれる場合、取得が不完全なら `observed:false` にする。→ Task 1 のテスト
3. **すでに許可済みのサイト**：`writes` が true なら、投稿の項目を「次にやること」に出さない。→ Task 2 のテスト
4. **保存の競合**：別の画面で設定が変わっていたら（バージョンの不一致）、その場の保存は失敗し、画面に再読み込みを促す。→ Task 5 のテスト
5. **「関係ありに戻す」を押したあと**：次の実行で、その検査は元の「設定が必要」に戻り、必須条件は「未達」に戻る。→ Task 3 のテスト

---

### Task 1: プラグイン一覧の取得結果を記録する

**Files:**
- Modify: `ui/automation-discovery.mjs`（`out.pluginInventory={observed,slugs}` を追加する。plugins.php の取得が 200 で、一覧が読めたときだけ `observed:true`。ページ送りがあって全ページを読めなかった場合は `false`）
- Modify: `ui/public/automation-inputs.js`（`validateAutomationInput` で `pluginInventory`（`{observed:boolean, slugs:string[]≤200}`）と `relevantOverrides`（`/^[a-z][a-z0-9-]{0,63}$/` の配列、100件以内）を受け付ける）
- Modify: `ui/automation-plan.mjs`（`resolveAutomationProfile` で `discovery.automation.pluginInventory` を `p.automation.pluginInventory` に写す。既存の `relevantOverrides` は残す）
- Test: `test/automation-discovery.test.mjs`、`test/automation-inputs.test.mjs`

**Interfaces:**
- Produces: `profile.automation.pluginInventory = {observed:boolean, slugs:string[]}`、`profile.automation.relevantOverrides = string[]`

- [ ] **Step 1: 失敗するテストを書く**
  - `plugin inventory observed only when plugins page read`：認証済みで plugins.php が 200 なら `{observed:true,slugs:['fixture']}`。未認証または 403 なら `{observed:false,slugs:[]}`。
  - `paginated plugin list not fully read is not observed`
  - `automation input accepts pluginInventory and relevantOverrides, rejects bad shapes`
  - `resolveAutomationProfile copies pluginInventory and keeps relevantOverrides`
- [ ] **Step 2: 失敗を確認する**
  - Run: `node --test test/automation-discovery.test.mjs test/automation-inputs.test.mjs`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確認する**
  - Run: 同じコマンドと `npm test`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 有効プラグインの取得結果と関係ありの選択を登録条件に記録"`

### Task 2: 振り分けの純粋関数

**Files:**
- Create: `ui/todo-triage.mjs`
- Test: `test/todo-triage.test.mjs`

**Interfaces:**
- Consumes: `unresolvedPreparation(config,profile)`（`ui/evidence-preparation.mjs`。category を持つ）、`catalog`（`lib/config.mjs`）。
- Produces:
  - `export const ITEM_CHECKS={writes:['coverage-publishing','coverage-cache','coverage-scheduled'],submit:['coverage-contact-success'],performance:['coverage-performance'],sensitivePaths:['auto-security-exposure']}`
  - `export const COMMERCE_PLUGINS`、`export const MEMBERSHIP_PLUGINS`（スラッグの配列。通販は少なくとも `usc-e-shop`・`woocommerce` を含める。中身は実装者が決める）
  - `notApplicableChecks(config, profile) -> Record<checkId, reason>`
    - 本番環境：投稿・キャッシュ・予約・フォーム送信 → 「本番環境ではテスト投稿・フォーム送信を実行しないため対象外」。
    - `pluginInventory.observed===true` かつ通販プラグインなし → 注文4件を「有効なプラグインに通販機能が見つからないため対象外（登録時の取得）」。
    - 会員プラグインなし → 会員を同じ形の理由で対象外。
    - `relevantOverrides` にある検査IDは除外する。ただし本番環境の4件は除外しない。
  - `triage(config, profile) -> {todo:TodoItem[], toolGap:Row[], technical:Row[], notRelevant:Row[]}`
    - `TodoItem = {key:'writes'|'submit'|'performance'|'sensitivePaths', label, effect, checkIds:string[], count:number, input:{type:'checkbox'|'email+checkbox'|'seconds', current?}}`
    - `Row = {id, title, message, reason?, revertible?:boolean}`
    - 項目が出る条件は Global Constraints のとおり。`count` は、`checkIds` のうち現在「設定が必要」の件数。0件の項目は出さない。
    - toolGap は category `discovery`。technical は `integration`・`credentials`・`implementation`・`mixed` と、`analytics`・注文（通販がある場合）・フォームが見つからないときの送信。notRelevant は `notApplicableChecks` の結果。
    - `message` は画面用の平易な文言。Global Constraints の禁止語を含めない。
  - `plainMessage(checkId, category) -> string`（画面用の文言を1か所にまとめる）

- [ ] **Step 1: 失敗するテストを書く**（設定は登録テストのデータ `.selftest` を使わず、テスト内で config と profile を作る）
  - `staging site without commerce or membership plugins`：todo の key が `['writes','submit','performance']`（フォーム検出済み、sensitivePaths は許可済み）。notRelevant に注文4件と会員がある。
  - `production site`：todo に writes・submit がない。notRelevant に投稿・キャッシュ・予約・送信の4件が `revertible:false` で入る。sensitivePaths が未許可なら todo に `sensitivePaths` がある。
  - `inventory not observed`：注文・会員は notRelevant ではなく technical に入る。
  - `writes already allowed hides writes item`
  - `relevantOverrides puts order back into technical and keeps production four non-revertible`
  - `no form detected moves contact-success to technical`
  - `plain messages contain no developer terms`：todo・toolGap・technical・notRelevant のすべての文言が `/browser-flow|waitForMail|adminに登録|信頼済みアダプター|additionalChecks/` に一致しない。
- [ ] **Step 2: 失敗を確認する**
  - Run: `node --test test/todo-triage.test.mjs`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確認する**
  - Run: `node --test test/todo-triage.test.mjs`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 設定が必要の振り分けと次にやることの算出"`

### Task 3: 自動の対象外を結果データに反映する

**Files:**
- Modify: `ui/project-store.mjs`（`save` の最後で `config.autoNotApplicable=notApplicableChecks(config,profile)` を設定する。profile がなければ `{}`）
- Modify: `lib/config.mjs`
  - `validateConfig` の許可キーに `autoNotApplicable` を加え、検査IDから文字列（500文字以内）への対応表として検証する。
  - `catalog` で、該当する `check.*` 行を `{status:'not_applicable',autoNotApplicable:true,selected:false,reason}` にする。`preparationRequired` は付けない。
- Modify: `lib/results.mjs`（必要な場合のみ。`releaseGate` の規則は変えない）
- Modify: `ui/public/app.js`、`lib/issue-report.mjs`（対象外の行に「自動判定」と表示する）
- Test: `test/auto-not-applicable.test.mjs`（新規）

**Interfaces:**
- Consumes: Task 2 の `notApplicableChecks`。
- Produces: config `autoNotApplicable: Record<checkId, reason>`、行 `autoNotApplicable:true`

- [ ] **Step 1: 失敗するテストを書く**
  - `store.save writes autoNotApplicable for staging site without commerce plugins`
  - `catalog turns autoNotApplicable checks into reasoned not_applicable rows that are not selected`
  - `releaseGate passes when only auto not_applicable rows remain besides passes`：そのほかの行がすべて合格なら `releaseGate` は true。
  - `relevant override restores preparationRequired and gate fails again`（Review Focus 5）
  - `results.json rows keep not_applicable after a run`：既存の実行経路（`lib/reporter.mjs` の行の更新）で状態が上書きされないこと。
  - `issue report shows 自動判定 for auto not_applicable rows`
- [ ] **Step 2: 失敗を確認する**
  - Run: `node --test test/auto-not-applicable.test.mjs`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確認する**
  - Run: `node --test test/auto-not-applicable.test.mjs` と `npm test`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 関係しない検査を根拠付きの自動対象外にする"`

### Task 4: 「次にやること」API と、指定した検査だけの実行

**Files:**
- Modify: `ui/server.mjs`
  - `GET /api/projects/:id/todo` を追加する。UIで管理しているサイトだけが対象で、外部JSONのサイトは `{managed:false}` を返す。
  - 既存の `POST /api/projects/:id/runs` に、任意の `ids:string[]`（行ID、50件以内）を受け付けるようにする。
- Modify: `bin/qa.mjs` と、実行時の行選択処理（必要な場合。`--id` を複数受け付けるか、選択リストを渡す仕組みを実装者が決める）
- Test: `test/todo-api.test.mjs`（新規。既存の `test/automatic-run-api.test.mjs` と同じようにサーバーを起動する）

**Interfaces:**
- Consumes: Task 2 の `triage`。
- Produces:
  - `GET /api/projects/:id/todo` → `{managed:true, environment, version, todo:TodoItem[], toolGap:Row[], technical:Row[], notRelevant:Row[]}`。`version` は設定保存の競合確認に使う。
  - `POST /api/projects/:id/runs` の body に `{suite:'all', ids:[...]}` を受け付ける。`ids` にある行だけを選んで実行する。存在しない行、「設定が必要」の行、対象外の行を含む場合は 400 にする。

- [ ] **Step 1: 失敗するテストを書く**
  - `todo api returns triage for managed site and managed:false for external`
  - `runs with ids executes only those rows`：結果の `selected` が指定した行だけになっている。
  - `runs with ids rejects preparation, not_applicable and unknown rows`
  - `todo api requires the same auth as other project GETs`
- [ ] **Step 2: 失敗を確認する**
  - Run: `node --test test/todo-api.test.mjs`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確認する**
  - Run: `node --test test/todo-api.test.mjs` と `npm test`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 次にやることAPIと指定した検査だけの実行"`

### Task 5: 結果画面（B案）

**Files:**
- Modify: `ui/public/app.js`、`ui/public/index.html`、`ui/public/style.css`
- Test: `test/first-screen-browser.mjs`（新規）と `package.json` の `"test:first-screen-ui"`、および既存の `test/ui-browser.mjs` の期待値の更新

**Interfaces:**
- Consumes: Task 4 の API。保存には既存の `POST /api/projects/:id/settings` を使う（body は `{version, config, profile, sensitivePaths}`。既存の設定画面と同じ組み立て方にする）。

**画面の要件**
- 件数カードは「不合格（`fail−caution`）・注意・合格・やること（`todo.length`）」の4つ。カードの下に「実行不能 n・未確認 n」を小さく書く。
- 次にやることの見出しは「あと n つ設定すると、さらに m 件を検査できます」（m は各項目の `count` の合計）。項目が0件なら「やることはありません」。
- 各項目の説明文は、仕様書4章とモックアップのとおりにする。
  - テスト投稿：「QA」で始まるテスト投稿を作り、確認後に削除する。
  - フォーム：通知先にもメールが届く。
  - 表示上限：今回の実測値を参考として出し、顧客と合意した値を入れるよう書く。
  - 機密ファイル：顧客の監視に検知される場合がある。
- ボタンは「保存して、増えたm件だけ実行」と「保存だけする」の2つ。入力した項目だけを保存する。保存後に `todo` を取り直し、保存前の項目の `checkIds` のうち「設定が必要」から外れた `check.*` 行を `ids` にして実行する。
- バージョンの競合（409）が起きたら、「別の画面で設定が更新されました。再読み込みしてください」と表示し、入力は残す。
- 「分かったこと」は既存の「不合格の理由・対応方法」のまとめを使い、合格は折りたたむ。
- 「まだ確認していないもの（あなたの作業ではありません）」は折りたたみにし、3区分を見出しで分ける。notRelevant には根拠と「関係ありに戻す」ボタンを出す（`revertible:false` の行には出さない）。押すと `relevantOverrides` に加えて保存する。
- 実行中は入力とボタンを無効にする。
- 既存のグループ表示・詳細パネル・絞り込みは、この下に残す。
- 動的な文字列はすべて既存の `escape()` を通す。

- [ ] **Step 1: 失敗するテストを書く**（`test/first-screen-browser.mjs`。検証環境・フォームあり・通販プラグインなしのテスト用サイトを登録して実行する）
  - 上から件数カード・次にやること・分かったこと・未確認が並ぶ。
  - 次にやることが3件で、見出しの件数が正しい。点滅しているのは次にやることの項目だけ。
  - 投稿の許可にチェックを入れて「保存して、増えた3件だけ実行」を押すと、実行結果の選択行が投稿関連の3件だけになる。
  - 未確認に通販4件と会員があり、「関係ありに戻す」を押すと technical 側に移る。
  - 別の画面で保存したあとにこの画面で保存すると、再読み込みを促す表示が出て、入力が残る（Review Focus 4）。
  - 画面のどこにも開発者向けの禁止語が出ない。
- [ ] **Step 2: 失敗を確認する**
  - Run: `npm run test:first-screen-ui`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確認する**
  - Run: `npm run test:first-screen-ui`、`npm run test:ui`、`npm run test:registration`、`npm run test:settings`、`npm run test:handoff-ui`、`npm test`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 結果画面を件数・次にやること・分かったこと・未確認の順に整理"`

### Task 6: 文書の更新と全体の検証

**Files:**
- Modify: `deploy/internal-announcement/SITE-EXAM-specification.md`
  - 5章の操作の流れに「次にやること」を追加する。
  - 7章に自動判定の対象外を追加する。
  - 12章の「設定が必要が多い」の行を更新する。
  - 付録Cのハッシュを、コミット済み（LF）の内容から計算し直す。
- Modify: `deploy/user-manual.html`（1行のHTMLなので、該当部分だけを書き換える）
- Modify: `docs/superpowers/specs/2026-11-02-first-screen-design.md`（状態を「実装済み」にする）

- [ ] **Step 1: 文書を更新する**
- [ ] **Step 2: 全体を検証する**
  - Run: `npm test`、`npm run test:ui`、`npm run test:registration`、`npm run test:settings`、`npm run test:site-exam-ui`、`npm run test:handoff-ui`、`npm run test:first-screen-ui`
  - Expected: すべて PASS
- [ ] **Step 3: デモで確かめる**
  - デモ用サイトを登録 → 実行 → 結果画面で投稿の許可を入れる → 増えた検査だけ実行、を通しで行い、画面を目で確認する。
- [ ] **Step 4: コミットする**
  - `git commit -m "docs: 結果画面の整理と自動対象外を仕様書・マニュアルに反映"`
