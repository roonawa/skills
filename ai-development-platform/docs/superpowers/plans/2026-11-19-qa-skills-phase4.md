# QA Skill 段階4（レポートとトレース）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** QA リポジトリの AC → TC → 実行結果 → Issue → 改修確認のつながりを機械で検査する `aidev qa trace`（HTML を含む）と、日次のまとめと品質レポートを作る aidev-qa-report を作り、段階1〜3の残りを片付ける。

**Architecture:** 読み取りは `src/qa-trace-parse.ts` に集め、QA リポジトリの Markdown（acceptance.md、cases/*.md、runs/*/result.md）を構造に変える。検査は `src/qa-trace.ts` が行い、結果を JSON で返す。HTML は `templates/qa-report/trace.html` を雛形にして、依存なしで作る。aidev-qa-report はこの JSON を入力にして Markdown のレポートを書く Skill で、外部のサービスには書き込まない。

**Tech Stack:** Node.js 22、strict TypeScript 5.8、`node:test`、yaml 2.9.1（基盤の依存は増やさない）

**Spec:** `docs/superpowers/specs/2026-11-18-qa-skills-generalization-design.md`（段階4は 5.1 の qa-report の行、5.4、5.5、6章）

**前提:** 段階3の PR（roonawa/skills#2）が main に取り込まれてから始める。取り込み前なら、Task 0 で `feature/qa-skills-phase3` を基にする。

## Global Constraints

- Node.js 22 以上、strict TypeScript。`npm test` を通す。CI（ubuntu・windows・macos）で通らないテストを入れない。基盤の依存を増やさない
- Skill の原本を変えたら `metadata.version` を上げ、`npm run build && node scripts/skill-history.mjs` で `skills/history.json` を更新する。新しい Skill は `aidev-qa-*`、版は `"0.1.0"` から。`test/qa-skills.test.mjs` の書き方の検査を通す
- `aidev qa trace` は読むだけで、QA リポジトリにも外部のサービスにも書き込まない（`--html` の出力ファイルだけを書く）。Gitea にも C-HUB にも問い合わせない（設計書 5.5）
- パスは `files.ts` の `checked` を通し、QA リポジトリの外を読まない。リンクをたどらない。1ファイル 1 MiB までの既存の上限を使う
- HTML に入れる文字列はすべてエスケープする。外部のファイルやスクリプトを読み込まない、自己完結の HTML にする
- 個人情報と秘密情報を HTML や JSON に写さない。結果の詳細（実際の結果など）は HTML に入れず、TC-ID・結果・Issue 番号・証跡のパスまでにする
- 文章は自然な日本語で書く（yomiyasu の基準）
- このリポジトリでは、ブランチを作る前に push を止める（Task 0）

## 段階1〜3で決めた trace の受け入れ条件（必ず満たす）

- `README.md` と、コードの囲み（``` と ~~~）の中は読まない（段階1の裁定）
- `runs/` の直下のファイル（`<run>.compare.json` など）は読み飛ばし、ディレクトリだけを run として扱う（段階2の裁定 J）
- `result.md` の冒頭には、環境・版・実行日時のほかに行が足されていることがある（「結果の決め方」「改修確認」「修正コミット」「元の run」など）。知らない行は無視する
- Issue を「確認済み」とするのは、改修確認の run の冒頭に `- 改修確認: #<N> 確認済み` があるときだけ。`要確認（…）` と `効いていない` は確認済みにしない（段階3の裁定 K）
- AC の出どころには `推定仕様 RS-xxx` もある（段階1）
- 同じ原因でまとめた NG は、複数の TC の行に同じ `#N` が書かれる（段階3）
- 手動のケースは `実行不能` で、理由が「手動確認待ち」（段階2の裁定 G）

## Review Focus

1. 囲みの中や README.md に書かれた `### TC-…` や `- AC-001:` を、本物の TC や AC として数えないこと → Task 2 のテスト `ignore fenced blocks and READMEs`
2. 改修確認の run の冒頭が `要確認（…）` や `効いていない` の Issue を「確認済み」にしないこと → Task 3 のテスト `only 確認済み confirms an issue`
3. 同じ TC が複数の run にあるとき、最新の run（ディレクトリ名の日付と run-id の順）の結果で判定すること → Task 3 のテスト `latest run wins`
4. `--html` の出力に、result.md の自由文（実際の結果など）が入らず、TC 名やケース名はエスケープされること → Task 4 のテスト `html escapes and omits free text`
5. 1行がとても長い Markdown や、大量のケースでも、検査が数秒で終わること → Task 2 のテスト `large repository stays fast`

---

### Task 0: 作業ブランチと push の停止

- [ ] **Step 1:** `git -C C:/Users/roonawa/.claude/skills remote set-url --push origin no_push`、`git switch main && git pull --ff-only`（PR #2 が取り込み済みのとき）、`git switch -c feature/qa-skills-phase4`
- [ ] **Step 2:** `npm test` が全件合格（Windows 限定の1件は省略）であることを確かめる

