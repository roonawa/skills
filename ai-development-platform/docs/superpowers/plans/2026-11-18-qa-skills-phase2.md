# QA Skill 段階2（実行系）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テストを実行して証跡を残す7つの QA Skill と、それを確かめるための動かせる見本アプリ（Web と WPF）、新旧比較の HTML を作る `aidev qa compare-report` を作る。

**Architecture:** 見本 Web は依存のない Node の HTTP サーバーで、旧版と新版を同じコードの引数で切り替える。見本 Desktop は .NET の WPF アプリで、Windows でだけビルドする。Skill が生成するテストコード（Playwright の spec、FlaUI の C# プロジェクト）は QA リポジトリの `automation/` に置き、基盤の依存には入れない。比較用の HTML は旧 Skill のスクリプトを TypeScript に移して CLI のコマンドにする。各 Skill は段階1と同じく `skills/qa/` に置き、`test/qa-skills.test.mjs` の書き方の検査を通す。

**Tech Stack:** Node.js 22、strict TypeScript 5.8、`node:test`、yaml 2.9.1（基盤の依存はこれだけのまま）。見本と QA リポジトリ側では Playwright（`@playwright/test`）、.NET 9 の WPF、FlaUI.UIA3。

**Spec:** `docs/superpowers/specs/2026-11-18-qa-skills-generalization-design.md`（段階2は 5.1 の実行系の7行、5.3、5.9、5.10、6章）

前提：段階1は main に取り込み済み（`e76055a`）。段階1の確認結果は `docs/qa-phase1-verification.md`。

## Global Constraints

- Node.js 22 以上、strict TypeScript。変更後は `npm test` を通す。CI（ubuntu・windows・macos）で通らないテストを `npm test` に入れない
- 基盤（`package.json`）の依存を増やさない。Playwright・FlaUI は見本アプリと QA リポジトリの側にだけ置く。`npm audit --audit-level=high` が通ること
- Skill の原本を変えたら `metadata.version` を上げ、`npm run build && node scripts/skill-history.mjs` で `skills/history.json` を更新する
- 新しい Skill の名前は `aidev-qa-*`、`metadata.version` は `"0.1.0"` から。`test/qa-skills.test.mjs` の書き方の検査を通す（案件固有の語なし、「必ず」3回まで、太字8組まで、検証を省く記述なし、references の相互参照、`profile` に触れる）
- 汎用 Skill の本文に、特定の案件の値（案件名、URL、ロール名、IdP 名）を書かない。案件固有の知見は `docs/qa-migration-notes/` へ移す
- プロファイルに秘密情報の値を書かない。認証情報は環境変数から読み、プロファイルには環境変数の名前だけを書く（設計書 5.9）
- 作業者の PC での実行を前提にする。Gitea Actions のワークフローは作らない（設計書 5.9）
- まだない Skill やコマンド（`aidev qa trace`、aidev-qa-bug-ticket、aidev-qa-fix-verify、aidev-qa-cause-repro、aidev-qa-report）は「後の段階で追加する予定で、まだない」と書く。実行させない
- 証跡は最終結果のものだけを残す。件数0の検索結果を証跡にしない（0件の表示そのものを確かめるケースは除く）
- 文章は自然な日本語で書く（yomiyasu の基準）
- このリポジトリ（`~/.claude/skills`、origin は roonawa/skills）では、ブランチを作る前に push を止める（Task 0）

## Review Focus

1. 見本 Web の認可は、画面のボタンを隠すだけでなくサーバー側で判定していること。旧版と新版のどちらでも、staff が他人の貸出の URL を直接開くと 403 になる → Task 2 のテスト `staff gets 403 for another user's loan in both versions`
2. 見本 Web の新版に入れた「意図しない差分」と「わざと入れた不具合」が、要件定義書や プロファイルから読み取れないこと（答えは EXPECTED.md にだけ書く） → Task 2 のテスト `sample docs do not reveal planted differences`
3. `aidev qa compare-report` が、マニフェストに書かれた画像パスで `..` や絶対パスを使ってマニフェストのディレクトリの外を読まないこと → Task 4 のテスト `refuse image paths outside the manifest directory`
4. `aidev qa compare-report` の出力 HTML で、マニフェストの文字列（タイトル、ケース名、備考）がエスケープされること → Task 4 のテスト `escape manifest text in html`
5. プロファイルの検査で、`api_key:` の下にリストで書いた値を秘密情報として検出し、`pass_rate` のような無害なキーは止めないこと → Task 1 のテスト `detect secrets written as a list` と `allow keys that merely contain pass`

