# 修正への引き継ぎ（C-HUB貼り付け文面・再診断比較） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完了した実行から、C-HUB に貼り付けるタスクの件名と本文を作る。引き継いだ内容を記録し、再診断した結果と比べて「解消・未解消・再確認できず・新たに発生」の文面を作る。

**Architecture:** 純粋関数のモジュールを3つ作る。課題の抽出（`lib/handoff-issues.mjs`）、文面と比較（`lib/handoff-text.mjs`）、記録の保存（`lib/handoff-store.mjs`）。`ui/server.mjs` に、完了した実行を対象にするAPIを2本足す。`ui/public/app.js` に、既存の「不具合報告書を作成」と同じ形のパネルを足す。課題は既存の `enrichFailures` が作る `row.failures[]` を使い、新しい判定ロジックは作らない。

**Tech Stack:** Node.js 22（ESM `.mjs`）、`node:test`、Playwright（ブラウザーテスト）。

**Spec:** `docs/superpowers/specs/2026-11-02-fix-handoff-design.md`（承認済み）

## Global Constraints

- 課題 = `displayStatus(row)` が `fail`（不合格）または `caution`（注意）の行の `row.failures[]` の1件。区分は「不合格」と「注意」の2つだけ。
- 課題キー = `row.id` + `'|'` + `normalizeKey(failure.key)`。
- 「解消」にしてよいのは、その行が今回「確認できた」場合だけ。確認できた状態とは、`status` が `pass` か `fail` で、かつ `preparationRequired` でないこと。それ以外（設定が必要・`blocked`・`not_run`・`not_applicable`・`review`・行がない）は「再確認できず」。
- `unclassified:`／`timeout:` で始まるキーは、行が `pass` のときだけ「解消」。行が `fail` なら「未解消」。
- 件名は `{サイト名}：SITE EXAM 診断結果の修正（{実行日 YYYY-MM-DD・日本時間}）`。サイト名の改行は空白に、`:` と `：` は `・` に置き換える。
- 本文はプレーンテキストにする（【見出し】と「・」の箇条書き。Markdownは使わない）。上限は20,000文字。
- 担当区分の並びは「管理画面・プラグイン」「サーバー・ホスティング」「テーマ・開発」「担当区分の確認が必要」の順。各区分の中は不合格 → 注意の順。
- 対象URLは1課題につき最大5件。超える分は「ほかn件」と書く。
- 文面には `failures[]` と、行・実行のメタ情報だけを入れる。最後に `redactor(config)` を通す。プレビューとコピーする文面は完全に同じにする。
- 引き継ぎ記録はサイトごとに直近20件を保存する。保存先は `path.join(path.dirname(p.outputDir),'handoffs')`。同じ `handoffId` で保存したら上書きする。
- 外部への送信はしない。書き込み系APIは、既存のPOSTと同じ CSRF・送信元の検証を通す。
- コードはこのリポジトリの書き方に合わせる（1行に詰めた式、日本語のエラー文、コメントは少なめ）。
- 作業ブランチは `feature/fix-handoff`（`main` から作成する）。

## Review Focus

1. **前回と違う範囲で再診断したとき**：引き継いだ課題の行が今回選ばれていなければ「再確認できず」に分類し、先頭に範囲が違うという警告を出す。「解消」にはしない。→ Task 3 のテスト
2. **エラー文に毎回違う数字が入る課題**（ポート番号・時刻・ID）：同じ課題として「未解消」と判定する。→ Task 1 のテスト
3. **課題が数百件ある大きなサイト**：本文が20,000文字以内に収まり、短縮したことが本文に書かれる。→ Task 2 のテスト
4. **認証情報を含む設定のサイト**（Basic認証のヘッダーや Cookie を持つ `headersEnv`）：文面にその値が出ない。→ Task 2 のテスト
5. **同じ画面でコピーボタンを連打したとき**：記録は1件のままで、直近20件の上限を消費しない。→ Task 4 と Task 5 のテスト

---

### Task 1: 課題の抽出とキーの正規化

**Files:**
- Create: `lib/handoff-issues.mjs`
- Modify: `lib/issue-report.mjs`（証拠からURLを取り出す処理を `evidenceUrls` として export し、`buildIssueReport` もそれを使う）
- Test: `test/handoff-issues.test.mjs`