---

### Task 1: 段階3の残り

**Files:** `src/qa-profile.ts`、`src/qa-issue.ts`、`src/gitea.ts`、`templates/qa/samples/gitea-fake/server.mjs`、`docs/qa-phase3-verification.md` と各テスト

- `login.method: native-form` のとき `roles` を必須にする（`--skill` の有無にかかわらず）
- `findIssues` を、最大5ページ（250件）まで続けて読むようにする（重複の見落としを減らす）。それでも見つからない可能性は README と aidev-qa-bug-ticket に残す（Skill の版を上げる）
- 起票の題名から、制御文字と双方向制御文字（U+202A〜U+202E、U+2066〜U+2069 など）を取り除く
- 同じ TC の `### TC-…` の節が2つあれば、はっきりしたエラーで止める
- 秘密情報の検査で見つかった位置を、本文の行番号ではなく「どの欄か」（再現手順・実際の結果など）で示す
- `findIssues` の `query` が文字列でなければ止める
- 偽の Gitea：大きすぎる本文には 413 を返す。要求の途中で切れたときに待ち続けない
- docs/qa-phase3-verification.md：W10 を「段階4に回したもの」から「閉じたもの」に移す

- [ ] 失敗するテストを先に書く → 実装 → `npm test` → コミット

---

### Task 2: QA リポジトリの読み取り（`src/qa-trace-parse.ts`）

**Interfaces:**
- `interface AcceptanceItem { id: string; text: string; source?: string; line: number }`
- `interface CaseItem { id: string; name: string; feature: string; file: string; acs: string[]; priority?: string; execution?: '自動' | '手動'; line: number }`
- `interface RunRow { tc: string; result: 'OK' | 'NG' | '実行不能'; evidence?: string; issues: number[]; reason?: string }`
- `interface RunRecord { dir: string; date: string; runId: string; environment?: string; version?: string; executedAt?: string; fixChecks: { issue: number; verdict: '確認済み' | '要確認' | '効いていない'; note?: string; commit?: string }[]; origin?: string; rows: RunRow[] }`
- `interface QaRepository { acceptance: AcceptanceItem[]; cases: CaseItem[]; runs: RunRecord[]; problems: { code: string; file: string; line?: number; message: string }[] }`
- `readQaRepository(root: string): QaRepository`

**読み方:**
- `plan/acceptance.md`：`- AC-<数字>: <本文>（出どころ: …）`。コードの囲みの中は読まない
- `cases/*.md`（`README.md` を除く）：見出し `### TC-<機能>-<連番> <名前>` と、その下の `- AC:`・`- 優先度:`・`- 実行:`。囲みの中は読まない
- `runs/<YYYYMMDD>-<run-id>/result.md`：冒頭の `- 環境:`・`- 版:`・`- 実行日時:`・`- 改修確認: #N <判定>`・`- 修正コミット（#N）:`・`- 元の run:`、表 `| TC-ID | 結果 | 証跡 | Issue |`（Issue の列は `#N` を複数持てる）。実行不能の理由は、表の下の詳細の節から読む（形は aidev-qa-test-run の `references/result-format.md`）
- 形がおかしい行は飛ばさず `problems` に入れる（どのファイルの何行目か）

- [ ] 失敗するテストを先に書く（`test/fixtures/qa-repo/` に小さな QA リポジトリを置く）
  - `ignore fenced blocks and READMEs`、`skip files directly under runs`、`tolerate unknown header lines`、`read fix-check verdicts and paired commits`、`read multiple issue numbers in one cell`、`report malformed lines as problems`、`large repository stays fast`（ケース 5,000 件と 1 MiB 近い result.md で 3 秒以内）
- [ ] 実装 → `npm test` → コミット

---

### Task 3: 検査と CLI（`src/qa-trace.ts`、`aidev qa trace DIR [--html FILE]`）

**Interfaces:**
- `interface TraceFinding { level: 'error' | 'warning'; code: string; message: string; ac?: string; tc?: string; issue?: number; file?: string; line?: number }`
- `interface TraceReport { acs: number; cases: number; runs: number; coverage: { ac: string; cases: string[]; latest: { tc: string; result: string; run: string; issues: number[] }[] }[]; issues: { number: number; tcs: string[]; status: '確認済み' | '未確認' | '効いていない' | '要確認'; fixRun?: string }[]; findings: TraceFinding[] }`
- `traceQaRepository(root: string): TraceReport`
- CLI：`{"ok": <error が0件>, ...report}`。error があれば終了コード 1