---

### Task 0: 作業ブランチと push の停止

**Files:** なし

- [ ] **Step 1: push を止めてからブランチを作る**

```bash
git -C C:/Users/roonawa/.claude/skills remote set-url --push origin no_push
git -C C:/Users/roonawa/.claude/skills switch -c feature/qa-skills-phase2
```

完了時（この計画の最後）に、利用者の指示を受けてから `git remote set-url --push origin https://github.com/roonawa/skills.git` で戻す。

- [ ] **Step 2: 基準の状態を確かめる**

Run: `npm test`（`ai-development-platform` で実行）
Expected: 119 件すべて PASS

---

### Task 1: プロファイルの秘密情報の検査を強化する（段階1の残件）

**Files:**
- Modify: `src/qa-profile.ts`（`secretKey`、`keyValue`、front matter の走査）
- Test: `test/qa-profile.test.mjs`

**Interfaces:**
- Produces: `checkProfileText`・`checkProfile` のシグネチャは変えない。エラーコードも変えない（`secret`）

**決めた規則:**
- 秘密情報のキーは、キー名を `_` と `-` で区切った「語」で判定する。語のどれかが `password`・`passwd`・`pwd`・`secret`・`token`・`apikey`・`credential`・`credentials` なら秘密情報のキー。`api_key`・`api-key` は「`api` の次が `key`」として扱う。キー全体が `pass` のときも秘密情報のキーとする（`pass_rate` のように `pass` が語の一つにすぎないキーは対象外）
- 末尾の語が `env` のキー（`*_env`）は、今と同じく対象外
- 秘密情報のキーの値が、空でないスカラーか、空でないスカラーを1つ以上含むリストなら `secret` にする。値は出力しない
- 本文の行の検査（`keyValue`）も同じ語の規則に揃える

- [ ] **Step 1: 失敗するテストを書く**

```js
test('detect secrets written as a list', () => {
  const r = checkProfileText('p.md', valid.replace('evidence:', 'api_key:\n  - sk_live_abcdef123456\nevidence:'));
  assert.ok(r.errors.some(e => e.code === 'secret' && e.path === 'api_key'));
  assert.ok(!JSON.stringify(r).includes('sk_live'));
});
test('allow keys that merely contain pass', () => {
  for (const line of ['pass_rate: 0.95', 'passing_score: 80', 'bypass_login: true', 'compass_view: north', 'tokenizer: kuromoji', 'password_reset_url: "https://localhost/reset"']) {
    const r = checkProfileText('p.md', valid.replace('evidence:', line + '\nevidence:'));
    assert.deepEqual(r.errors.filter(e => e.code === 'secret'), [], line);
  }
});
test('still detect whole-word secret keys', () => {
  for (const line of ['pass: hunter2', 'db_password: x1', 'auth_token: abc', 'api-key: abc', 'client_secret: abc', 'credentials: abc']) {
    const r = checkProfileText('p.md', valid.replace('evidence:', line + '\nevidence:'));
    assert.ok(r.errors.some(e => e.code === 'secret'), line);
  }
});
```

`password_reset_url` は語に `password` を含むため秘密情報のキーになる。このテストの期待と矛盾するので、`password_reset_url` の行は「末尾の語が `url` のキーは、値が URL として妥当で認証情報を含まなければ対象外」という例外で通す。例外はこの1つだけにする。

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL（リストの値が検出されない、`pass_rate` などが止まる）

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS。段階1の既存のテスト（`*_env`、拇印、本文の散文、見本と雛形のプロファイル）も通る

- [ ] **Step 5: コミット**