**Interfaces:**
- Produces:
  - `normalizeKey(key:string) -> string`
    - 置き換えは前から順に行う。URLのクエリ（`?` から次の空白か文字列の終わりまで）→ `?…`、UUID → `<uuid>`、ISO日時（`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?`）→ `<time>`、8桁以上の16進 → `<hex>`、3桁以上の数字 → `<n>`。
  - `issueKey(row, failure) -> string`：`row.id+'|'+normalizeKey(failure.key)` を返す。
  - `isConfirmed(row) -> boolean`：`['pass','fail'].includes(row.status)&&!row.preparationRequired`。
  - `collectIssues({report, readEvidence}) -> Issue[]`
    - `Issue = {key, rawKey, rowId, rowTitle, level:'fail'|'caution', owner:'admin'|'server'|'theme'|'unknown', urls:string[], title, actual, admin, code, verify}`
    - 対象：`displayStatus(row)` が `fail` か `caution` の行だけ。`row.failures` がなければ `[]`。
    - owner：キーが `baseline:` で始まる課題は `RULES[rule].owner`。それ以外は `'unknown'`。
    - urls：`baseline:rule:path` の課題は path を `report.baseURL` 基準の絶対URLにした1件。それ以外は `evidenceUrls({row, run:report, readEvidence})`。
  - `unconfirmedCount(report) -> number`：`isConfirmed` でない行の数。ただし `status==='not_run'` で `preparationRequired` でない行は数えない。
  - `evidenceUrls({row, run, readEvidence}) -> string[]`（`lib/issue-report.mjs`）：`buildIssueReport` が証拠から読む URL（axe/javascript/layout の `data.url`、security-baseline の path、policy の url）を重複なく返す。読めない証拠は無視する。

- [ ] **Step 1: 失敗するテストを書く**
  - `normalizeKey strips volatile parts`：`'error:connect ECONNREFUSED 127.0.0.1:53123 at 2026-11-02T10:00:00Z'` と `'error:connect ECONNREFUSED 127.0.0.1:61001 at 2026-11-03T09:12:44Z'` の結果が等しい。`'baseline:missing-csp:/'` は変わらない。
  - `collectIssues takes fail and caution rows only`：`pass`・`blocked`・preparation の行の failures は含まれない。`level` は caution の行で `'caution'` になる。
  - `baseline owner and url come from rule and key`：`baseline:missing-hsts:/about/` の課題は `owner:'server'`、`urls:['https://example.test/about/']`。
  - `non-baseline issues use evidenceUrls and unknown owner`
  - `unconfirmedCount ignores unselected not_run`：blocked 1件、preparation 1件、not_run 1件、review 1件のとき3を返す。
  - `issue report output unchanged after extraction`：既存の `test/issue-report.test.mjs` が通ること（コマンドで確認する）。
- [ ] **Step 2: 失敗を確認する**
  - Run: `node --test test/handoff-issues.test.mjs`
  - Expected: FAIL（モジュールがない）
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確認する**
  - Run: `node --test test/handoff-issues.test.mjs test/issue-report.test.mjs`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 引き継ぎ用の課題抽出とキー正規化"`

### Task 2: C-HUB用の件名と本文

**Files:**
- Create: `lib/handoff-text.mjs`
- Test: `test/handoff-text.test.mjs`

**Interfaces:**
- Consumes: Task 1 の `Issue`。
- Produces:
  - `handoffSubject({siteName, finishedAt}) -> string`
  - `buildHandoffText({report, siteName, issues, excludedKeys=[], unconfirmed, publicOrigin, projectId, clean=s=>s, limit=20000}) -> {subject, body, truncated:boolean, included:Issue[]}`
    - `included` は `issues` から `excludedKeys` にある課題を除いたもの。
    - 本文の構成は仕様書5.3のとおり（概要 → 担当区分ごとの一覧 → 末尾の文）。概要は「サイトURL」「環境」「実行日時（日本時間）」「実行ID」「不合格n件・注意n件」「SITE EXAMで未確認の項目：n件」で、`publicOrigin` があれば結果画面URL `${publicOrigin}/?project=${projectId}&run=${runId}` を足す（このURL形式は実装者が `ui/public/app.js` の既存の深いリンクに合わせて確定する）。
    - 区分名は、admin→「管理画面・プラグイン」、server→「サーバー・ホスティング」、theme→「テーマ・開発」、unknown→「担当区分の確認が必要」。
    - 各課題は `［不合格|注意］タイトル` の行と、「対象」「状況」「直し方」「確認方法」を「・」の箇条書きで書く。unknown の課題は「直し方（管理画面）」「直し方（技術）」に分けて admin と code の両方を書く。
    - 短縮の手順は仕様書5.3のとおり。短縮した場合は `truncated:true` にし、末尾に「全文はSITE EXAMの不具合報告書を参照」と書く。
    - 件名と本文の両方に `clean` を最後に適用する。