**検査:**
- error `ac-uncovered`：どの TC からも参照されない AC
- error `tc-unknown-ac`：存在しない AC-ID を参照する TC
- error `ng-without-issue`：最新の結果が NG なのに Issue の列が空の TC
- error `blocked-without-reason`：最新の結果が実行不能なのに理由がない TC（「手動確認待ち」は理由として認める）
- warning `case-not-run`：どの run にも出てこない TC
- warning `issue-unconfirmed`：改修確認の run がない、または判定が `要確認`・`効いていない` の Issue
- warning `run-unknown-tc`：cases にない TC-ID が run に出てくる
- error `duplicate-id`：同じ AC-ID・TC-ID が2回定義されている
- Issue の状態：改修確認の run の冒頭の判定で決める。複数の改修確認があれば最新のもの。確認済みでも、その後の run でその Issue の TC が NG なら `要確認` に戻す
- 最新の結果：TC ごとに、run のディレクトリ名（`YYYYMMDD-<run-id>`）の順で最後のもの。同じ日付は run-id の文字列順。`元の run` を持つ改修確認の run も通常の run として数える

- [ ] 失敗するテストを先に書く：各検査の正と負、`only 確認済み confirms an issue`、`latest run wins`、`a later NG reopens a confirmed issue`、`grouped NGs share one issue`、CLI の終了コード、QA リポジトリの外のパスや絶対パスの拒否
- [ ] 実装 → `npm test` → コミット

---

### Task 4: HTML（`--html FILE`）

**Files:** `src/qa-trace-html.ts`、`templates/qa-report/trace.html`、テスト

- 1枚の自己完結 HTML。AC ごとに、対応する TC、最新の結果（OK・NG・実行不能）、Issue 番号と状態、run のディレクトリを並べる。上に件数のまとめ（AC の網羅、結果の内訳、Issue の状態の内訳、findings の件数）を置く
- 見た目は `templates/qa-report/compare.html` の色とフォントの決め方（明るい・暗い表示の両方）に合わせる
- result.md の自由文（再現手順・実際の結果など）は入れない。TC 名・AC 本文はエスケープする
- 出力先は `checked` を通し、`.html` で終わることを求める（compare-report と同じ）
- [ ] 失敗するテスト（`html escapes and omits free text`、出力先の拒否、件数のまとめが JSON と一致）→ 実装 → `npm test` → コミット

---

### Task 5: aidev-qa-report

**Files:** `skills/qa/aidev-qa-report/SKILL.md`、`references/report-format.md`

- 日次のまとめ：その日の run の件数、結果の内訳、新しい NG と起票された Issue、実行不能とその理由、確認済みになった Issue。`reports/<YYYYMMDD>-daily.md`
- 品質レポート：AC の網羅（`aidev qa trace` の結果）、機能ごとの不具合の傾向、残るリスク（`plan/strategy.md` のリスクの評価と、未解決の NG・未確認の Issue を突き合わせる）、自動で実行したケースの割合、手動確認の残り。`reports/quality-<YYYYMMDD>.md`
- 入力は `aidev qa trace` の JSON と QA リポジトリの文書だけ。Gitea と C-HUB には書き込まない。C-HUB の滞留時間（QA のリードタイム）は、読み取りの手段が決まるまで「後の段階で検討」と書く
- 数字はすべて trace の結果から取り、推測で埋めない。個人情報と秘密情報を書かない
- [ ] SKILL.md と references を書く → 履歴 → `npm test` → コミット

---

### Task 6: 他の Skill・README・設計書の更新

- `aidev qa trace` と aidev-qa-report を「まだない」と書いている Skill（test-run、fix-verify、test-design ほか。grep で探す）を、使えるものとして書き直す。版を上げる
- README：`qa trace` と aidev-qa-report を足す
- 設計書 5.5：上の「trace の受け入れ条件」を足す
- 移行メモ：対応表の qa-report の行
- [ ] 書く → 履歴 → `npm test` → コミット

---

### Task 7: 段階4の完了確認

**Files:** Create: `docs/qa-phase4-verification.md`。段階2・3と同じく、コントローラが独立したセッションで行い、実装担当は文書だけを書く。

- [ ] **Step 1:** 段階2・3の確認で作った見本の QA リポジトリ（一時ディレクトリに残っているもの）に `aidev qa trace` をかけ、結果が実際のファイルと合うかを確かめる（AC の網羅、Issue #1 が確認済み、#2 が未確認など）
- [ ] **Step 2:** わざと漏れを入れた QA リポジトリ（AC を1つ参照されなくする、NG の Issue の列を空にする、改修確認の判定を要確認にする、手動のケースの理由を消す）で、それぞれが findings に出ることを確かめる
- [ ] **Step 3:** aidev-qa-report で日次のまとめと品質レポートを作り、数字が trace の結果と一致するかを確かめる
- [ ] **Step 4:** `--html` の出力を開き、表示を確かめる（ブラウザで目視。段階2で HTML を目視していなかった残りも、ここで compare.html と合わせて見る）
- [ ] **Step 5:** 結果を `docs/qa-phase4-verification.md` に書き、`npm test` を通してコミットする。push の再開と取り込みは利用者の指示を受けてから行う

## 本物の Gitea での確認（利用者の作業）

段階3から残っている「本物の Gitea での重複の検索」は、社内の Gitea のテスト用リポジトリと個人のトークンが要るため、この計画のタスクには入れない。Task 7 の後に、利用者の了承を得て行うかを相談する。
