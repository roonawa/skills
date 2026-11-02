# 認証なしセキュリティ基礎診断 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理画面認証なしで、公開URLへのGET/HEADだけを使ってWordPressサイトのセキュリティの兆候（兆候あり／注意）を検出する検査種別 `security-baseline` を追加する。

**Architecture:** 新しい検査ハンドラー `lib/checks/security-baseline.mjs` を既存ハンドラー群に登録する。分類（area）ごとに5件の `auto-security-*` 検査を、既存の `addSecurityChecks` の仕組みで自動追加する。判定ルールと説明文は `lib/security-baseline-rules.mjs` に集約し、`failure-explanations` 経由で既存のUI・報告書へ流す。「注意」は `status:'fail'` のまま行に `level:'caution'` を付けて表す。

**Tech Stack:** Node.js 22（ESM `.mjs`）、`@playwright/test` の `request` コンテキスト、cheerio、`node:test`、`node:tls`。

**Spec:** `docs/superpowers/specs/2026-11-02-security-baseline-design.md`（承認済み）。実装者は本計画と仕様書の両方を読むこと。

## Global Constraints

- 送るリクエストは GET と HEAD だけ。POST・攻撃用の文字列・総当たりは禁止。
- 接続先は `baseURL` と同じoriginだけ。例外は、HTTPS転送を確認するための `http://<同じhost>/` だけ。
- `maxRedirects:0` で取得し、転送先へは接続しない。
- 分類ごとのリクエスト上限は exposure 16件、transport 4件、mixed・headers・disclosure 各10件。
  - 件数には、転送の各段と、soft 404を見分けるための存在しないURLへの1件を含める。TLS接続は含めない。
- 各検査の中では逐次実行し、リクエストの間を200ms以上空ける。中断（`signal`）に従う。
- 本文は先頭64KiBだけ読む。
- exposure の証拠に本文の抜粋を残さない。残すのは path・status・Content-Type・bytes・rule だけ。ユーザー名は件数だけ残す。
- 確認できなかった項目を合格にしない。通信失敗・上限到達・proxyによる拒否は `BLOCKED: ` から始まるエラーにする（結果は「実行不能」）。
- 機密パス確認（exposure）は `config.allowSensitivePaths===true` のときだけ実行する。
  - 登録時の初期値は、本番が `false`、検証・ローカルが `true`。
  - 既存サイトで値がないときは `false`。
  - AI補完と自動準備はこの値を変更しない。
- 証明書の残りが14日未満、期限切れ、ホスト名の不一致、信頼できない証明書は、いずれも「兆候あり」。
- 「注意」は `security-baseline` で `required:false` の検査に限る。ほかの参考検査の表示は変えない。
- コードはこのリポジトリの書き方に合わせる（1行に詰めた式、短い名前、日本語のエラー文、コメントは少なめ）。
- 作業ブランチは `feature/security-baseline`（`main` から作成する）。

## Review Focus

1. **soft 404のサイト**：存在しないパスに200でテーマのHTMLを返すサイトで、exposure と disclosure が露出と誤判定しないこと。→ Task 3、Task 4 のテストで確認する。
2. **閲覧パスワードで保護されたサイト**：既存の公開ゲート用ヘッダーを使って取得すること。ログイン画面のHTMLが返ってきたら、問題なしではなく「実行不能」にすること。→ Task 3 のテストで確認する。
3. **巨大な応答や終わらない応答**：64KiBで読むのをやめ、タイムアウトしたら「実行不能」にすること。→ Task 3 のテストで確認する。
4. **egress proxyの拒否**：proxyが返す403を、サイト自身の403と区別すること。→ Task 1（ヘッダー `x-wpqa-egress: denied`）と Task 5 のテストで確認する。
5. **WordPressがサブディレクトリにあるサイト**（例：`/wp/wp-admin/`）：`wpPath` を基準に readme.html・xmlrpc・debug.log を確認すること。→ Task 4 と Task 7 のテストで確認する。

---

### Task 1: egress proxy の http 限定許可

**Files:**
- Modify: `lib/egress-policy.mjs`（`resolveDestination`）
- Modify: `bin/egress-proxy.mjs`（`http.createServer` 側のハンドラー）
- Test: `test/egress-http-derived.test.mjs`（新規）