- [ ] **Step 1: 失敗するテストを書く**
  - `subject sanitizes site name and uses JST date`：`siteName:'A:B\nC'`、`finishedAt:'2026-11-01T16:30:00Z'` → `'A・B C：SITE EXAM 診断結果の修正（2026-11-02）'`
  - `body groups by owner in fixed order, fail before caution`
  - `excluded keys are omitted and counts reflect included only`
  - `urls capped at five with remainder count`：7件 → 5件と「ほか2件」
  - `unknown owner shows both admin and code`
  - `no markdown syntax`：本文が `/^#|\*\*|^\s*[-*] /m` に一致しない。
  - `long input is truncated within limit`：注意300件と不合格50件で、本文が20,000文字以下、`truncated===true`、末尾の文があり、不合格のタイトルがすべて残っている。
  - `secrets are redacted`：`clean` に `redactor({headersEnv:'X'},{X:JSON.stringify({authorization:'Basic c2VjcmV0'})})` を渡し、`actual` に `c2VjcmV0` を含む課題を与えても、本文に `c2VjcmV0` が出ない。
- [ ] **Step 2: 失敗を確認する**
  - Run: `node --test test/handoff-text.test.mjs`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確認する**
  - Run: `node --test test/handoff-text.test.mjs`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: C-HUB貼り付け用の件名と本文を生成"`

### Task 3: 再診断の比較と比較文面

**Files:**
- Modify: `lib/handoff-text.mjs`
- Test: `test/handoff-compare.test.mjs`

**Interfaces:**
- Consumes: Task 1 の `Issue`・`issueKey`・`isConfirmed`、Task 4 の `HandoffRecord` の形（`{handoffId, createdAt, actor, sourceRunId, sourceFinishedAt, siteName, issues:Issue[], excludedKeys:string[]}`）。
- Produces:
  - `compareHandoff({record, report, issues}) -> {resolved:Issue[], unresolved:Issue[], unverified:Issue[], added:Issue[], carriedExcluded:Issue[], scopeGap:number}`
    - 分類は Global Constraints と仕様書6.2のとおり。
    - `unresolved` の課題は今回の `urls` を持ち、`fixedUrlCount`（前回にあって今回ない URL の数）を付ける。
    - `scopeGap` は `unverified` のうち、行がない、または `status==='not_run'` の件数。
  - `buildCompareText({comparison, report, uncheckedAddedKeys=[], clean, limit=20000}) -> {body, truncated}`
    - 見出しは `【SITE EXAM 再診断結果（{実行日}）】`。
    - `scopeGap>0` なら先頭に「前回と同じ検査範囲で再診断していないため、n件は確認できていません」。
    - 一覧は解消・未解消・再確認できずについてタイトルと対象URLだけ。未解消に `fixedUrlCount>0` があれば「前回からn件のURLが解消」。新たに発生（チェックしたもの）は Task 2 と同じ詳細で書く。
    - 末尾の文は仕様書6.3のとおり。
  - `nextRecord({record, comparison, uncheckedAddedKeys, report, siteName, handoffId, actor, now}) -> HandoffRecord`：仕様書6.4のとおり。

- [ ] **Step 1: 失敗するテストを書く**
  - `resolved only when row confirmed`：行が `pass` → 解消。行が `blocked`／preparation／`not_run`／`review`／`not_applicable`／行なし → それぞれ再確認できず。
  - `fail row without the key is resolved, with the key is unresolved`
  - `volatile key text still matches`：前回の rawKey と今回の rawKey が数字だけ違う → 未解消。
  - `unclassified key resolves only on pass`：行が `fail` でキーが別の `unclassified:` 形 → 未解消。行が `pass` → 解消。
  - `partial url fix stays unresolved with remaining urls`：前回3URL、今回1URL → 未解消、urls が1件、`fixedUrlCount:2`。
  - `previously excluded keys go to carriedExcluded, not added`
  - `scope warning counts not_run and missing rows`：本文の先頭に警告の文がある。
  - `unchecked added issues are left out of text and moved to excluded in next record`
  - `nextRecord drops resolved`
