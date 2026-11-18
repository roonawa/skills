# QA Skill 段階3（不具合系）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NG になったケースから Gitea Issue を起票し、修正後に改修を確かめ、原因と再現手順を特定する3つの Skill と、起票のための `aidev qa issue create` を作る。段階2から持ち越した指摘とネイティブ画面のログイン方式もここで片付ける。

**Architecture:** Gitea への書き込みは `src/gitea.ts` の小さなクライアントに閉じ込め、許すのは Issue の作成と、重複を確かめるための検索だけにする。`aidev qa issue create` は `runs/<run-id>/result.md` の NG の詳細から本文を組み立て、秘密情報の検査を通してから送り、作った Issue の番号を `result.md` の Issue の列に書き戻す。起票先はプロファイルの新しい項目 `issue_tracker` で決める。テストは偽の Gitea（`test/gitea-fake.mjs`、通信なし）で行い、Skill の確認には手元で動く偽の Gitea サーバーを使う。

**Tech Stack:** Node.js 22、strict TypeScript 5.8、`node:test`、yaml 2.9.1（基盤の依存は増やさない）

**Spec:** `docs/superpowers/specs/2026-11-18-qa-skills-generalization-design.md`（段階3は 5.1 の qa-bug-ticket・qa-fix-verify・qa-cause-repro の行、5.4、5.11、6章）

前提：段階2は main に取り込み済み（`70e1af5`）。段階2の確認結果は `docs/qa-phase2-verification.md`。

## Global Constraints

- Node.js 22 以上、strict TypeScript。変更後は `npm test` を通す。CI（ubuntu・windows・macos）で通らないテストを `npm test` に入れない。基盤の依存を増やさない
- Skill の原本を変えたら `metadata.version` を上げ、`npm run build && node scripts/skill-history.mjs` で `skills/history.json` を更新する
- 新しい Skill は `aidev-qa-*`、版は `"0.1.0"` から。`test/qa-skills.test.mjs` の書き方の検査（禁止語を含む）を通す
- Gitea のトークンは作業者個人のもの（環境変数 `GITEA_TOKEN`）。値をログ・出力・Issue の本文・ファイルに書かない。AI 専用アカウントは使わない（設計書 5.11）
- Gitea への書き込みは Issue の作成だけ。コメント・編集・クローズ・ラベル作成・ブランチ操作はしない。実際の Gitea への送信は、作業者が送信先と本文を確かめてから行う
- C-HUB には書き込まない（設計書 2章の目標外）
- 秘密情報と個人情報を Issue に載せない。本文は送る前に秘密情報の検査を通す。個人情報は値を写さず、違いの性質と証跡の場所で書く（段階2の regression-compare と同じ）
- 証跡は最終結果のものだけを残す。データの状態と流し直しの決まりは aidev-qa-test-run の節に従う
- 文章は自然な日本語で書く（yomiyasu の基準）
- このリポジトリ（`~/.claude/skills`、origin は roonawa/skills）では、ブランチを作る前に push を止める（Task 0）

## Review Focus

1. `GITEA_TOKEN` が、エラー・標準出力・Issue の本文・`result.md` のどこにも出ないこと。リダイレクトでトークンを別のホストに送らないこと → Task 2 のテスト `token never leaves the request header` と `refuse redirects`
2. 同じ TC の NG を2回起票しても、Issue が二重にできないこと → Task 3 のテスト `do not create a duplicate issue`
3. 本文に秘密情報らしい値（Cookie、トークン、パスワード）が入っていたら、送らずに止まること → Task 3 のテスト `refuse a body that contains secrets`
4. `--dry-run` では Gitea に何も送らず、`result.md` も書き換えないこと → Task 3 のテスト `dry run sends nothing and writes nothing`
5. `result.md` の書き戻しで、Issue の列以外を変えないこと（他の行・他の列・本文の節）→ Task 3 のテスト `write back only the issue cell`

