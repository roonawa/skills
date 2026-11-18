# QA Skill 段階1（土台）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** QA 用の Skill を `skills/qa/` から配布できる仕組み、案件プロファイルの検査、QA リポジトリの雛形、見本の2案件、計画・設計・レビューの3つの Skill を作る。

**Architecture:** registry を `skills/core` と `skills/qa` の2つの置き場所に対応させ、`references/*.md` を持つ Skill を配布・更新・照合できるようにする。プロファイルの検査は `src/qa-profile.ts` に置き、CLI の `qa profile check` と、`init --template qa` で作るプロジェクトの `check` から使う。Skill 本文の書き方の基準（設計書 5.2）は、`test/qa-skills.test.mjs` で機械的に検査する。

**Tech Stack:** Node.js 22、strict TypeScript 5.8、`node:test`、yaml 2.9.1（既存の依存だけを使う）

**Spec:** `docs/superpowers/specs/2026-11-18-qa-skills-generalization-design.md`

段階2〜4は、それぞれ別の計画にする。見本の案件は、段階1では文書（要件・AC・プロファイル・わざと抜いた観点）だけを作る。動かせるアプリは、実行系を作る段階2の計画で作る。

## Global Constraints

- Node.js 22 以上、strict TypeScript。変更後は `npm test` を通す
- Skill の原本を変えたら `metadata.version` を上げ、`node scripts/skill-history.mjs` で `skills/history.json` を更新する
- 新しい Skill の名前は `aidev-qa-*`。`metadata.version` は `"0.1.0"` から始める
- 利用者が編集したコピーは、`skill update` で上書きしない（既存の挙動を保つ）
- core の SKILL.md だけの Skill のハッシュは変えない（既存の `skills/history.json` との互換）
- 汎用 Skill の本文に、特定の案件の値（案件名、URL、ロール名、IdP 名）を書かない
- プロファイルに秘密情報の値を書かない。書いてよいのは環境変数の名前と、証明書の拇印だけ
- 文章は自然な日本語で書く（yomiyasu の基準。絵文字、文末のコロン、過剰な太字・箇条書きを避ける）
- このリポジトリ（`~/.claude/skills`、origin は roonawa/skills）では、ブランチを作る前に push を止める（Task 0）

## Review Focus

1. Windows で checkout して改行が CRLF になった references を持つ Skill でも、`skill update` が「編集された」と誤判定しない → Task 2 のテスト `update treats CRLF copies of a qa skill as released`
2. references の中に、サブディレクトリ、`.md` 以外のファイル、シンボリックリンクがある → 配布を拒否する → Task 1 のテスト `reject unsupported files in a qa skill`
3. プロファイルの本文（front matter の外）にトークンやパスワードが書かれている → エラーにする → Task 3 のテスト `detect secrets in the markdown body`
4. `*_env` の項目に、環境変数の名前ではなく値そのもの（例 `P@ssw0rd`）が書かれている → エラーにする → Task 3 のテスト `reject values in env name fields`
5. 利用者が references のファイルだけを編集した → `skill update` が上書きしない → Task 2 のテスト `update keeps an edited reference file`

---

### Task 0: 作業ブランチと push の停止

**Files:** なし

- [ ] **Step 1: push を止めてからブランチを作る**

```bash
git -C C:/Users/roonawa/.claude/skills remote set-url --push origin no_push
git -C C:/Users/roonawa/.claude/skills switch -c feature/qa-skills-phase1
```

完了時（この計画の最後）に、利用者の指示を受けてから `git remote set-url --push origin https://github.com/roonawa/skills.git` で戻す。

- [ ] **Step 2: 基準の状態を確かめる**

Run: `npm test`（`ai-development-platform` で実行）
Expected: すべて PASS

---

### Task 1: registry を2つの置き場所と references に対応させる

**Files:**
- Modify: `src/registry.ts`
- Test: `test/registry.test.mjs`