- [ ] **Step 2: 失敗を確認する**
  - Run: `node --test test/handoff-compare.test.mjs`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確認する**
  - Run: `node --test test/handoff-compare.test.mjs test/handoff-text.test.mjs`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 引き継ぎ記録と再診断結果の比較文面"`

### Task 4: 引き継ぎ記録の保存

**Files:**
- Create: `lib/handoff-store.mjs`
- Test: `test/handoff-store.test.mjs`

**Interfaces:**
- Produces:
  - `handoffDir(outputDir:string) -> string`：`path.join(path.dirname(outputDir),'handoffs')` を返す。
  - `newHandoffId() -> string`：`'h-'+Date.now().toString(36)+'-'+randomBytes(4).toString('hex')`。
  - `saveHandoff(dir, record:HandoffRecord) -> void`
    - `handoffId` は `/^h-[a-z0-9]+-[a-f0-9]{8}$/` に一致しなければ throw する。
    - 一時ファイルに書いてから rename する（`lib/results.mjs` の `writeReport` と同じ方式）。
    - 同じIDなら上書きする。保存後、`createdAt` が古い順に削除して20件以内にする。
    - シンボリックリンクのディレクトリやファイルには書かない。
  - `latestHandoff(dir) -> HandoffRecord|null`：`createdAt` が最新のもの。壊れたファイルは無視する。

- [ ] **Step 1: 失敗するテストを書く**
  - `save and latest round trip`
  - `same id overwrites without consuming the 20 limit`：同じIDで5回保存してもファイルは1つ。
  - `keeps newest 20`：25件保存すると20件が残り、最も古い5件が消える。
  - `rejects bad id and symlinked dir`
  - `corrupt file is ignored by latestHandoff`
- [ ] **Step 2: 失敗を確認する**
  - Run: `node --test test/handoff-store.test.mjs`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確認する**
  - Run: `node --test test/handoff-store.test.mjs`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 引き継ぎ記録の保存"`

### Task 5: サーバーAPI

**Files:**
- Modify: `ui/server.mjs`（実行単位のAPI。既存の `issue-report` の分岐（`segments[5]` が `'issue-report'`）の隣に追加する）
- Test: `test/handoff-api.test.mjs`（既存の `test/automatic-run-api.test.mjs` と同じように、サーバーを起動して確かめる）

**Interfaces:**
- Consumes: Task 1〜4 のすべて。
- Produces（どちらも完了した実行だけ。未完了なら 409 `完了した実行を選択してください`）：
  - `POST /api/projects/:id/runs/:runId/handoff`
    - body：`{handoffId?:string, excludedKeys:string[], save:boolean}`
    - 応答：`{handoffId, subject, body, truncated, issues:[{key,rowTitle,level,owner,title,urls}], excludedKeys, unconfirmed}`
    - `handoffId` がなければ新しく作って返す。`save:true` のときだけ記録を保存する。
  - `POST /api/projects/:id/runs/:runId/handoff-compare`
    - body：`{handoffId?:string, uncheckedAddedKeys:string[], save:boolean}`
    - 応答：`{handoffId, baseline:{handoffId, sourceRunId, createdAt}|null, comparison:{resolved,unresolved,unverified,added,carriedExcluded}（各要素は key,rowTitle,level,title,urls）, scopeGap, body, truncated}`
    - 記録がない、または記録の元の実行が今回と同じか新しい場合は 409 `比較できる引き継ぎ記録がありません`。
    - `save:true` のとき `nextRecord` を保存する。
- 課題は、既存の `enrichFailures` と同じ証拠の読み方（サイズ上限8MBの `boundedPath`）で作った report から `collectIssues` で取る。`clean` には `redactor(current.config)` を使う。`publicOrigin` は `process.env.WPQA_PUBLIC_ORIGIN`、`actor` は既存の利用者名（共有版。なければ `null`）を使う。
- 入力の検証：`excludedKeys`／`uncheckedAddedKeys` は文字列の配列で、500件以内・1件1000文字以内。`handoffId` の形は Task 4 と同じ。