---

### Task 0: 作業ブランチと push の停止

- [ ] **Step 1:** `git -C C:/Users/roonawa/.claude/skills remote set-url --push origin no_push` の後に `git switch -c feature/qa-skills-phase3`
- [ ] **Step 2:** `npm test` が 174 件合格・1 件省略であることを確かめる

---

### Task 1: 段階2の持ち越しとネイティブ画面のログイン方式

**Files:**
- Modify: `src/qa-profile.ts`（`login.method` に `native-form` を足す）、`src/registry.ts`（版の記録のファイルが見つからないときのエラーに実際のパスを書く）
- Modify: `skills/qa/aidev-qa-desktop-gui/`、`skills/qa/aidev-qa-login-session/`、`skills/qa/aidev-qa-authz-test/SKILL.md`、`skills/qa/aidev-qa-test-run/SKILL.md`
- Modify: `templates/qa/samples/web/knowledge/sample-web/profile.md`、`templates/qa/knowledge/profile.template.md`、`docs/qa-migration-notes/cs-desktop-app.md`
- Test: `test/qa-profile.test.mjs`、`test/registry.test.mjs`

**決めたこと:**
- `login.method: native-form` は「アプリ自身のログイン画面（ネイティブ）に ID とパスワードを入れる方式」。資格情報は `roles[].user_env`・`password_env` の環境変数から、テストのコードが入力する。OS の資格情報の画面・証明書の PIN・Windows のサインインは、これまでどおり作業者が入力する（エージェントもテストのコードも入れない）
- aidev-qa-desktop-gui は `native-form` を扱い、ログイン画面の要素（ID 欄・パスワード欄・ボタン・ログイン後の目印）はプロファイルの本文の「ログイン中の目印」と到達手順から読む。aidev-qa-login-session は `native-form` を desktop-gui に渡す
- 移行メモ cs-desktop-app.md の方式の案を `native-form` に直す
- 段階2の軽微な残り：見本と雛形のプロファイルの `test_commands` を、Skill ごとに絞った書き方（`--project`）にする。authz-test SKILL.md:129 は `authFile(role, process.env.QA_ENV)` を常に使うと書く。test-run の「データの状態と流し直し」の節を手順の外（共通の決まり）に移す

- [ ] **Step 1: 失敗するテストを書く**（`native-form` が通る、未知の方式は拒否される、`AIDEV_HISTORY_FILE` が無いファイルを指すときにエラーにそのパスが出る）
- [ ] **Step 2: 失敗を確かめる**
- [ ] **Step 3: 実装と Skill・文書の修正**（変えた Skill の版を上げ、履歴を更新）
- [ ] **Step 4: `npm test` を通す**
- [ ] **Step 5: コミット**（コードと Skill を分けてよい）

---

### Task 2: Gitea のクライアント

**Files:**
- Create: `src/gitea.ts`、`test/gitea-fake.mjs`、`test/gitea.test.mjs`

**Interfaces:**
- Produces:
  - `interface GiteaRequest { method: 'GET' | 'POST'; url: string; headers: Record<string,string>; body?: string }`、`interface GiteaResponse { status: number; body: string; location?: string }`、`type GiteaTransport = (r: GiteaRequest) => Promise<GiteaResponse>`
  - `fetchGiteaTransport`：`redirect: 'manual'`（3xx は送り直さず失敗にする）、30 秒の時間制限、応答は 2 MiB まで
  - `createGiteaClient({ baseUrl, token, transport? })` は次の2つだけを持つ
    - `findIssues(owner: string, repo: string, query: string): Promise<{ number: number; title: string; html_url: string; state: string }[]>`（`GET /api/v1/repos/{owner}/{repo}/issues?type=issues&state=all&q=...`）
    - `createIssue(owner: string, repo: string, issue: { title: string; body: string }): Promise<{ number: number; html_url: string }>`（`POST /api/v1/repos/{owner}/{repo}/issues`）
  - `class GiteaError extends Error`。エラーの文言にトークンを含めない。401・403・404・422 は日本語の決まった文言にする（chub.ts と同じ形）