**Interfaces:**
- Produces:
  - `type SkillCategory = 'core' | 'qa'`
  - `interface Skill { name: string; description: string; version: string; category: SkillCategory }`
  - `loadSkill(name: string): { source: string; info: Skill; files: Record<string, string> }`。`files` のキーは Skill のディレクトリからの相対パス（`'SKILL.md'`、`'references/x.md'`）。`source` は `files['SKILL.md']`
  - `listSkills(): Skill[]`（core と qa の両方を、名前順で返す）
  - `skillSetHash(files: Record<string, string>): string`。`SKILL.md` だけなら `skillHash(files['SKILL.md'])` と同じ値を返す。それ以外は、パスの昇順に `path + '\0' + 改行を LF にそろえた内容 + '\0'` をつないだものの sha256
  - `parseSkill`・`skillHash`・`releasedHashes` は今のシグネチャのまま

- [ ] **Step 1: 失敗するテストを書く**

`test/registry.test.mjs` に追加する。

```js
import { listSkills, loadSkill, skillSetHash, skillHash } from '../dist/registry.js';
test('list core and qa skills with their category', () => {
  const skills = listSkills();
  assert.ok(skills.some(s => s.category === 'core' && s.name === 'aidev-testing'));
  assert.ok(skills.every(s => s.category === 'core' || s.category === 'qa'));
  assert.equal(new Set(skills.map(s => s.name)).size, skills.length);
});
test('hash of a SKILL.md-only skill is unchanged', () => {
  const {source, files} = loadSkill('aidev-testing');
  assert.deepEqual(Object.keys(files), ['SKILL.md']);
  assert.equal(skillSetHash(files), skillHash(source));
});
test('set hash ignores line endings and depends on paths', () => {
  const a = {'SKILL.md': 'x\n', 'references/a.md': 'y\n'};
  assert.equal(skillSetHash(a), skillSetHash({'SKILL.md': 'x\r\n', 'references/a.md': 'y\r\n'}));
  assert.notEqual(skillSetHash(a), skillSetHash({'SKILL.md': 'x\n', 'references/b.md': 'y\n'}));
});
```

`reject unsupported files in a qa skill` は、registry の置き場所を差し替えられないため、`readSkillDirectory(directory: string): Record<string,string>` を export して一時ディレクトリで確かめる。`references/sub/a.md`、`references/a.txt`、`notes.md`（直下の SKILL.md 以外）、シンボリックリンクの4つがそれぞれ例外になることを `assert.throws` で確かめる。シンボリックリンクは Windows で作れない場合があるため、作れなければ `t.skip()` する。

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL（`skillSetHash` が export されていない）

- [ ] **Step 3: `src/registry.ts` を実装する**