- [ ] **Step 1: 失敗するテストを書く**
  - `handoff preview does not save; save:true saves once per id`
  - `compare classifies against latest record and saves next record on save`
  - `rejects unfinished run, bad keys, bad id`
  - `compare without prior record returns 409`
  - `response body never contains configured secret header values`
- [ ] **Step 2: 失敗を確認する**
  - Run: `node --test test/handoff-api.test.mjs`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確認する**
  - Run: `node --test test/handoff-api.test.mjs` と `npm test`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 引き継ぎ文面と再診断比較のAPI"`

### Task 6: 画面

**Files:**
- Modify: `ui/public/app.js`（`#issue-report-panel` の直後に `<details id="handoff-panel">` を追加する。表示と非表示は `#issue-report-panel` と同じ条件にする）
- Modify: `ui/public/style.css`
- Test: `test/handoff-browser.mjs`（新規。`test/issue-report-browser.mjs` と同じ形）と `package.json` の `"test:handoff-ui"`

**Interfaces:**
- Consumes: Task 5 のAPI。
- パネルの構成：
  - 見出し「開発担当への引き継ぎ（C-HUB）」
  - 「文面を作成」ボタン：押すとプレビューを取得する（`save:false`）。
  - 課題のチェック一覧：既定はすべて選択。変更すると同じ `handoffId` でプレビューを取り直す。
  - 件名の入力欄（読み取り専用）と本文のテキストエリア（読み取り専用）
  - 「件名をコピー」「本文をコピー」：押すと `save:true` で保存し、`navigator.clipboard.writeText` でコピーする。使えない場合は本文を全選択し、「Ctrl+C でコピーしてください」と表示する。
  - 比較の欄：記録があり、比較できる実行のときだけ「前回の引き継ぎと比較」ボタンを表示する。押すと分類ごとの件数、「新たに発生」のチェック一覧、比較文面、「比較結果をコピー」を表示する。「比較結果をコピー」は `save:true`。
  - 表示はすべて既存の `escape()` を使う。`innerHTML` に未エスケープのデータを入れない。

- [ ] **Step 1: 失敗するテストを書く**（`test/handoff-browser.mjs`）
  - 課題のある実行で「文面を作成」を押すと、件名がサイト名で始まり、本文に担当区分の見出しが出る。
  - チェックを1つ外すと本文から消える。
  - 「本文をコピー」を2回押しても `handoffs` の中のファイルは1つ。
  - 2回目の実行を選ぶと「前回の引き継ぎと比較」が表示され、押すと「解消」の件数が出る。
  - 課題名に `<img src=x onerror=alert(1)>` を含む fixture でも、スクリプトが実行されない（`page.on('dialog')` が発火しない）。
- [ ] **Step 2: 失敗を確認する**
  - Run: `npm run test:handoff-ui`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確認する**
  - Run: `npm run test:handoff-ui`、`npm run test:ui`、`npm run test:report-ui`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 開発担当への引き継ぎパネル"`

### Task 7: 文書の更新と全体の検証

**Files:**
- Modify: `deploy/internal-announcement/SITE-EXAM-specification.md`
  - 9章の出力表に「C-HUB貼り付け文面」「再診断比較」を追加する。
  - 5章の操作フローに「引き継ぎ」と「再診断」の手順を追加する。
  - 11.2 の保持対象に `handoffs` を追記する。
  - 付録Cに新しいファイルを追加し、変更したファイルのSHA-256を更新する。
- Modify: `deploy/user-manual.html`（引き継ぎパネルの使い方と、比較の4分類の意味を説明する）
- Modify: `docs/superpowers/specs/2026-11-02-fix-handoff-design.md`（状態を「実装済み」にする）

- [ ] **Step 1: 文書を更新する**（SHA-256 は `sha256sum` で計算する）
- [ ] **Step 2: 全体を検証する**
  - Run: `npm test`、`npm run test:ui`、`npm run test:settings`、`npm run test:report-ui`、`npm run test:handoff-ui`
  - Expected: すべて PASS。main で以前から失敗している `test:registration` と `test:site-exam-ui` は対象外。
- [ ] **Step 3: デモで確かめる**
  - `npm run demo` に対して、実行 → 引き継ぎの文面を作成 → 2回目の実行 → 比較、を通しで行う。
  - 文面を目で見て確認する。
- [ ] **Step 4: コミットする**
  - `git commit -m "docs: 引き継ぎ機能を仕様書・操作マニュアルに反映"`