- 接続先：`https:` だけを許す。例外は `http://localhost` と `http://127.0.0.1`（偽のサーバー用）
- 認証：ヘッダー `Authorization: token <GITEA_TOKEN>`

- [ ] **Step 1: 失敗するテストを書く**

```js
test('create an issue with the token only in the header', async () => { /* fake が受けた要求の URL・本文にトークンがなく、ヘッダーにだけある */ });
test('token never leaves the request header', async () => { /* 401 のときのエラーにトークンが含まれない */ });
test('refuse redirects', async () => { /* 302 の応答で GiteaError、送り直さない */ });
test('refuse http except localhost', () => { /* http://gitea.example.test は拒否、http://127.0.0.1:3999 は許す */ });
test('find issues by query', async () => { /* q= が URL エンコードされて送られ、配列が返る */ });
test('the client has no other write method', () => { /* Object.keys(client) が findIssues と createIssue だけ */ });
```

- [ ] **Step 2〜5:** 失敗を確かめる → 実装 → `npm test` → コミット

---

### Task 3: `aidev qa issue create` とプロファイルの `issue_tracker`

**Files:**
- Create: `src/qa-issue.ts`、`test/qa-issue.test.mjs`
- Modify: `src/cli.ts`（`qa issue create`）、`src/qa-profile.ts`（`issue_tracker` の形式と `aidev-qa-bug-ticket` の必須項目）、`templates/qa/knowledge/profile.template.md`、`templates/qa/runs/README.md`（Issue の列の書き方）

**Interfaces:**
- CLI：`aidev qa issue create --profile FILE --run RUNDIR --tc TC-ID [--dry-run]`。`RUNDIR` は `runs/<YYYYMMDD>-<run-id>`。環境変数 `GITEA_TOKEN` が要る（`--dry-run` では不要）
- プロファイル：`issue_tracker: {type: gitea, url: https://..., repo: owner/name}`。`profileRequirements['aidev-qa-bug-ticket'] = ['product', 'issue_tracker']`
- `buildIssue(result: string, tc: string, context: { product: string; run: string }): { title: string; body: string }`
  - `result.md` の表で `tc` の行が `NG` であることを確かめる（NG でなければ例外）
  - 本文は `result.md` の NG の詳細の節（aidev-qa-test-run の `references/result-format.md` の形）から、再現手順・期待・実際・再現の回数・証跡の場所・AC-ID を写す。決まった見出しで並べる（テンプレートは `src/qa-issue.ts` に置く）
  - 本文の先頭に、重複を見つけるための目印の行 `<!-- aidev-qa: <product> <TC-ID> -->` を入れる。題名は `[<TC-ID>] <ケース名>`
- `createIssueFromRun(...)`：
  1. `buildIssue` で題名と本文を作る
  2. 本文に `checkProfileText` の秘密情報の検査をかけ、`secret` があれば送らずに止める（どの行かだけを返し、値は返さない）
  3. `findIssues` で目印の行を検索し、同じ TC の Issue があれば作らず、その番号を返す
  4. `--dry-run` でなければ `createIssue` で作る
  5. `result.md` の `tc` の行の Issue の列だけを `#<番号>` に書き換える（一時ファイルに書いてから置き換える）
- 出力：`{"ok":true,"issue":{"number":..,"url":..},"created":true|false,"dryRun":..}`。失敗は `ok:false` と終了コード 1

- [ ] **Step 1: 失敗するテストを書く**