- 置き場所は `skills/core/`（category `core`）と `skills/qa/`（category `qa`）。`skills/qa/` がなければ空として扱う
- `readSkillDirectory` は、`SKILL.md` と `references/` 直下の `.md` だけを許す。それ以外があれば `'Skill に配布できないファイルがあります: ' + path` で例外にする。読み込みは `files.ts` の `checked` と `content` を使う（リンクと 1 MiB を超えるファイルを拒否する）
- 同じ名前が両方の置き場所にあれば、`'Skill 名が core と qa で重複しています: ' + name` で例外にする
- 今の `'この版は SKILL.md 単体の配布に対応します。'` の検査は、`readSkillDirectory` に置き換えて削除する

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/registry.ts test/registry.test.mjs
git commit -m "feat: registry が skills/qa と references を持つ Skill を読めるようにする"
```

---

### Task 2: 配布・更新・照合を複数ファイルに対応させる

**Files:**
- Modify: `src/project.ts`（`skillFiles`、`updateSkill`）
- Modify: `scripts/skill-history.mjs`
- Modify: `src/cli.ts`（`skill list` の出力に category が入ることだけ。コードの変更は不要なら変えない）
- Test: `test/skill-update.test.mjs`

**Interfaces:**
- Consumes: `loadSkill(name).files`、`skillSetHash`、`releasedHashes`（Task 1）
- Produces: `skills/history.json` の qa の Skill の値は、`skillSetHash` のハッシュ

- [ ] **Step 1: 失敗するテストを書く**

テストには、references を持つ qa の Skill が1つ要る。テスト専用の Skill や置き場所の差し替えは入れず、Task 6 で書く `aidev-qa-strategy` を、ここで先に最小の内容で置いて使う。最小の内容は、正しい front matter（`name: aidev-qa-strategy`、description、`metadata.version: "0.1.0"`）と本文1行、`references/strategy-outline.md` に1行。Task 6 で本文を書く。

`test/skill-update.test.mjs` に追加する。

```js
test('add installs SKILL.md and references to both hosts', t => {
  // init → skill add aidev-qa-strategy
  // .claude/skills/aidev-qa-strategy/references/strategy-outline.md と .agents/... の両方があり、内容が同梱と一致する
  // verify の結果に aidev-qa-strategy が含まれる
});
test('update treats CRLF copies of a qa skill as released', t => {
  // 配置した全ファイルを CRLF に書き換えても、skill update は edited として拒否しない
});
test('update keeps an edited reference file', t => {
  // references のファイルだけに1行足す → skill update は例外になり、メッセージに references のパスが入る
});
test('verify reports a missing reference file', t => {
  // references のファイルを1つ消す → verify が '配置ファイルが不足しています' で失敗する
});
```

`update keeps an edited reference file` で「更新が必要な状態」を作るには、`.aidev/installed/aidev-qa-strategy` の版を `0.0.9` に書き換え、`skills/history.json` に無い版として扱われることを使う（既存のテスト `registeredAtPrevious` と同じ考え方）。

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL（references が配置されない）

- [ ] **Step 3: 実装する**

- `skillFiles(name)`：`loadSkill(name).files` の全ファイルを、`hosts` の各ホストの `<host>/<name>/<相対パス>` に置く
- `updateSkill`：ホストごとに、同梱の版のファイル一覧と、配置済みの `references/*.md` の一覧を合わせて読み、`skillSetHash` で比べる。配置済みの組が記録済みの版のハッシュに一致すれば置き換える。新しい版にない references は、置き換えのときに削除する。一致しなければ、今と同じメッセージで止める（パスはホストのディレクトリ単位で示す）
- `skill-history.mjs`：`skills/qa` も読む。qa の Skill は git の履歴をさかのぼらず、今の作業ツリーの組だけを `skillSetHash` で記録する（既存の記録は消さない）。core は今のまま
- 書き込みは今と同じく、一時ファイルを書いてから rename する。受領ファイル（`.aidev/installed/<name>`）は最後に書く

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm run build && node scripts/skill-history.mjs && npm test`
Expected: PASS。`skills/history.json` に `aidev-qa-strategy` の `0.1.0` が入る

- [ ] **Step 5: コミット**

```bash
git add src/project.ts scripts/skill-history.mjs test/skill-update.test.mjs skills/qa skills/history.json
git commit -m "feat: references を持つ Skill の配布・更新・照合に対応する"
```

---

### Task 3: 案件プロファイルの検査

**Files:**
- Create: `src/qa-profile.ts`
- Modify: `src/cli.ts`（`qa profile check FILE [--skill NAME]` と使用法の文言）
- Test: `test/qa-profile.test.mjs`

**Interfaces:**
- Produces:
  - `interface ProfileIssue { code: string; message: string; path?: string; line?: number }`
  - `interface ProfileReport { file: string; product?: string; errors: ProfileIssue[]; warnings: ProfileIssue[] }`
  - `checkProfileText(file: string, text: string, skill?: string): ProfileReport`
  - `checkProfile(root: string, file: string, skill?: string): ProfileReport`（`checked`/`content` で読む）
  - `const profileRequirements: Record<string, string[]>`（Skill 名 → 必須の項目）
- CLI: 成功は `{"ok":true,...report}` と終了コード 0。errors があれば `ok:false` と終了コード 1

**プロファイルの形式（`templates/qa/knowledge/profile.template.md` と同じ）:**

```yaml
product: sample-web                 # 小文字・数字・ハイフン
environments:
  - {name: old, url: http://localhost:4101, purpose: 旧版}
roles:
  - {name: staff, user_env: SAMPLE_STAFF_USER, password_env: SAMPLE_STAFF_PASSWORD}
login: {method: form, entry_url: http://localhost:4101/login}   # method: saml|oidc|form|certificate|none
# 証明書方式なら login.certificate_thumbprint（40桁の16進数）を書いてよい
stack: [node, html-form]
test_commands:
  - {name: e2e, run: npx playwright test}
evidence: {method: local, retention: 90d}   # method: lfs|external|local
```

**profileRequirements（設計書 5.1 の Skill ごと）:**

| Skill | 必須 |
|---|---|
| aidev-qa-strategy・aidev-qa-test-design・aidev-qa-test-review | `product` |
| aidev-qa-test-run | `product`, `test_commands` |
| aidev-qa-characterization | `product`, `environments`, `roles`, `stack`, `evidence` |
| aidev-qa-regression-compare | `product`, `environments`（2件以上）, `evidence` |
| aidev-qa-authz-test | `product`, `environments`, `roles`（2件以上）, `login` |
| aidev-qa-login-session | `product`, `environments`, `roles`, `login` |
| aidev-qa-desktop-gui | `product`, `stack`, `evidence` |
| aidev-qa-screen-verification・aidev-qa-fix-verify・aidev-qa-cause-repro・aidev-qa-bug-ticket・aidev-qa-report | `product` |

`--skill` を省略したときは `product` と、書かれている項目の形式だけを検査する。

- [ ] **Step 1: 失敗するテストを書く**

```js
import { checkProfileText } from '../dist/qa-profile.js';
const valid = '---\nproduct: sample-web\nroles:\n  - {name: staff, user_env: SAMPLE_STAFF_USER, password_env: SAMPLE_STAFF_PASSWORD}\nevidence: {method: local, retention: 90d}\n---\n# 観点\n一覧は0件のとき空表示になる。\n';
test('accept a valid profile', () => {
  const r = checkProfileText('p.md', valid);
  assert.deepEqual(r.errors, []); assert.equal(r.product, 'sample-web');
});
test('reject values in env name fields', () => {
  const r = checkProfileText('p.md', valid.replace('SAMPLE_STAFF_PASSWORD', 'P@ssw0rd'));
  assert.ok(r.errors.some(e => e.code === 'env-name' && e.path === 'roles[0].password_env'));
});
test('detect secrets in the markdown body', () => {
  for (const secret of ['password: hunter2', 'Authorization: Bearer abcdefghijklmnop1234',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', 'Cookie: sessionid=abc123def456', '-----BEGIN PRIVATE KEY-----']) {
    const r = checkProfileText('p.md', valid + secret + '\n');
    assert.ok(r.errors.some(e => e.code === 'secret' && typeof e.line === 'number'), secret);
  }
});
test('allow a certificate thumbprint', () => {
  const r = checkProfileText('p.md', valid.replace('evidence:', 'login: {method: certificate, certificate_thumbprint: ' + 'a'.repeat(40) + '}\nevidence:'));
  assert.deepEqual(r.errors, []);
});
test('require fields per skill', () => {
  const r = checkProfileText('p.md', valid, 'aidev-qa-regression-compare');
  assert.ok(r.errors.some(e => e.code === 'required' && e.path === 'environments'));
});
test('reject unknown evidence and login methods', () => {
  assert.ok(checkProfileText('p.md', valid.replace('method: local', 'method: s3')).errors.some(e => e.path === 'evidence.method'));
});
test('reject an unknown skill name', () => {
  assert.throws(() => checkProfileText('p.md', valid, 'aidev-qa-unknown'));
});
```

CLI のテストは `test/cli.test.mjs` に1件足す。`qa profile check` を一時ディレクトリの正しいファイルで実行して終了コード 0、秘密情報入りで終了コード 1 と `ok:false`。

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL（`dist/qa-profile.js` がない）

- [ ] **Step 3: `src/qa-profile.ts` を実装する**

- front matter の切り出しは `parseSkill` と同じ正規表現と、`yaml` の `parseDocument`（`maxAliasCount: 0`）を使う
- 環境変数の名前は `/^[A-Z][A-Z0-9_]*$/`。`_env` で終わる項目すべてに適用する
- 秘密情報の検出は、front matter と本文の全行に対して行い、行番号を付ける。対象は、テストに挙げた5つの形（`password`/`passwd`/`secret`/`token` に `:` か `=` で値が続くもの。ただし値が環境変数の名前の形なら除く、Bearer、JWT、`Cookie:`/`Set-Cookie:`/`sessionid=`、秘密鍵のヘッダー）
- URL は `http:` か `https:` だけを許す
- 例外を投げるのは、未知の Skill 名と、ファイルが読めないときだけ。形式の誤りは `errors` に入れる

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/qa-profile.ts src/cli.ts test/qa-profile.test.mjs test/cli.test.mjs
git commit -m "feat: 案件プロファイルを検査する aidev qa profile check を追加する"
```

---

### Task 4: QA リポジトリの雛形（`init --template qa`）

**Files:**
- Create: `templates/qa/files.json`、`templates/qa/README.md`、`templates/qa/plan/acceptance.md`、`templates/qa/cases/README.md`、`templates/qa/runs/README.md`、`templates/qa/reports/README.md`、`templates/qa/knowledge/profile.template.md`、`templates/qa/knowledge/README.md`
- Modify: `src/adapter.ts`（`qa` を追加）
- Test: `test/adapters.test.mjs`

**Interfaces:**
- Consumes: `checkProfile`（Task 3）
- Produces: `parseTemplate('qa')`。`checkProject('qa', root)` は `knowledge/*/profile.md` を1件ずつ `checkProfile` にかけ、プロファイルごとに `CheckResult`（`name: 'profile:<ディレクトリ名>'`）を返す。プロファイルが1件もなければ `unavailable`
- 成果物の形式（Skill と段階4の trace が使う。各 README に書く）:
  - `plan/acceptance.md`：`- AC-001: 観測できる結果（出どころ: 要件定義書 3.2）`。`aidev spec check` と同じ `AC-\d{1,6}` の形
  - `cases/<機能>.md`：ケースごとに見出し `### TC-<機能>-001 <名前>` と、`- AC: AC-001, AC-002`、`- 優先度: 高|中|低`、`- 実行: 自動|手動`、手順、期待結果
  - `runs/<YYYYMMDD>-<run-id>/result.md`：表 `| TC-ID | 結果 | 証跡 | Issue |`。結果は `OK|NG|実行不能`