**Interfaces:**
- Produces: `resolveDestination(url, entries, resolver=lookup, {method, hasBody}={})`。既存の呼び出し（引数3つまで）の動作は変えない。
- Produces: proxyが拒否するときの応答は `403` で、ヘッダー `x-wpqa-egress: denied` を付ける。CONNECTの拒否は今のままにする。

- [ ] **Step 1: 失敗するテストを書く**（resolverはスタブで `[{address:'93.184.216.34',family:4}]` を返す）
  - `derived http GET / is allowed when same-host https origin exists`：entries `[{origin:'https://example.com'}]`、`resolveDestination('http://example.com/',entries,stub,{method:'GET',hasBody:false})` が `{port:80}` を返す。
  - `derived http rejects other methods, paths, queries, bodies`：`POST`、`/wp-login.php`、`/?a=1`、`hasBody:true`、`http://example.com:8080/` のどれも reject される。
  - `derived http rejects private addresses`：stubが `10.0.0.5` を返すと reject される。
  - `derived http requires method option`：第4引数を省略すると、今までどおり reject される。
  - `explicit http rule with privateIPs unchanged`：既存の社内IP向け `http://` ルールは、POSTでも今と同じ結果になる。
- [ ] **Step 2: テストが失敗することを確認する**
  - Run: `node --test test/egress-http-derived.test.mjs`
  - Expected: 最初の1件だけ FAIL（reject される）。残りは現行の動作どおりで PASS する。
- [ ] **Step 3: `resolveDestination` を実装する**
  - 明示ルールが見つからない場合に限って処理を足す。
  - 条件：`u.protocol==='http:'`、`u.port===''`、`method==='GET'`、`hasBody===false`、`u.pathname==='/'`、`u.search===''`、かつ `'https://'+u.host` のルールが存在する。
  - これを満たすときだけ `{origin:u.origin,privateIPs:[]}` を一時ルールとして使い、以降の判定（公開IPだけを許可）は今と同じにする。
- [ ] **Step 4: proxy から渡す**
  - `createServer` 側で `{method:req.method,hasBody:Number(req.headers['content-length']||0)>0||!!req.headers['transfer-encoding']}` を渡す。
  - catch 節で、403に `x-wpqa-egress: denied` を付ける。
- [ ] **Step 5: テストが通ることを確認する**
  - Run: `node --test test/egress-http-derived.test.mjs test/ai-assistant.test.mjs`
  - Expected: PASS（既存のegressテストを含む）。
- [ ] **Step 6: コミットする**
  - `git commit -m "feat: egress proxyで登録済みhttpsホストのhttp GET /だけ許可"`

### Task 2: 許可フラグ `allowSensitivePaths` の受け渡し

**Files:**
- Modify: `lib/config.mjs:28`（許可キーの一覧に追加。真偽値の検証）
- Modify: `lib/checks/index.mjs:25-26`（`allowSensitivePaths??=false` と型の検証）
- Modify: `ui/registration.mjs`（`validateProfile` の allowed に `sensitivePaths` を追加し、真偽値を検証する。`registrationConfig` で `allowSensitivePaths` を設定する）
- Modify: `ui/project-store.mjs:42`（profile があるときに `allowSensitivePaths:profile.sensitivePaths===true` を設定する）
- Modify: `ui/automatic-preparation.mjs`（生成した設定をマージするとき、`allowSensitivePaths` は保存済みの値を必ず優先する）
- Test: `test/security-baseline-permission.test.mjs`（新規）

**Interfaces:**
- Produces: `config.allowSensitivePaths: boolean`（省略時は `false`）
- Produces: `profile.sensitivePaths?: boolean`
- `registrationConfig` で profile に値がないときの既定は `environment!=='production'`。保存済みサイトで値がないときは `false`。

- [ ] **Step 1: 失敗するテストを書く**
  - `config accepts boolean allowSensitivePaths and defaults false`：`validateConfig` を通ったあと、`false` が既定になっている。`'yes'` は throw する。
  - `registration default depends on environment`：`registrationConfig` の結果が、production では `false`、staging と local では `true`。`sensitivePaths:true` を指定すると production でも `true`。
  - `automatic preparation never widens allowSensitivePaths`：保存済みが `false` のサイトを `prepareSaved` に通しても `false` のまま。