```bash
git add src/qa-profile.ts test/qa-profile.test.mjs
git commit -m "fix: プロファイルの秘密情報の検査で、リストの値を検出し、pass を含むだけのキーを止めない"
```

---

### Task 2: 見本 Web のアプリ

**Files:**
- Create: `templates/qa/samples/web/app/server.mjs`、`templates/qa/samples/web/app/seed.mjs`、`templates/qa/samples/web/app/README.md`
- Modify: `templates/qa/samples/web/EXPECTED.md`、`templates/qa/samples/web/knowledge/sample-web/profile.md`（起動方法と到達手順だけ。答えを書かない）
- Test: `test/qa-sample-web.test.mjs`

**Interfaces:**
- Produces: `node templates/qa/samples/web/app/server.mjs --version old|new --port N`。標準出力に `listening http://localhost:N` を1行出す。`SIGTERM` で終了する
- `seed.mjs` は `export function seed(): {users, loans}` を返す。テストとサーバーが共用する
- 環境変数：`SAMPLE_STAFF_USER`・`SAMPLE_STAFF_PASSWORD`・`SAMPLE_ADMIN_USER`・`SAMPLE_ADMIN_PASSWORD` など、プロファイルの `roles` に書いた名前。未設定ならサーバーは起動を拒否する（既定のパスワードを持たない）

**アプリの仕様（`requirements.md` に従う。要件にないことは足さない）:**
- 依存のない `node:http`。セッションは HttpOnly の Cookie とメモリ上の表。データはメモリ上で、起動のたびに `seed()` から作り直す
- 画面は HTML を返す。ボタンやリンクには、テストが選びやすい `data-testid` を付ける
- 認可はサーバー側で判定する。画面のボタンを出さないだけにしない
- seed：staff を4人用意する。貸出 0 件、ちょうど 50 件、51 件以上、備考あり・なしの両方を持つ者。admin を1人。各人のユーザー名とパスワードは環境変数から読む。追加の staff 用の環境変数名は、`profile.md` の `roles` に追記する
- 旧版と新版の差は、`EXPECTED.md` に書いた3つだけにする
  - 意図した差分：一覧の並び順（旧版は貸出日の古い順、新版は新しい順。同じ貸出日は ID 順）
  - 意図しない差分：新版の CSV の日付が `yyyy/MM/dd`（旧版と要件は `yyyy-MM-dd`）
  - わざと入れた不具合（新しく足す）：新版で、staff が `/loans.csv` を直接開くと 403 ではなく CSV が返る（AC-015 違反）。詳細画面の 403（AC-008）は両方の版で正しい
- `EXPECTED.md` の「旧版と新版の差」にわざと入れた不具合を追記し、照合と認可の検証が何を検出すべきかを書く

- [ ] **Step 1: 失敗するテストを書く**

テストはサーバーを子プロセスで空いているポートに起動し、`fetch` で確かめる。環境変数はテストの中で架空の値を渡す。