- `profile.template.md` の evidence の説明に、個人情報が映る案件では `lfs` を選ばないことを書く

- [ ] **Step 1: 失敗するテストを書く**

```js
test('init --template qa creates the QA repository skeleton', t => {
  // init demo --template qa → plan/acceptance.md, cases/README.md, knowledge/profile.template.md がある
  // check は profile がないので exit 2（unavailable）
});
test('check runs profile checks for each product', t => {
  // knowledge/sample-web/profile.md に正しいプロファイル → exit 0、checks[0].name === 'profile:sample-web'
  // 秘密情報を足す → exit 1
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL（未対応のテンプレート）

- [ ] **Step 3: 実装する**

`parseTemplate` のエラーメッセージを `core、react、unity、qa から選んでください。` に変える。`aidev init` の使用法の文言（`src/cli.ts`）にも `qa` を足す。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add templates/qa src/adapter.ts src/cli.ts test/adapters.test.mjs
git commit -m "feat: QA リポジトリの雛形と、プロファイルを検査する check を追加する"
```

---

### Task 5: 見本の2案件（文書）

**Files:**
- Create: `templates/qa/samples/web/requirements.md`、`templates/qa/samples/web/knowledge/sample-web/profile.md`、`templates/qa/samples/web/plan/acceptance.md`、`templates/qa/samples/web/EXPECTED.md`
- Create: `templates/qa/samples/desktop/` に同じ4つ（product は `sample-desktop`）
- Test: `test/qa-samples.test.mjs`

