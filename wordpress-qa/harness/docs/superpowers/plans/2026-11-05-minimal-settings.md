# 登録・設定画面の最小化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登録画面と設定画面の初期表示を最低限の項目だけにし、それ以外を閉じた「詳細設定（技術担当向け）」区画へ移す。

**Architecture:** 既存の DOM を作る処理はそのまま使い、作ったあとで最低限の項目以外の要素を1つの `<details id="…-advanced-settings">` に移す。保存処理・API・保存形式は変えない。

**Tech Stack:** vanilla JS（`ui/public/*.js`）、Playwright のブラウザーテスト（`test/*-browser.mjs`）、node:test。

**Spec:** `docs/superpowers/specs/2026-11-05-minimal-settings-design.md`

## Global Constraints

- 残す項目は設計の2章の一覧どおり。それ以外は消さずに閉じた区画へ移す。
- 区画の見出しは「詳細設定（技術担当向け）」、その下に「通常は変更不要です。自動取得と結果画面の『次にやること』で設定されます。」。初期状態は閉じている。
- 保存処理・API・保存形式・送る値は変えない（画面に出していない値も保存時にそのまま送る）。
- `#registration-advanced`（詳細な検査設定を開く）の動きは変えない。
- 既存のブラウザーテストは、閉じた区画を開く手順を足す程度で通すこと。テストの検査内容を弱めない。
- 本番の検索エンジンへの公開の初期値＝チェックありは、新規登録のときだけ。利用者が自分で触ったあとは環境を変えても取り直さない。

## Review Focus

1. 詳細設定に触れずに保存しても、保存済みの値（操作テスト・追加条件・ロール認証・機能検査など）が変わらない。
2. 必須だが隠れた項目（タイムゾーン・言語・ログインパス・管理画面パスの初期値）が、隠れていても送られ、登録が通る。
3. 隠れた区画の中に入力エラーがあるとき、利用者が気づける（区画を自動で開いて該当欄を表示する）。
4. 環境を本番↔検証に切り替えたときの検索エンジンの初期値と、利用者が触ったあとの扱い。
5. 狭い画面（390px）で横にはみ出さない。

---

### Task 1: 登録画面の最小化

**Files:**
- Modify: `ui/public/registration.js`、必要なら `ui/public/style.css`
- Test: `test/registration-minimal-browser.mjs`（新規）、既存の `test/registration-browser.mjs`・`test/registration-validation-browser.mjs`・`test/registration-resume-browser.mjs`・`test/evidence-registration-browser.mjs`・`test/login-feedback-browser.mjs`・`test/automation-inputs.test.mjs`・`test/interaction-profile.test.mjs`（必要な分だけ、区画を開く手順を足す）

**Interfaces:**
- Produces: 登録ダイアログ内の `<details id="registration-advanced-settings">`（初期は閉じている）。最低限の項目以外はこの中にある。
- Produces: `validateInputs()` で隠れた欄にエラーがあれば、区画を開いてその欄を表示する。

- [ ] **Step 1: Write the failing test** `test/registration-minimal-browser.mjs`：登録ダイアログを開いた直後に表示されている入力欄・ボタンが、サイト名・サイトURL・環境・サイト閲覧パスワード・管理画面にログイン・検索エンジンへの公開を期待する・キャンセル・保存（と詳細設定の見出し）だけであること。区画を開くとタイムゾーン・銀行振込・共通の操作テストがあること。環境を本番にすると検索エンジンのチェックが入り、検証に戻すと外れること。利用者がチェックを触ったあとに環境を変えても変わらないこと。区画内のテスト用メールアドレスの形式を誤らせたまま保存すると、区画が開いてエラーが見えること。390px で横にはみ出さないこと。
- [ ] **Step 2: Run** `node test/registration-minimal-browser.mjs` — Expected: FAIL。
- [ ] **Step 3: Implement**。
- [ ] **Step 4: Run** 新しいテストと上記の既存テスト — Expected: PASS。
- [ ] **Step 5: Commit** `feat: 登録画面を最低限の項目にし、残りを詳細設定にまとめる`

### Task 2: 設定画面の最小化

**Files:**
- Modify: `ui/public/settings.js`、必要なら `ui/public/style.css`
- Test: `test/settings-minimal-browser.mjs`（新規）、既存の `test/settings-browser.mjs`・`test/extended-ui.mjs`・`test/login-browser.mjs`・`test/remote-login-browser.mjs`・`test/ai-browser.mjs`・`test/shared-pilot-browser.mjs`（必要な分だけ）

**Interfaces:**
- Consumes: Task 1 と同じ文言・区画の作り方（見た目をそろえる）。
- Produces: 設定ダイアログ内の `<details id="settings-advanced-settings">`（初期は閉じている）。

- [ ] **Step 1: Write the failing test** `test/settings-minimal-browser.mjs`：登録済みサイトの設定を開いた直後に表示されている入力欄・ボタンが、サイト情報（名前・URL・環境）・検索エンジンへの公開を期待する（標準操作テスト登録済みのとき）・閲覧パスワード（新規・削除）・管理画面へのログインの操作・自動取得してClaudeで補完（AI 有効時）・保存・キャンセル（と詳細設定の見出し）だけであること。区画を開くと公開ページの検査・機能・運用の検査・ロール別の認証があること。区画に触れずに保存しても、保存前後で設定（`/settings` の config と profile）が同じであること。390px ではみ出さないこと。
- [ ] **Step 2: Run** `node test/settings-minimal-browser.mjs` — Expected: FAIL。
- [ ] **Step 3: Implement**。
- [ ] **Step 4: Run** 新しいテストと上記の既存テスト、`npm test` — Expected: PASS（既知の時々失敗する site-interaction は単独で再実行）。
- [ ] **Step 5: Commit** `feat: 設定画面を最低限の項目にし、残りを詳細設定にまとめる`