- [ ] **Step 2: テストが失敗することを確認する**
  - Run: `node --test test/security-baseline-permission.test.mjs`
  - Expected: FAIL
- [ ] **Step 3: 上の Files に書いた各箇所を実装する**
- [ ] **Step 4: テストが通ることを確認する**
  - Run: `node --test test/security-baseline-permission.test.mjs test/registration.test.mjs test/automatic-preparation.test.mjs test/project-store.test.mjs`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 機密パス確認の許可allowSensitivePathsを追加"`

### Task 3: ハンドラーの骨組みと exposure

**Files:**
- Create: `lib/security-baseline-rules.mjs`
- Create: `lib/checks/security-baseline.mjs`
- Modify: `lib/checks/index.mjs`（handlers に追加）
- Modify: `lib/checks/discovered.mjs`（`publicHeaders` と `noGate` を export する）
- Test: `test/security-baseline.test.mjs`（新規。`test/discovered.test.mjs` と同じように `http.createServer` のfixtureと、`@playwright/test` の `request` を使う）

**Interfaces:**
- Produces（rules）：`export const RULES` を作る。キーはルールID、値は次の形にする。
  ```
  {area, level:'problem'|'caution', title, impact, admin, code, owner:'admin'|'server'|'theme', verify}
  ```
  - `impact` は顧客向けの説明（「〜のおそれ」で書く）。`admin` は管理画面での対応、`code` はサーバー・テーマでの対応、`verify` は確認方法。
  - 文面は仕様書6章の方針に従い、実装者が書く。
- Produces（handler）：
  - `kinds=['security-baseline']`
  - `validate(check,config)`
    - `suite` は `'authz'` でなければならない。
    - options のキーは `area`、`paths`、`wpPath` だけを許す。
    - `area` は `exposure`、`transport`、`mixed`、`headers`、`disclosure` のいずれか。
    - `paths` は1〜5件で、それぞれ `sameOrigin` を満たすこと。
    - `wpPath` は `/` で始まり `/` で終わるパスで、省略時は `'/'`。
  - `validateRuntime(check,config)`：`area==='exposure'&&config.allowSensitivePaths!==true` のとき、`BLOCKED: 本番環境の機密パス確認は許可が必要です（登録設定「機密ファイル露出の確認」）` を throw する。
  - `run({check,config,requestFactory,attach,signal})`：証拠を `attach('security-baseline',evidence)` で保存する。証拠の形は次のとおり。
    ```
    {schema:'security-baseline-v1',area,requests:[{method,path,status,contentType,bytes}],findings:[{rule,level,path,observation}],unchecked:[path],scope}
    ```
  - 判定：検査の level（`check.required` なら `'problem'`、そうでなければ `'caution'`）に一致する findings が1件以上あれば、`assert.fail` に検出したルールIDを改行区切りで渡して不合格にする。
  - findings はないが `unchecked` が残っている場合は、`BLOCKED: 上限または通信失敗により未確認：...` を throw する。
- 内部の補助関数（名前は実装者に任せる）
  - リクエスト件数の上限を数える。
  - 200msの間隔を空ける。
  - 本文を64KiBで打ち切って読む。
  - 応答がログイン画面のHTML（`noGate` 相当）なら BLOCKED にする。
  - 通信例外を `BLOCKED: ` に変換する。

- [ ] **Step 1: 失敗するテストを書く**（fixtureサーバーには「露出あり」と「露出なし」の2つのモードを用意する）
  - `exposure detects git, env, debug log, wp-config backup, uploads index by content signature`：露出ありモードで、findings の rule に `git-head`、`git-config`、`env-file`、`debug-log`、`wp-config-backup`、`uploads-index` が含まれ、run が reject される。
  - `soft 404 html is not exposure`：どのパスにも200でテーマのHTMLを返すモードでは、findings が0件で、run が resolve する。
  - `exposure evidence never contains body text`：証拠をJSON文字列にしたものに、fixtureの秘密文字列 `DB_PASSWORD`、`SECRET_VALUE`、`ref: refs` が含まれない。
  - `exposure is blocked without permission and sends no request`：`allowSensitivePaths:false` のとき、`validateRuntime` が `/^BLOCKED: /` で throw し、run を呼んでもfixtureへのリクエストが0件。
  - `requests are GET/HEAD only, same origin, within 16, spaced >=200ms`：fixtureが受け取ったメソッド・件数・時刻の間隔を確認する。
  - `oversized body is truncated at 64KiB`：10MBを返すパスがあっても、テストがメモリやタイムアウトで失敗しない。
  - `timeout or connection error becomes BLOCKED`：応答しないパスがあると、`/BLOCKED:/` で reject される。
  - `password gate html becomes BLOCKED`：`#loginform` を返すと `/BLOCKED:/` になる。