`templates/qa/files.json` には samples を入れない（init で配らない）。

**見本 Web の内容:**
- 架空の「備品貸出」アプリ。ロールは `staff`（自分の貸出だけ見える・登録できる）と `admin`（全件見える・CSV 出力できる）
- 画面は、ログイン（フォーム）、一覧（0件のときの表示、50件ごとのページ送り）、詳細（他人の貸出の URL を直接開いた staff には 403）、登録（必須項目と返却予定日の範囲）、CSV 出力
- 旧版と新版がある。意図した差分は「一覧の並び順を貸出日の新しい順に変える」。意図しない差分は「CSV の日付の形式が変わる」（段階2で使う）
- AC は 10〜15 件

**見本 Desktop の内容:**
- 架空の WPF「在庫一覧」。行の選択、保存ダイアログ、削除時の確認メッセージボックス、未選択で削除したときの警告
- AC は 6〜10 件

**`EXPECTED.md`（答え合わせ用。Skill には渡さない）:**
- qa-test-design が必ず作るべき観点（各 AC との対応）
- qa-test-review が指摘すべき欠落。Web では「staff が他人の貸出の URL を直接開く（行レベルの所有者検証）」、Desktop では「未選択での削除」を、わざと抜いたテスト仕様書の版で使う

- [ ] **Step 1: 失敗するテストを書く**