```js
test('build a title and body from the NG detail', () => { /* 再現手順・期待・実際・証跡・AC-ID が入り、目印の行がある */ });
test('refuse a TC that is not NG', () => {});
test('refuse a body that contains secrets', () => { /* NG の詳細に Cookie: sessionid=... を入れると送らずに失敗、出力に値がない */ });
test('do not create a duplicate issue', async () => { /* fake に同じ目印の Issue があれば created:false と既存の番号 */ });
test('dry run sends nothing and writes nothing', async () => { /* fake の calls が 0（GET の検索も含めて0にするかは実装で決め、テストに書く）、result.md が同じ */ });
test('write back only the issue cell', async () => { /* 他の行・他の列・下の節が1文字も変わらない */ });
test('profile check requires issue_tracker for bug-ticket', () => {});
test('reject issue_tracker with http to a non-local host', () => {});
```

- [ ] **Step 2〜5:** 失敗を確かめる → 実装 → `npm test` → コミット

---

### Task 4: 確認用の偽の Gitea サーバー

**Files:**
- Create: `templates/qa/samples/gitea-fake/server.mjs`、`templates/qa/samples/gitea-fake/README.md`
- Test: `test/qa-gitea-fake.test.mjs`

**内容:** 依存のない `node:http` で、`POST /api/v1/repos/:owner/:repo/issues` と `GET /api/v1/repos/:owner/:repo/issues?q=` だけに答える偽のサーバー。`--port N` で起動し、`listening http://localhost:N` を1行出す。トークンは環境変数 `GITEA_FAKE_TOKEN` と照合し、違えば 401。作った Issue はメモリ上に持ち、`GET /__issues`（確認用）で一覧を返す。127.0.0.1 だけで待ち受ける。`templates/qa/files.json` には入れない。

- [ ] テスト（起動・作成・検索・401・確認用の一覧）→ 実装 → `npm test` → コミット

---

### Task 5: aidev-qa-bug-ticket

**Files:** `skills/qa/aidev-qa-bug-ticket/SKILL.md`、`references/issue-template.md`

**内容:** NG になったケースを Gitea Issue にする。入力は `runs/<run-id>/result.md` の NG の行と詳細、`plan/acceptance.md`、`cases/*.md`、プロファイルの `issue_tracker`。手順の要点は次のとおり。
- 起票の前に、NG が本当に製品の不具合か（テストのコードの誤り・データ・環境ではないか）を、aidev-qa-test-run の NG と実行不能の基準で確かめる。迷うものは aidev-qa-cause-repro に回す
- 同じ原因の NG（例：同じ不具合で複数の TC が NG）は1件の Issue にまとめ、残りの TC の行には同じ番号を書く。まとめる判断の基準を書く
- まず `--dry-run` で題名と本文を作り、作業者に送信先と本文を見せて了承を得てから送る
- 個人情報・秘密情報を本文に書かない。証跡はリポジトリの中のパスで示し、画像を Issue に貼らない
- C-HUB への転記はしない（設計書 1章）
- `references/issue-template.md` に本文の節の並びと書き方（再現手順・期待・実際・再現率・影響・AC-ID・TC-ID・run-id・証跡の場所）

- [ ] SKILL.md と references を書く → 履歴を更新 → `npm test` → コミット

---

### Task 6: aidev-qa-fix-verify

**Files:** `skills/qa/aidev-qa-fix-verify/SKILL.md`、`references/revert-check.md`
- 元: `~/.claude/skills/test-verify/`、`~/.claude/skills/uat-verify/`（読むだけ）

**内容:** 修正の主張（Issue、修正の説明、コミットや差分）を受けて、次を行う。
- 修正コミットを特定する。Issue 番号・TC-ID・ブランチから探し、見つからなければ作業者に確かめる
- 実装を読んで、主張が本当にコードに入っているかを裏取りする。主張ごとに独立に確かめる
- NG だった TC のテストを探す（なければ作る）。修正の前（コミットを戻した状態）で失敗し、修正の後で成功することを確かめる。戻す操作は作業用の複製（`git worktree` など）で行い、作業者の作業ツリーを変えない（`references/revert-check.md`）
- 関連する既存のテストへの影響を確かめる（同じ機能の他の TC）
- 結果を新しい run（`runs/<YYYYMMDD>-<run-id>/result.md`）に書き、Issue の列には元の Issue 番号を書く。冒頭に「改修確認: #<番号>、修正コミット <hash>」の行を足す。元の run の `result.md` は書き換えない
- Issue のクローズやコメントはしない（作業者が行う）
- HTML のレポートは作らない（設計書 5.10。求められたときだけ）