- [ ] **Step 2: テストが失敗することを確認する**
  - Run: `node --test test/security-baseline.test.mjs`
  - Expected: FAIL（モジュールがない）
- [ ] **Step 3: rules と handler の骨組み、exposure を実装する**
  - 判定条件は仕様書5.1の表のとおり。
  - wp-config のバックアップは `wpPath` 基準で `.bak`、`.old`、`.orig`、`.save`、`~`、`.txt` の6件。
  - `.git`、`.env` は origin のルート基準。debug.log は `wpPath+'wp-content/debug.log'`。uploads は `wpPath+'wp-content/uploads/'`。
  - 最初に存在しないパス `/wpqa-baseline-<乱数>.txt` を1件取得する。その応答にもルールの特徴が一致した場合は、そのルールを判定不能として `unchecked` に入れる。
- [ ] **Step 4: テストが通ることを確認する**
  - Run: `node --test test/security-baseline.test.mjs`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: security-baseline検査の骨組みと機密ファイル露出の確認"`

### Task 4: headers・mixed・disclosure

**Files:**
- Modify: `lib/checks/security-baseline.mjs`、`lib/security-baseline-rules.mjs`
- Modify: `lib/checks/standard.mjs:29`（`insecure script URL` の判定を削除する。`actual.scope` の文に「混在コンテンツは auto-security-active-mixed で確認」と追記する）
- Test: `test/security-baseline.test.mjs`、`test/standard-automation.test.mjs`（既存の期待値に影響があれば合わせて直す）

**Interfaces:**
- Consumes: Task 3 の handler 内部の補助関数と `RULES`。
- ルールIDは次のとおり。
  - headers（caution）：`missing-hsts`、`missing-csp`、`missing-nosniff`、`missing-frame-protection`、`missing-referrer-policy`、`cookie-missing-secure`、`cookie-missing-httponly`、`cookie-missing-samesite`、`passive-mixed-content`
  - mixed（problem）：`active-mixed-content`
  - disclosure（caution）：`wp-version-exposed`、`server-version-exposed`、`rest-user-enumeration`、`author-enumeration`、`xmlrpc-enabled`

- [ ] **Step 1: 失敗するテストを書く**
  - `headers reports each missing header as caution`：ヘッダーがないfixtureでは、上の9ルールのうちCookie系とmixed以外の5件が出て、run が reject される。必要なヘッダーがそろったfixtureでは resolve する。
  - `frame-ancestors in CSP satisfies frame protection`：CSPに `frame-ancestors` があれば、`missing-frame-protection` は出ない。
  - `hsts only judged on https`：`http://127.0.0.1` のfixtureでは、`missing-hsts` を出さない。
  - `active vs passive mixed content`：HTTPSページの `http:` script・iframe・form action・stylesheet は `active-mixed-content`（mixed）、img は `passive-mixed-content`（headers）になる。テストでは `inspectMixed(html,pageURL)` を直接呼ぶ。
  - `disclosure detects generator, readme version, server header, users json, author redirect, xmlrpc get`：証拠にユーザー名の文字列が含まれず、`observation` に件数だけが入る。
  - `disclosure is clean on soft-404 html`：soft 404モードでは findings が0件。
  - `wpPath subdirectory is used for readme and xmlrpc`：`wpPath:'/wp/'` のとき、fixtureへのリクエストが `/wp/readme.html` と `/wp/xmlrpc.php` になる。
  - `standard integrations no longer reports insecure script URL`