```js
test('staff gets 403 for another user\'s loan in both versions', async t => { /* old と new の両方で 403、本文に他人の備品名が出ない */ });
test('list order differs between versions as intended', async t => { /* old は貸出日昇順、new は降順。同日は ID 順 */ });
test('csv date format differs only in new', async t => { /* admin の CSV：old は 2026-06-01 形式、new は 2026/06/01 形式。見出し行は両方 貸出ID,備品名,借りた人,貸出日,返却予定日 */ });
test('planted csv authz defect exists only in new', async t => { /* staff の /loans.csv：old は 403、new は 200 */ });
test('server refuses to start without credentials in env', async t => { /* 環境変数なしで終了コード 1 */ });
test('pagination boundary 50 and 51', async t => { /* 50件の staff は1ページ、51件以上の staff は2ページ目がある */ });
test('sample docs do not reveal planted differences', () => {
  for (const f of ['requirements.md', 'knowledge/sample-web/profile.md', 'app/README.md']) {
    const text = readFileSync(join(samples, 'web', f), 'utf8');
    assert.doesNotMatch(text, /yyyy\/MM\/dd|\/loans\.csv.{0,20}(200|返る)|わざと/);
  }
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL（`server.mjs` がない）

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS。Windows・macOS・Linux のどれでも動く書き方にする（パスは `node:path`、ポートは 0 で取る）

- [ ] **Step 5: コミット**

```bash
git add templates/qa/samples/web test/qa-sample-web.test.mjs
git commit -m "feat: 見本 Web の旧版と新版を動かせるアプリを追加する"
```

---

### Task 3: 見本 Desktop のアプリ

**Files:**
- Create: `templates/qa/samples/desktop/app/SampleStock.csproj`、`App.xaml`、`App.xaml.cs`、`MainWindow.xaml`、`MainWindow.xaml.cs`、`stock.csv`、`README.md`
- Modify: `templates/qa/samples/desktop/knowledge/sample-desktop/profile.md`（起動方法、AutomationId の一覧）
- Test: `test/qa-sample-desktop.test.mjs`

**Interfaces:**
- Produces: `dotnet build templates/qa/samples/desktop/app` で `SampleStock.exe` ができる。`net9.0-windows`、`UseWPF`
- 主な要素の AutomationId：`StockGrid`、`SaveButton`、`DeleteButton`、`StatusText`。メッセージボックスと保存ダイアログは標準のもの（所有ウィンドウの子として開く）

**アプリの仕様:** `requirements.md` の 1〜3 章どおり。起動時は未選択、ステータスバーは空。保存は `品名,数量,置き場所` の見出し行と UTF-8。削除は確認メッセージボックス、未選択なら警告「削除する行を選んでください」。わざと入れた不具合はない。

- [ ] **Step 1: テストを書く**

`process.platform === 'win32'` かつ環境変数 `AIDEV_TEST_DESKTOP=1` のときだけ動き、それ以外は `t.skip()` する（CI では動かさない）。

```js
test('desktop sample builds', { skip: !(process.platform === 'win32' && process.env.AIDEV_TEST_DESKTOP === '1') }, () => {
  const r = spawnSync('dotnet', ['build', appDir, '-c', 'Release', '--nologo'], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
test('desktop profile lists automation ids that exist in xaml', () => {
  // profile.md の本文に挙げた AutomationId が MainWindow.xaml にすべてある（どの OS でも動く）
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test` と、Windows で `$env:AIDEV_TEST_DESKTOP='1'; npm test`
Expected: FAIL（ファイルがない）

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: 上と同じ
Expected: PASS。ビルドの成果物（`bin/`、`obj/`）は `.gitignore` に入れる

- [ ] **Step 5: コミット**

```bash
git add templates/qa/samples/desktop test/qa-sample-desktop.test.mjs
git commit -m "feat: 見本 Desktop の WPF アプリを追加する"
```

---

### Task 4: `aidev qa compare-report`

**Files:**
- Create: `src/qa-compare.ts`、`templates/qa-report/compare.html`（旧 `comparing-evidence-rounds/templates/report.html` を写す）
- Modify: `src/cli.ts`（`qa compare-report MANIFEST OUT [--link]` と使用法の文言）
- Test: `test/qa-compare.test.mjs`
- 参照のみ: `~/.claude/skills/comparing-evidence-rounds/scripts/generate-report.js`、`SKILL.md` の「マニフェストの形式」

**Interfaces:**
- Produces:
  - `interface CompareManifest { title: string; customer?: string; generatedAt?: string; rounds: string[]; screens: { screen: string; testCases: { name: string; note?: string; results: { round: number; status: string; screenshot?: string; screenshots?: string[] }[] }[] }[] }`
  - `renderCompareReport(manifestDir: string, manifest: CompareManifest, options: { link: boolean; outDir: string }): { html: string; assets: Record<string, string> }`（`assets` は `--link` のときにコピーする相対パス → 元のパス）
  - `compareReport(root: string, manifestFile: string, outFile: string, link: boolean): { out: string; screens: number; testCases: number; images: number }`
- CLI：成功は `{"ok":true,...}` と終了コード 0。形式の誤り、見つからない画像、外を指すパスは `ok:false` と終了コード 1
- 見た目と構成は旧版を保つ（顧客に出す HTML のため。設計書 5.10）。`status` の表記ゆれ（`pass`/`fail` など）の扱いも旧版どおり

- [ ] **Step 1: 失敗するテストを書く**

```js
test('render rounds, statuses and embedded images', () => { /* 2ラウンド、OK/NG、1x1 PNG を base64 で埋め込む。結果のない列は「対象外」 */ });
test('link mode copies images into assets', () => { /* --link で out の隣に assets/ を作り、相対パスで参照する */ });
test('escape manifest text in html', () => { /* title と name に <script> を入れても、HTML にはエスケープされて出る */ });
test('refuse image paths outside the manifest directory', () => { /* ../x.png、絶対パス、C:\\x.png は ok:false */ });
test('reject a round index out of range', () => { /* round: 5 で ok:false */ });
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL（`dist/qa-compare.js` がない）

- [ ] **Step 3: 実装する**

画像の読み込みは `files.ts` の `checked` を使い、マニフェストのディレクトリからの相対パスだけを許す。画像の大きさの上限は 1 枚 20 MiB とし、超えたら `ok:false`（`content()` の 1 MiB は文字列用なので、画像は別に `lstatSync` と `readFileSync` で読む）。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/qa-compare.ts src/cli.ts templates/qa-report test/qa-compare.test.mjs
git commit -m "feat: 新旧比較の HTML を作る aidev qa compare-report を追加する"
```

---

### Task 5: QA リポジトリの `automation/` と成果物の形式の追記

**Files:**
- Modify: `templates/qa/README.md`（構成に `automation/` を足す）、`templates/qa/runs/README.md`（証跡の参照の書き方）、`templates/qa/files.json`（`automation/README.md` を追加）
- Create: `templates/qa/automation/README.md`
- Test: `test/adapters.test.mjs`（init で `automation/README.md` ができる）

**決めた形式:**
- `automation/web/`：Playwright。`package.json` と `playwright.config.ts` は Skill が作る。spec は `automation/web/tests/<機能>.spec.ts`、テスト名の先頭に TC-ID を付ける（例 `TC-detail-003 staff が他人の貸出の詳細 URL を直接開くと 403 になる`）
- `automation/desktop/`：FlaUI の C# テストプロジェクト。テスト名の先頭に TC-ID を付ける
- 証跡の保存先は `runs/<YYYYMMDD>-<run-id>/evidence/<TC-ID>/`。プロファイルの `evidence.method` が `local` や `external` のときは、`result.md` の「証跡」の列に保存先のパスを書き、リポジトリには入れない
- `runs/<run-id>/result.md` の冒頭に、実行した環境名（プロファイルの `environments[].name`）、版、実行日時を書く

- [ ] **Step 1: テストを書き、失敗を確かめる**
- [ ] **Step 2: README と files.json を書く**
- [ ] **Step 3: `npm test` が通ることを確かめてコミットする**

```bash
git add templates/qa test/adapters.test.mjs
git commit -m "feat: QA リポジトリにテストコードの置き場 automation/ と証跡の置き方を追加する"
```

---

### Task 6〜12: 実行系の Skill

共通の要件（各タスクで繰り返さない）:
- 置き場所は `skills/qa/<name>/`。`metadata.version: "0.1.0"`。書いたら `npm run build && node scripts/skill-history.mjs` を実行し、`npm test` を通してコミットする
- 最初にプロファイルを読み、`aidev qa profile check knowledge/<product>/profile.md --skill <name>` を通す。欠けている項目は作業者に確かめ、推測で埋めない
- 入力は `plan/acceptance.md`・`cases/*.md`（段階1の形式）。出力は Task 5 の形式（`automation/`、`runs/<run-id>/result.md`、証跡）
- 技術固有の知見（Playwright、WebView2、FlaUI、SAML/OIDC）は `references/` に分ける。旧 Skill の案件固有の知見は Task 13 の移行メモに回し、Skill には書かない
- 旧 Skill は読むだけで変更しない。判断の基準は残し、手順の細部、「必ず」「禁止」の羅列、太字の多用、トークン節約のための省略は持ち込まない
- テストが緑でも、そのテストが本当に失敗を検出できるかを確かめる姿勢を持つ（設計書 2章の失敗とみなす状態）。revert や不具合の注入で失敗を確かめる手順を省かない

#### Task 6: aidev-qa-login-session

- 元: `~/.claude/skills/capi-saml-login/`
- Files: `skills/qa/aidev-qa-login-session/SKILL.md`、`references/saml.md`、`references/oidc.md`、`references/form.md`
- 内容：プロファイルの `login.method` に応じて、Playwright で認証済みの `storageState` を作る。保存先は `automation/web/.auth/<role>.json` で、`.gitignore` に入れる（Cookie は秘密情報）。資格情報は `roles[].user_env`・`password_env` の環境変数から読む。経路によって発行される Cookie が変わること、ログイン結果の判定（成功画面に着いたか、エラー画面か、IdP で止まったか）の基準を残す。証明書方式は `login.certificate_thumbprint` を使う手順として書き、実装はデスクトップ側（Task 9）に回す
- 確認：見本 Web（フォーム認証）で staff と admin の `storageState` ができ、それを使って一覧が開ける

#### Task 7: aidev-qa-characterization

- 元: `~/.claude/skills/campus-playwright/`、`~/.claude/skills/cs-webview-regression-test/`、`~/.claude/skills/capturing-playwright-evidence/`
- Files: `skills/qa/aidev-qa-characterization/SKILL.md`、`references/screen-manifest.md`、`references/playwright.md`、`references/webview2.md`、`references/evidence.md`
- 内容：既存画面の今の挙動を、画面マニフェスト（網羅の分母。対象と除外を明記した JSON を `automation/web/manifests/<画面>.json` に置く）で決めたうえで、Playwright の特性テストとして記録する。画面表示・内部データ（API の応答）・帳票の3点を記録する。ロールと表示モードの組み合わせごとに正常系を作り、必須入力のフォームだけ「必須あり／なし」の2通りを作る（旧 campus-playwright の範囲の決め方を残す）。証跡の撮り方、撮影直後の目視確認、件数0の証跡を作らないこと、完全性の確認（マニフェストのすべての項目に証跡がある）を残す。WebView2 の画面は `references/webview2.md`（CDP で接続する方法）
- 確認：見本 Web の旧版で、一覧・詳細・登録・CSV の特性テストが staff と admin で記録できる

#### Task 8: aidev-qa-test-run

- 元: `~/.claude/skills/test-execute/`
- Files: `skills/qa/aidev-qa-test-run/SKILL.md`、`references/result-format.md`
- 内容：`cases/*.md` の各 TC を、自動のものは `automation/` のテスト（なければ作る）で実行し、手動のものは再現手順付きの確認項目として残す。テストの実行方法はプロファイルの `test_commands` から読む。C#/Java の限定はなくす。結果を `runs/<run-id>/result.md` に `OK|NG|実行不能` で書く。新しく書いたテストは、期待結果を逆にするか不具合を注入して一度失敗させ、検出できることを確かめる（旧 Skill の「revert 検証を行わない」はやめる）。NG のときは、Issue の起票（aidev-qa-bug-ticket、後の段階で追加予定）に必要な情報（再現手順、期待と実際、証跡の場所）を `result.md` に残す
- 確認：見本 Web の新版で、段階1のテスト仕様書の自動のケースを実行し、わざと入れた不具合（staff の CSV 直接アクセス）が NG になる

#### Task 9: aidev-qa-desktop-gui

- 元: `~/.claude/skills/cs-native-regression-test/`、`~/.claude/skills/automating-wpf-with-flaui/`
- Files: `skills/qa/aidev-qa-desktop-gui/SKILL.md`、`references/flaui.md`、`references/dialogs.md`
- 内容：Windows の GUI を FlaUI（UIA3）で操作するテストを `automation/desktop/` に作り、実行する。PC を占有するテストは他のテストと分けて実行すること、モーダルの検出（所有ウィンドウをたどる、マルチモニター）、タイムアウトの扱い、保存・フォルダ選択・印刷のダイアログ、メッセージボックスの検出、証跡の撮り方を残す。旧 automating-wpf-with-flaui の Quick Reference と Common Mistakes は `references/flaui.md` に移す
- 確認：見本 Desktop で、行の選択、保存（ダイアログのキャンセルを含む）、削除の確認（はい・いいえ）、未選択での削除の警告を操作し、証跡が取れる（Windows でだけ）

#### Task 10: aidev-qa-regression-compare

- 元: `~/.claude/skills/capi-regression-test/`、`~/.claude/skills/comparing-evidence-rounds/`
- Files: `skills/qa/aidev-qa-regression-compare/SKILL.md`、`references/diff-classification.md`、`references/compare-manifest.md`
- 内容：プロファイルの2つ以上の環境（旧版と新版、または設定段階の前後）で同じテストを流し、画面表示・内部データ・帳票の3点を照合する。差異を「一致／意図した差分／要確認」に分ける。「意図した差分」と言えるのは、要件定義書や AC に根拠があるものだけで、根拠を差異ごとに書く。一覧と詳細は別々に照合する（旧 capi-regression-test の判断を残す）。比較の HTML は Task 4 の `aidev qa compare-report` で作る（マニフェストの形式は `references/compare-manifest.md`）
- 確認：見本 Web の旧版と新版を照合し、並び順の差を「意図した差分」（根拠 AC-006）、CSV の日付の形式と staff の CSV 直接アクセスを「要確認」に分ける

#### Task 11: aidev-qa-authz-test

- 元: `~/.claude/skills/capi-authz-test/`
- Files: `skills/qa/aidev-qa-authz-test/SKILL.md`、`references/authz-matrix.md`
- 内容：ロールと操作の表（許可・拒否）を作り、拒否側を画面を通さない直接のリクエストで確かめる。行レベルの所有者の検証（担当内／担当外、ID の差し替え、他人のデータが検索や一覧に混ざらないこと）。ボタンが出ないことは判定に使わない。拒否の確認は、ステータスだけでなく本文に内容が出ないことまで見る。対象の操作の絞り込みと優先順位の付け方を残す
- 確認：見本 Web の新版で、staff の CSV 直接アクセスを拒否されるべき操作として NG にし、詳細の 403 は OK にする

#### Task 12: aidev-qa-screen-verification

- 元: `~/.claude/skills/orchestrating-capi-screen-verification/`
- Files: `skills/qa/aidev-qa-screen-verification/SKILL.md`
- 内容：画面単位で、特性テストの記録（なければ作る）→ 認可の検証 → 新旧の照合 → 証跡の収集 → 結果のまとめ、を順に Task 6〜11 の Skill で回す。各 Skill を呼ぶ順番と、前の結果を次にどう渡すか（認可の結果を画面マニフェストに反映するかの判断など）を書く。複数の画面をまとめて処理するときの進め方。手順は各 Skill に任せ、ここには工程の切れ目の判断だけを書く
- 確認：見本 Web の詳細画面で、上の工程が通しで回り、`runs/<run-id>/result.md` と比較の HTML ができる

各 Task（6〜12）の Step:

- [ ] **Step 1: 旧 Skill を読み、残す判断と移すもの（references、移行メモ）を決める**
- [ ] **Step 2: SKILL.md と references を書く**
- [ ] **Step 3: 履歴を更新して `npm test` を通す**（`test/qa-skills.test.mjs` の検査に新しい Skill が加わって通る）
- [ ] **Step 4: コミットする**（`feat: <内容> aidev-qa-<name> を追加する`）

「確認」に書いた内容は、Task 15 でまとめて確かめる。

---

### Task 13: 移行メモ

**Files:**
- Create: `docs/qa-migration-notes/README.md`、`docs/qa-migration-notes/university-campus.md`、`docs/qa-migration-notes/cs-desktop-app.md`

**内容:** 段階1・2で汎用化した旧 Skill（qa-strategy、spec-test、dev-test、test-execute、campus-playwright、capturing-playwright-evidence、capi-*、cs-*-regression-test、orchestrating-capi-screen-verification、comparing-evidence-rounds、automating-wpf-with-flaui）から、案件固有の記述を抜き出す。環境の URL と体制、テスト用アカウントの扱い、IdP の設定、画面とリポジトリの対応、落とし穴、到達手順。各案件の担当者が、そのままプロファイルの本文に書き写せる形にする。秘密情報の値は写さない（環境変数の名前だけ）。ファイル名と本文の案件名は、旧 Skill の記述どおりでよい（`docs/` は書き方の検査の対象外）。README には、旧 Skill と新しい Skill の対応表と、旧 Skill を消すかどうかは利用者が決めること（設計書 5.7）を書く。

- [ ] **Step 1: 旧 Skill を読み、案件固有の記述を抜き出す**
- [ ] **Step 2: 秘密情報の値が入っていないことを確かめる**

Run: `node dist/cli.js qa profile check` 相当の検査は Markdown の本文全体にかけられないため、`grep -nE "(password|passwd|token|secret)\s*[:=]\s*[^ ]" docs/qa-migration-notes/*.md` で該当がないことを確かめる
Expected: 該当なし

- [ ] **Step 3: コミット**

```bash
git add docs/qa-migration-notes
git commit -m "docs: 旧 QA Skill の案件固有の知見を移行メモに移す"
```

---

### Task 14: README と書き方の検査の追補

**Files:**
- Modify: `README.md`（`qa compare-report`、見本アプリの起動、`AIDEV_TEST_DESKTOP`、新しい7つの Skill）
- Modify: `test/qa-skills.test.mjs`（禁止語に、移行メモに出てくる案件固有の語のうち段階1の正規表現にないものを足す。例：旧 Skill の IdP 名やホスト名。足す語は Task 13 で抜き出したものから選ぶ）

- [ ] **Step 1: 禁止語を足し、`npm test` で新しい Skill がすべて通ることを確かめる**
- [ ] **Step 2: README を書く**
- [ ] **Step 3: コミット**

---

### Task 15: 段階2の完了確認

**Files:**
- Create: `docs/qa-phase2-verification.md`

段階1と同じく、コントローラが独立したセッション（サブエージェント）で行う。実装担当には文書の作成だけを任せる。

- [ ] **Step 1: 見本 Web を strategy から通しで動かす**

一時ディレクトリに `init qa-web --template qa` で QA リポジトリを作り、見本の requirements・プロファイル・AC を写して、段階1と段階2の Skill をすべて入れる。旧版（4101）と新版（4102）を起動する。互いに独立した新しいセッションで、次を順に行う。

1. aidev-qa-strategy で `plan/strategy.md` を作る
2. aidev-qa-test-design でテスト仕様書を作る（優先度が strategy にもとづいて付き、AC-008・AC-015 が「高」になるか）
3. aidev-qa-login-session、aidev-qa-characterization で旧版の特性テストを記録する
4. aidev-qa-test-run で新版を実行する（わざと入れた不具合が NG になるか）
5. aidev-qa-regression-compare で旧版と新版を照合する（並び順は「意図した差分」、CSV の日付と staff の CSV 直接アクセスは「要確認」）
6. aidev-qa-authz-test で認可を検証する（staff の CSV 直接アクセスが NG、詳細の 403 が OK）
7. aidev-qa-screen-verification を詳細画面で通しで回す

- [ ] **Step 2: 見本 Desktop で aidev-qa-desktop-gui を動かす（Windows）**

ダイアログを含む操作の証跡が取れるか。未選択での削除の警告を検出できるか。

- [ ] **Step 3: 結果を記録する**

`docs/qa-phase2-verification.md` に、見本ごとに、各工程の結果と `EXPECTED.md` との一致・不一致を書く。期待どおりでなければ、Skill を直して版を上げ、該当の工程からやり直す。

- [ ] **Step 4: 汎用 Skill の本文に案件固有の値が残っていないことを確かめる**

Run: `npm test`（`test/qa-skills.test.mjs` の禁止語の検査）
Expected: PASS

- [ ] **Step 5: コミットし、利用者に報告する**

```bash
git add docs/qa-phase2-verification.md
git commit -m "docs: QA Skill 段階2の確認結果を記録する"
```

ブランチ `feature/qa-skills-phase2` の内容と確認結果を報告する。push の再開と main への取り込みは、利用者の指示を受けてから行う。