- [ ] SKILL.md と references を書く → 履歴を更新 → `npm test` → コミット

---

### Task 7: aidev-qa-cause-repro

**Files:** `skills/qa/aidev-qa-cause-repro/SKILL.md`、`references/customer-questions.md`
- 元: `~/.claude/skills/cause-repro/`（読むだけ）

**内容:** 症状（画面名、対象データ、再現の条件、または NG の行）から、実装コードを読んで原因を特定し、人が追試できる再現手順を書く。原因を一つに絞れないときは、追加で要る情報を、IT に詳しくない人にも伝わる言葉で依頼する文面を作る（`references/customer-questions.md`）。結果は `runs/<run-id>/` ではなく、Issue の本文に足す節の案、または `reports/cause-<TC-ID>.md` に書く（決めて書く）。推測を事実として書かない。原因の確度（確定・有力・候補）を書く。

- [ ] SKILL.md と references を書く → 履歴を更新 → `npm test` → コミット

---

### Task 8: README と移行メモ

**Files:** `README.md`、`docs/qa-migration-notes/README.md`

- [ ] `qa issue create`、`issue_tracker`、`native-form`、偽の Gitea サーバー、3つの Skill を README に足す。移行メモの対応表で、cause-repro・test-verify・uat-verify の行を「予定」から新しい Skill に直す
- [ ] `npm test` → コミット

---

### Task 9: 段階3の完了確認

**Files:** Create: `docs/qa-phase3-verification.md`

段階2と同じく、コントローラが独立したセッションで行い、実装担当には文書だけを任せる。

- [ ] **Step 1: 準備**
  - 見本 Web のアプリを一時ディレクトリの git リポジトリに写し、新版の状態を「不具合あり」のコミットとして記録する
  - 偽の Gitea サーバーを起動する。QA リポジトリのプロファイルに `issue_tracker` を足し、`GITEA_TOKEN` に偽のサーバーのトークンを渡す
- [ ] **Step 2: 起票**
  - aidev-qa-test-run で新版を実行し、NG を出す
  - aidev-qa-bug-ticket で起票する（dry-run → 了承の仮定 → 送信）
  - 期待：CSV の権限の不具合（TC-csv-004/005/006）は1件にまとまる。日付の形式は別の1件になる。`result.md` の Issue の列に番号が入り、2回目の実行で重複しない
- [ ] **Step 3: 原因**：日付の形式の NG を aidev-qa-cause-repro にかけ、原因の箇所（CSV の日付の書式）と再現手順が出るか
- [ ] **Step 4: 修正と改修確認**
  - 写したアプリに、CSV の権限の不具合を直すコミットを足して起動し直す
  - aidev-qa-fix-verify で改修確認する
  - 期待：修正の前で失敗し、修正の後で成功する。日付の形式の NG は残る（関係のない不具合として報告される）。新しい run の冒頭に Issue 番号と修正コミットがある
- [ ] **Step 5: ID のつながり**：AC-015 → TC-csv-004/005/006 → NG の run → Issue #N → 修正コミット → 改修確認の run が、ファイルをたどってつながることを確かめる
- [ ] **Step 6:** 結果を `docs/qa-phase3-verification.md` に書き、`npm test` を通してコミットする。ブランチの内容と確認結果を利用者に報告する。push の再開と main への取り込みは利用者の指示を受けてから行う