- [ ] **Step 2: テストが失敗することを確認する**
  - Run: `node --test test/security-baseline.test.mjs test/standard-automation.test.mjs`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
  - `export function inspectMixed(html:string,pageURL:string):{active:string[],passive:string[]}` を作る。単体テストのために export する。
  - disclosure の取得先は次のとおり。`?author=1` は Location ヘッダーだけを見る。
    - `paths[0]`（generator、Server、X-Powered-By、`ver=`）
    - `wpPath+'readme.html'`
    - `paths[0]+'feed/'`
    - `paths[0]+'wp-json/wp/v2/users'`
    - `paths[0]+'?author=1'`
    - `wpPath+'xmlrpc.php'`
- [ ] **Step 4: テストが通ることを確認する**
  - Run: `node --test test/security-baseline.test.mjs test/standard-automation.test.mjs test/core.test.mjs`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: ヘッダー・混在コンテンツ・情報露出の基礎診断"`

### Task 5: transport（HTTPS転送・証明書）

**Files:**
- Create: `lib/tls-certificate.mjs`
- Modify: `lib/checks/security-baseline.mjs`、`lib/security-baseline-rules.mjs`
- Test: `test/tls-certificate.test.mjs`（新規）、`test/security-baseline.test.mjs`

**Interfaces:**
- Produces:
  - `evaluateCertificate({validTo:Date, authorized:boolean, authorizationError?:string, hostnameError?:string}, now:Date) -> string[]`
    - 戻り値はルールIDの配列：`cert-expired`、`cert-expiring`（残り14日未満）、`cert-untrusted`、`cert-hostname-mismatch`
  - `inspectCertificate(host:string, port:number, {proxy?:string, timeoutMs:number, signal?}) -> Promise<{validTo:Date, authorized, authorizationError, hostnameError}>`
    - `proxy`（`process.env.WPQA_EGRESS_PROXY`）がある場合は、`http.request({method:'CONNECT'})` で得たソケットの上で `tls.connect({socket,servername:host,rejectUnauthorized:false})` を行う。
    - ない場合は直接 `tls.connect` する。
    - ホスト名の確認には `tls.checkServerIdentity` を使う。
    - `rejectUnauthorized:false` にするのは、証明書が不正な場合も内容を観測して `cert-untrusted` と報告するため。このソケットではハンドシェイク後に `getPeerCertificate()` と `authorized` を読むだけで、データは一切送らず、すぐ `destroy()` する。HTTPリクエストやCookieをこの接続に流すことは禁止する。ほかのコードで同じ設定を流用しない。
- ルールID：`https-not-enforced`（http が https の同じホストへ転送されない）、`site-http-only`（local 以外で baseURL が http）、および上の証明書系ルール。すべて problem。

- [ ] **Step 1: 失敗するテストを書く**
  - `evaluateCertificate thresholds`：残り13日なら `cert-expiring`、15日なら空配列、-1日なら `cert-expired`。`authorized:false` なら `cert-untrusted`、`hostnameError` があれば `cert-hostname-mismatch`。
  - `transport flags missing https redirect`：http のfixtureが200を返すと `https-not-enforced` になる。`https://同じhost/` への301なら出ない。別ホストへの301なら出る。
  - `egress denied header becomes BLOCKED`：http の応答が `403` で `x-wpqa-egress: denied` を持つと、`/BLOCKED:.*接続先/` で reject される。
  - `transport stays within 4 requests`
- [ ] **Step 2: テストが失敗することを確認する**
  - Run: `node --test test/tls-certificate.test.mjs test/security-baseline.test.mjs`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
  - transport は `baseURL` が https のときに証明書を確認する。
  - HTTPS転送の確認は `http://`+host+`/` を1件取得し、必要なら Location の1段だけを確認する。local 環境で baseURL が http の場合は、HTTPS関連のルールを出さない。
  - `inspectCertificate` の実通信は単体テストの対象外とし、`run` に `tlsInspector` を注入できるようにしてテストする。引数名は `run({...,tlsInspector=inspectCertificate})`。
- [ ] **Step 4: テストが通ることを確認する**
  - Run: `node --test test/tls-certificate.test.mjs test/security-baseline.test.mjs`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: HTTPS転送と証明書の基礎診断"`

### Task 6: 「注意」の結果表現と説明文