```js
test('sample profiles pass profile check', () => {
  for (const p of ['web/knowledge/sample-web/profile.md', 'desktop/knowledge/sample-desktop/profile.md']) {
    const r = checkProfile(samplesRoot, p);  // samplesRoot = templates/qa/samples
    assert.deepEqual(r.errors, [], p);
  }
});
test('sample acceptance criteria pass spec check format', () => {
  // acceptance.md の AC-ID が連番で、web は 10〜15 件、desktop は 6〜10 件
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL（ファイルがない）

- [ ] **Step 3: 文書を書く**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add templates/qa/samples test/qa-samples.test.mjs
git commit -m "feat: QA Skill の確認に使う見本の Web と Desktop の案件を追加する"
```

---

### Task 6: Skill の書き方の検査と aidev-qa-strategy

**Files:**
- Create: `test/qa-skills.test.mjs`
- Modify: `skills/qa/aidev-qa-strategy/SKILL.md`、`skills/qa/aidev-qa-strategy/references/strategy-outline.md`（Task 2 で置いた最小の内容を書き直す）
- 参照のみ: `~/.claude/skills/qa-strategy/`（旧 Skill。変更しない）

**Interfaces:**
- Consumes: `listSkills`、`loadSkill`（Task 1）
- Produces: `test/qa-skills.test.mjs` は、category `qa` の全 Skill に次を課す。Task 7・8 もこれに通す

```js
const forbidden = /信州|信大|campus|capi|Allcampus|OneLogin|ailesys|chub\.ailesys|wkozu|ailegit/i;
for (const s of listSkills().filter(s => s.category === 'qa')) {
  test(s.name + ' follows the writing rules', () => {
    const {files} = loadSkill(s.name);
    const all = Object.values(files).join('\n');
    assert.ok(s.name.startsWith('aidev-qa-'));
    assert.doesNotMatch(all, forbidden);
    assert.ok((files['SKILL.md'].match(/必ず/g) ?? []).length <= 3);
    assert.ok((files['SKILL.md'].match(/\*\*/g) ?? []).length / 2 <= 8);
    assert.doesNotMatch(all, /トークン(消費|節約)|revert.{0,20}(省略|行わない)/);
    for (const ref of files['SKILL.md'].matchAll(/references\/[\w.-]+\.md/g)) assert.ok(files[ref[0]], ref[0]);
    for (const path of Object.keys(files).filter(p => p !== 'SKILL.md')) assert.ok(files['SKILL.md'].includes(path), path + ' is never referenced');
    assert.match(files['SKILL.md'], /profile/);  // 最初にプロファイルを読む手順がある
  });
}
```

**aidev-qa-strategy の内容（設計書 5.2 の書き方で）:**
- 使う場面：要件定義書・設計書・既存コードから、リスクにもとづくテスト戦略書を作る。単体の仕様書作成は aidev-qa-test-design
- 最初に `knowledge/<product>/profile.md` を読み、`aidev qa profile check` を `--skill aidev-qa-strategy` で通す
- 出力は `plan/strategy.md` と `plan/acceptance.md`（AC の出どころを書く。設計書 5.8）
- 旧 Skill から残すもの：Discovery Questions の考え方、数値の未確定値を「⚠ 要確認」で示す運用、Verification の確認項目。これらは判断の基準として短く書き、手順の細部は書かない
- 戦略書の章立ては `references/strategy-outline.md` に置く

- [ ] **Step 1: 検査のテストを書く**

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL（Task 2 の最小の本文に `profile` の記述がない）

- [ ] **Step 3: SKILL.md と references を書く。版を `0.1.1` に上げる**

- [ ] **Step 4: 履歴を更新してテストを通す**

Run: `npm run build && node scripts/skill-history.mjs && npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add test/qa-skills.test.mjs skills/qa/aidev-qa-strategy skills/history.json
git commit -m "feat: aidev-qa-strategy と、QA Skill の書き方の検査を追加する"
```

---

### Task 7: aidev-qa-test-design

**Files:**
- Create: `skills/qa/aidev-qa-test-design/SKILL.md`、`references/case-format.md`、`references/code-only.md`
- 参照のみ: `~/.claude/skills/spec-test/`、`~/.claude/skills/dev-test/`