**Files:**
- Modify: `lib/config.mjs:116`（check の行に、`check.kind==='security-baseline'&&!check.required` のとき `level:'caution'` を付ける）
- Modify: `lib/results.mjs`
  - `export function displayStatus(row)` を作る。`level==='caution'&&status==='fail'` なら `'caution'` を返し、それ以外は `row.status` を返す。
  - `writeReport` の `summary.caution` を追加する。これは caution かつ fail の件数で、`summary.fail` は今のままにする。
  - report.html の結果列を `displayStatus` で表示し、`caution` 用のCSSクラスを追加する。
- Modify: `lib/failure-explanations.mjs`
  - `schema==='security-baseline-v1'` の findings を、`RULES` から `add('baseline:'+rule+':'+path, title, observation, admin, impact, code)` に変換する。
  - `add` に任意の引数 `verify` を追加し、ルールの `verify` を渡す。
- Modify: `lib/issue-report.mjs:3,100`、`lib/designer-report.mjs:6,218`（labels に `caution:'注意'` を追加し、`labels[displayStatus(row)]` に変える）
- Modify: `lib/site-exam.mjs`（課題一覧で、caution の行に「注意」と明示する。`unresolvedSecurity` の判定は変えない）
- Test: `test/security-baseline-results.test.mjs`（新規）

**Interfaces:**
- Produces: `displayStatus(row) -> 'caution'|row.status`（`lib/results.mjs`）。UI（Task 8）は同じ規則を `ui/public/app.js` に複製する。

- [ ] **Step 1: 失敗するテストを書く**
  - `caution rows are counted separately`：required の fail が1件、caution の fail が2件のとき、`writeReport` の結果が `summary.fail===3` かつ `summary.caution===2` になる。report.html に `注意` が2回出る。
  - `releaseGate ignores caution rows`：caution の fail があっても、ほかが合格なら `releaseGate` は true。
  - `caution only for security-baseline`：`required:false` の `standard-public` の行には level が付かない。
  - `baseline findings become explained failures`：`explainFailure` が、証拠の rule ごとに title・impact・admin・code・verify を持つ項目を返す。key は `baseline:` で始まる。
  - `issue report labels caution`
- [ ] **Step 2: テストが失敗することを確認する**
  - Run: `node --test test/security-baseline-results.test.mjs`
  - Expected: FAIL
- [ ] **Step 3: 上の Files に書いた各箇所を実装する**
- [ ] **Step 4: テストが通ることを確認する**
  - Run: `node --test test/security-baseline-results.test.mjs test/failure-explanations.test.mjs test/issue-report.test.mjs test/designer-report.test.mjs test/site-exam.test.mjs test/results-write.test.mjs`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 基礎診断の注意レベル表示と説明文"`

### Task 7: 検査の自動生成と実行前の追加

**Files:**
- Modify: `ui/public/case-generator.js:276`（`addSecurityChecks(c,adminPath)` の中で `auto-security-*` の5件も追加する）
- Modify: `ui/public/options-form.js`、`ui/public/coverage-editor.js`（`security-baseline` のフォーム定義と既定の suite `authz` を追加する。手入力の設定画面で扱えるようにするため）
- Test: `test/case-generator.test.mjs`

**Interfaces:**
- Consumes: Task 3 の `validate` の options の形。
- 生成する内容は次のとおり。
  - id：`auto-security-exposure`、`auto-security-transport`、`auto-security-active-mixed`、`auto-security-headers`、`auto-security-disclosure`
  - required：先頭3件は true、headers と disclosure は false
  - suite：`authz`、timeoutMs：`120000`
  - options：`{area, paths:(c.pages??[]).slice(0,5).map(p=>p.path) が空なら ['/'], wpPath:adminPath.replace(/wp-admin\/$/,'')}`
  - 同じ id がすでにあれば追加しない。
- 実行前の追加は、既存の `ui/server.mjs:487` の `addSecurityChecks` 呼び出しでそのまま実現される。外部JSONのサイトは `p.managed` が false なので対象外になる。

- [ ] **Step 1: 失敗するテストを書く**
  - `addSecurityChecks adds five baseline checks once`：2回呼んでも5件だけ。`required` の組み合わせと、`wpPath`（`adminPath:'/wp/wp-admin/'` なら `'/wp/'`）を確認する。
  - `generated baseline checks pass validateConfig`
  - `existing custom auto-security check is not overwritten`
- [ ] **Step 2: テストが失敗することを確認する**
  - Run: `node --test test/case-generator.test.mjs`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: テストが通ることを確認する**
  - Run: `npm test`
  - Expected: PASS（全件）
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 基礎診断5件を登録時・実行前に自動追加"`

### Task 8: UI（登録・設定・結果表示）

**Files:**
- Modify: `ui/public/registration.js:35,88,106-107,123`
  - チェックボックス `sensitivePaths` を追加する。表示名は「機密ファイル露出の確認（存在確認のみ。顧客の監視に検知される場合があります）」。
  - `policy()` で本番に切り替えたときは未選択にするが、無効化（disabled）はしない。検証・ローカルに切り替えたときは選択済みにする。
- Modify: `ui/public/settings.js`（同じ項目を設定画面に追加し、`config.allowSensitivePaths` に反映する）
- Modify: `ui/public/preparation-wizard.js`（`'auto-security-exposure':['sensitivePaths']` を追加し、ラベルの対応表にも追加する）
- Modify: `ui/public/app.js:27,95-96,101,232`
  - `names.caution='注意'` を追加する。
  - `displayStatus` を、preparation・running の判定のあとに caution を返すよう変える。
  - グループの状態の優先順で、`caution` を `review` の後に置く。
  - 履歴ラベルと集計表示で、`summary.fail-(summary.caution??0)` を不合格として使い、注意の件数を別に出す。
- Modify: `ui/public/index.html`（集計欄に `#metric-caution` を追加する）
- Modify: `ui/public/style.css`（`.pill.caution`。既存の黄色系とは区別できる色にする）
- Test: `test/ui-browser.mjs`、`test/registration-browser.mjs`（既存のブラウザーテストにケースを追加する）

- [ ] **Step 1: 失敗するテストを書く**
  - registration-browser：`production selection unchecks but keeps sensitivePaths enabled`、`staging selection checks sensitivePaths`
  - ui-browser：caution の行を含む results.json のfixtureを表示すると、バッジが `注意` になり、`#metric-caution` が件数を示し、不合格の件数に caution が含まれない。
- [ ] **Step 2: テストが失敗することを確認する**
  - Run: `npm run test:registration` と `npm run test:ui`
  - Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: テストが通ることを確認する**
  - Run: `npm run test:registration`、`npm run test:ui`、`npm run test:settings`、`npm run test:site-exam-ui`
  - Expected: PASS
- [ ] **Step 5: コミットする**
  - `git commit -m "feat: 基礎診断の許可設定と注意表示をUIに追加"`

### Task 9: 文書の更新と全体の検証

**Files:**
- Modify: `deploy/internal-announcement/SITE-EXAM-specification.md`
  - 2.1 に「セキュリティ基礎診断（認証なし）」の行を追加する。
  - 3 には、能動的な探索をしないことを書く。
  - 4.3 に `sensitivePaths` を追加する。
  - 7 に「注意」を追加する。
  - 付録A に5件を追加する。
  - 付録C に新しいファイルを追加し、変更したファイルのSHA-256を更新する。
- Modify: `deploy/user-manual.html`（基礎診断の見方、「注意」の意味、本番での許可について説明する）
- Modify: `docs/superpowers/specs/2026-11-02-security-baseline-design.md`（状態を「実装済み」にする）

- [ ] **Step 1: 文書を更新する**（SHA-256 は `sha256sum <file>` で計算する）
- [ ] **Step 2: 全体を検証する**
  - Run: `npm test`、`npm run test:integration`、`npm run test:ui`、`npm run test:registration`、`npm run test:settings`、`npm run test:site-exam-ui`、`npm run test:hardening`
  - Expected: すべて PASS。失敗した場合は出力をそのまま報告する。
- [ ] **Step 3: デモサーバーで動作を確認する**
  - `npm run demo` で起動したローカルデモに対して基礎診断5件を実行する。
  - 結果画面で、兆候あり・注意・合格の表示と説明文を目で確認する。
- [ ] **Step 4: コミットする**
  - `git commit -m "docs: 基礎診断を仕様書・操作マニュアルに反映"`