**内容:**
- 入力は2通り。設計書がある場合（`plan/acceptance.md` と設計書から作る）と、コードしかない場合（`references/code-only.md` に従い、推定仕様を作ってから人に確認する。実装を正としない姿勢を必須とする）
- 出力は `cases/<機能>.md`（Task 4 の形式。`references/case-format.md`）。すべての TC に AC-ID を付け、どの TC にも対応しない AC があれば作業者に報告する
- 旧 spec-test のチェックポイント（草案完了時に人が確認）は、工程の切れ目の人の判断として残す
- 終わったら、別のセッションで aidev-qa-test-review を使うよう作業者に伝える。自分の出力を自分でレビューしない
- `metadata.version: "0.1.0"`

- [ ] **Step 1: SKILL.md と references を書く**
- [ ] **Step 2: 履歴を更新してテストを通す**

Run: `npm run build && node scripts/skill-history.mjs && npm test`
Expected: PASS（Task 6 の検査に `aidev-qa-test-design` が加わって通る）

- [ ] **Step 3: コミット**

```bash
git add skills/qa/aidev-qa-test-design skills/history.json
git commit -m "feat: 設計書とコードの両方から仕様書を作る aidev-qa-test-design を追加する"
```

---

### Task 8: aidev-qa-test-review

**Files:**
- Create: `skills/qa/aidev-qa-test-review/SKILL.md`、`references/review-checklist.md`

**内容:**
- テスト仕様書を作ったセッションとは別のセッションで、読み取りだけで使う。ファイルを書き換えない
- 入力は `plan/acceptance.md`、`cases/*.md`、プロファイルの本文（観点と落とし穴）
- 見るもの：AC の網羅、観点の漏れと過剰（プロファイルの観点と、`references/review-checklist.md` の一般的な観点。権限・行レベルの所有者、0件・上限、必須と範囲、二重送信、ダイアログとキャンセル）、粒度、期待結果が観測できるか
- 出力は、指摘ごとに TC-ID か AC-ID、種類（漏れ・過剰・粒度・不明確）、理由。指摘がなければ、見た範囲を書いて「指摘なし」とする
- 見つけた観点のうち案件固有のものは、プロファイルの本文への追記案として出す（直接は書かない。設計書の「ナレッジの追記は PR で提案」）
- `metadata.version: "0.1.0"`

- [ ] **Step 1: SKILL.md と references を書く**
- [ ] **Step 2: 履歴を更新してテストを通す**

Run: `npm run build && node scripts/skill-history.mjs && npm test`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add skills/qa/aidev-qa-test-review skills/history.json
git commit -m "feat: 別のセッションでテスト仕様書を読み取り専用で確認する aidev-qa-test-review を追加する"
```

---

### Task 9: 段階1の完了確認と README

**Files:**
- Create: `docs/qa-phase1-verification.md`
- Modify: `README.md`（`skills/qa`、`qa profile check`、`init --template qa` の説明）

- [ ] **Step 1: 見本の2案件で Skill を動かす**

見本ごとに、一時ディレクトリで `init <name> --template qa` を実行する。`templates/qa/samples/<見本>/` の requirements・profile・acceptance を写し、`skill add` で3つの Skill を入れる（EXPECTED.md は写さない）。そのうえで、互いに独立した新しいセッション（`claude -p`、または別々のサブエージェント）で次を行う。

1. aidev-qa-test-design でテスト仕様書を作る
2. その仕様書から EXPECTED.md の「わざと抜く観点」に当たるケースを削った版を作り、別のセッションで aidev-qa-test-review にかける

- [ ] **Step 2: 結果を記録する**

`docs/qa-phase1-verification.md` に、見本ごとに次を書く。
- 対応する TC のない AC の件数（期待値は0）
- EXPECTED.md の観点のうち、作られたものと作られなかったもの
- review が、わざと抜いた観点を指摘したか（期待値は「指摘した」）

期待どおりでなければ、Skill の本文を直して版を上げ、Step 1 からやり直す。

- [ ] **Step 3: すべてのテストを通す**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add docs/qa-phase1-verification.md README.md
git commit -m "docs: QA Skill 段階1の確認結果と使い方を記録する"
```

- [ ] **Step 5: 利用者に報告する**

ブランチ `feature/qa-skills-phase1` の内容と確認結果を報告する。push の再開（`git remote set-url --push origin https://github.com/roonawa/skills.git`）と main への取り込みは、利用者の指示を受けてから行う。
