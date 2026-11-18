# 認可の表の形式とテストの書き方

認可の表（`automation/web/authz/<機能>.json`）を作るとき、読むとき、表からテストを書くときに読む。行の作り方の判断は SKILL.md の「期待の表を作る」にあり、ここでは形式と書き方を扱う。

## 置き場所と単位

- 置き場所は QA リポジトリの `automation/web/authz/<機能>.json` で、機能ごとに1ファイルにする。`<機能>` は英小文字、数字、ハイフンで書き、末尾を `-authz` にする。表のファイル名、`area`、ケースのファイル `cases/<機能>.md`、テスト `automation/web/tests/<機能>.spec.ts`、TC-ID の機能名で同じ名前にする。例では `expenses-authz` で、TC-ID は `TC-expenses-authz-001` の形になる。aidev-qa-test-design や aidev-qa-characterization のケースと同じ名前にせず、既存のファイルを上書きしない（SKILL.md の「入力と出力」）
- 単位は画面ではなく操作である。同じ操作を複数の画面が呼ぶなら、表の操作は1つで、`calledFrom` に画面を並べる
- 表はコミットする。資格情報、Cookie、トークン、個人情報、実在のデータの ID は書かない。対象は `targets` の名前で指し、実際の ID はテストの実行時に作るか探す
- ケースの正本は `cases/<機能>.md` で、表の行の `tc` はそこにある TC-ID と一致させる。行を足したらケースも足す

## 例

```json
{
  "area": "expenses-authz",
  "title": "経費の申請",
  "sources": ["plan/acceptance.md", "基本設計書 5.3 権限の表"],
  "scope": {
    "included": ["OP-01", "OP-02", "OP-03", "OP-04", "OP-05"],
    "deferred": [
      { "operation": "勘定科目の一覧", "reason": "全ロールに全件を許すマスタで、個人のデータを含まない" }
    ]
  },
  "roles": ["applicant", "applicant-other", "approver", "accountant", "anonymous"],
  "targets": [
    { "id": "own-1", "description": "applicant が作った申請", "how": "setup で applicant が作る。件名に QA-<run-id>-own-1", "marker": "件名" },
    { "id": "other-1", "description": "applicant-other が作った申請", "how": "setup で applicant-other が作る。件名に QA-<run-id>-other-1", "marker": "件名" },
    { "id": "other-write-1", "description": "applicant-other が作った、書き込みの拒否の行の専用の申請", "how": "setup で applicant-other が作る。件名に QA-<run-id>-other-write-1。参照の行では使わない", "marker": "件名" },
    { "id": "missing", "description": "存在しない申請", "how": "accountant の一覧に出る最大の ID より大きい値" }
  ],
  "operations": [
    { "id": "OP-01", "name": "申請の詳細", "kind": "read", "priority": "high", "request": { "method": "GET", "path": "/api/expenses/{target}" }, "calledFrom": ["申請の詳細画面"] },
    { "id": "OP-02", "name": "申請の一覧", "kind": "list", "priority": "high", "request": { "method": "GET", "path": "/api/expenses?applicant={param}" }, "calledFrom": ["申請の一覧画面"] },
    { "id": "OP-03", "name": "申請の CSV 出力", "kind": "export", "priority": "high", "request": { "method": "GET", "path": "/api/expenses/export.csv" }, "calledFrom": ["申請の一覧画面（accountant だけにボタン）"] },
    { "id": "OP-04", "name": "申請の更新", "kind": "update", "priority": "high", "request": { "method": "PUT", "path": "/api/expenses/{target}", "body": { "title": "QA-<run-id>-changed" }, "csrf": "meta" }, "calledFrom": ["申請の編集画面"] },
    { "id": "OP-05", "name": "申請の作成", "kind": "create", "priority": "high", "request": { "method": "POST", "path": "/api/expenses", "body": { "title": "QA-<run-id>-forced", "applicant": "{param}" }, "csrf": "meta" }, "calledFrom": ["申請の新規画面"] }
  ],
  "rows": [
    {
      "tc": "TC-expenses-authz-001", "op": "OP-01", "role": "applicant", "target": "own-1", "ownership": "own",
      "expected": "allow", "verify": { "status": 200, "mustContain": ["own-1"] },
      "basis": "AC-031", "baseline": "allow",
      "failsIfChanged": "本人の申請まで拒否する判定にすると、200 にならず失敗する"
    },
    {
      "tc": "TC-expenses-authz-002", "op": "OP-01", "role": "applicant", "target": "other-1", "ownership": "others",
      "expected": "deny", "verify": { "status": [403], "mustNotContain": ["other-1"], "control": "TC-expenses-authz-003" },
      "basis": "AC-032", "baseline": "allow",
      "failsIfChanged": "詳細の取得で所有者の比較を外すと、other-1 の件名が本文に出て失敗する"
    },
    {
      "tc": "TC-expenses-authz-003", "op": "OP-01", "role": "accountant", "target": "other-1", "ownership": "all",
      "expected": "allow", "verify": { "status": 200, "mustContain": ["other-1"] },
      "basis": "AC-033", "baseline": "allow",
      "failsIfChanged": "accountant を拒否する判定にすると失敗する。002 の目印の対照"
    },
    {
      "tc": "TC-expenses-authz-004", "op": "OP-02", "role": "applicant", "param": "applicant-other", "ownership": "others",
      "expected": "deny-filtered", "verify": { "status": 200, "mustContain": ["own-1"], "mustNotContain": ["other-1"] },
      "basis": "AC-034", "baseline": "未確認",
      "failsIfChanged": "一覧の条件に本人の絞り込みを掛けず、パラメータの申請者をそのまま使うと other-1 が出て失敗する"
    },
    {
      "tc": "TC-expenses-authz-005", "op": "OP-03", "role": "applicant", "ownership": "none",
      "expected": "deny", "verify": { "status": [403], "mustNotContain": ["own-1", "other-1"], "control": "TC-expenses-authz-006" },
      "basis": "AC-035", "baseline": "allow",
      "failsIfChanged": "CSV の出力でロールの判定を外すと、200 と件名の行が返って失敗する"
    },
    {
      "tc": "TC-expenses-authz-007", "op": "OP-04", "role": "applicant", "target": "other-write-1", "ownership": "others",
      "expected": "deny", "verify": { "status": [403], "mustNotContain": ["other-write-1"], "reread": { "as": "applicant-other", "op": "OP-01", "unchanged": ["title", "amount"] } },
      "basis": "AC-036", "baseline": "未確認",
      "resolvesKnownIssue": "expense-edit#担当外の申請を更新できる",
      "failsIfChanged": "更新で既存の記録の所有者を比べないと、other-write-1 の件名が書き換わり、読み直しで失敗する"
    },
    {
      "tc": "TC-expenses-authz-008", "op": "OP-05", "role": "applicant", "param": "applicant-other", "ownership": "others",
      "expected": "forced-owner", "verify": { "status": [201, 302, 303], "owner": "applicant", "reread": { "as": "accountant", "op": "OP-01" } },
      "basis": "AC-037", "baseline": "未確認",
      "failsIfChanged": "作成で本文の申請者をそのまま使うと、作られた申請の申請者が applicant-other になり、読み直しで失敗する"
    },
    {
      "tc": "TC-expenses-authz-009", "op": "OP-01", "role": "anonymous", "target": "own-1", "ownership": "none",
      "expected": "deny", "verify": { "status": "3xx", "location": "/login", "mustNotContain": ["own-1"] },
      "basis": "AC-030", "baseline": "deny",
      "failsIfChanged": "詳細の API に認証の要求を付け忘れると、ログイン画面への転送にならず失敗する"
    }
  ],
  "uncovered": [
    { "op": "OP-04", "role": "approver", "reason": "approver が担当外の部署の申請を持つテストデータを作れない。データの管理者に依頼中" }
  ]
}
```

例は行を一部だけ載せている。書き込みの拒否の行（007）は、参照の行（002、003）と別の対象 `other-write-1` を使う。書き込みの不具合で other-1 の件名が変わると、002 の「目印がない」が何も確かめずに通るためである。008 は、作成で申請者に他人を指定しても、作られた申請の申請者が本人になること（`forced-owner`）を確かめる。更新や削除の操作がないアプリでは、書き込みの拒否はこの形の行で確かめる。009 は、転送の状態コードを 3xx のどれでもよいとし、転送先のパスで判定する。実際の表では、操作とロールの組のうち行を作らないものを `uncovered` に理由付きで書き、行と `uncovered` で組をすべて覆う。

## 項目

最上位の項目は次のとおり。

| 項目 | 内容 |
|---|---|
| `area` | 機能名。ファイル名、`cases/` のファイル名、テストのファイル名、TC-ID の機能名と同じにする |
| `sources` | 期待の根拠にした文書 |
| `scope` | 対象にした操作（`included`）と、後回しにした操作と理由（`deferred`） |
| `roles` | 表に出るロール。プロファイルの `roles` の name と `anonymous`（未ログイン）。属性で期待が変わるロールは分けてプロファイルに載せる |
| `targets` | 行レベルの行で使う対象。`how` に作り方か探し方、`marker` に本文で探す目印の項目を書く。値は書かない。書き込みの拒否の行の対象は、参照の行と共有しない |
| `operations` | 操作。`kind` は read、list、export、create、update、delete、action（承認などの状態の変更）。`request` にメソッド、パス、送る本文の形、CSRF のトークンの取り方（`csrf`） |
| `rows` | 1行が1つの TC-ID |
| `uncovered` | 行を作らない操作とロールの組と理由 |

行の項目は次のとおり。

| 項目 | 内容 |
|---|---|
| `tc` | TC-ID。`cases/<機能>.md` のケースと一致させる |
| `op`、`role` | 操作とロール |
| `target`、`param` | 対象（`targets` の id）や、検索の条件に入れる値 |
| `ownership` | 所有の関係。own（本人の分）、others（他人の分）、in-scope（担当の範囲の中）、out-of-scope（範囲の外）、all（全件を見られるロール）、none（対象を取らない操作） |
| `expected` | allow、deny、deny-filtered（応答は返るが、範囲の外のデータが混ざらない）、forced-owner（作成は通るが、サーバーが所有者を本人に置き換える） |
| `verify.status` | 許可なら期待する状態コード。拒否なら設計で決めた状態コードの配列。`forced-owner` なら作成が通ったときの状態コードの配列。ログイン画面への転送のように転送の種類（302、303、307）を問わないときは `"3xx"` と書き、`location` と組にする。広い範囲（「200 以外」）にしない |
| `verify.location` | 転送先のパス。状態コードが 3xx で、転送先のパスがこれと同じときだけ通す。未ログインの行や、作成の後に詳細へ転送する行で使う |
| `verify.owner` | `forced-owner` の行で、作られた記録の所有者になるべきロール。`reread` で読み直した記録の所有者の項目と比べる |
| `verify.mustContain`、`mustNotContain` | 本文で探す目印。`targets` の id で指し、実行時にその対象の `marker` の値に置き換える |
| `verify.control` | 拒否の行の対照になる許可の行の TC-ID。同じ目印がその行の本文に出ることで、目印の検査が効いていることを確かめる |
| `verify.reread` | 書き込みの拒否の後に読み直す。だれ（`as`）がどの操作（`op`）で読み、どの項目が変わっていないこと（`unchanged`）を確かめるか。作成の拒否なら、接頭辞の付いた記録の件数が増えていないことを確かめる。`forced-owner` の行では、作られた記録をだれ（`as`）がどの操作（`op`）で読み、所有者を確かめるかを書く |
| `basis` | 期待の根拠（AC-ID か設計書の節）。ないときは「⚠ 要確認」と書き、行を流す前に作業者に確かめる |
| `baseline` | 今の版で観測した振る舞い（allow、deny、未確認）。期待ではない |
| `failsIfChanged` | この行を失敗させる実装の変更を一文で |
| `resolvesKnownIssue` | 省略できる。この行が確かめる、画面マニフェストの既知の認可の不具合（`excluded` の `reason` が `known-authz-bug` の項目）か `acceptedRisks` の項目。マニフェストの項目には ID がないので、`<画面マニフェストのファイル名から .json を除いたもの>#<項目の target>` の形で、`target` の文字列をそのまま書く（例 `expense-edit#担当外の申請を更新できる` は `automation/web/manifests/expense-edit.json` の項目を指す）。読むときは最初の `#` で2つに分ける。`target` の中に `#` があっても、後ろはすべて `target` である。aidev-qa-screen-verification がこの欄で認可の結果を既知の不具合に結び付ける |

網羅は、行の数と `uncovered` の数を分母にして数える。result.md の「認可の表の集計」は、この表から操作ごとに数える。

## テストの書き方

表を読み、行ごとにテストを生成する。Playwright なら API のリクエストのコンテキストを使う。次は書き方の例で、QA リポジトリの決まりがあればそれに合わせる。

```ts
// automation/web/tests/expenses-authz.spec.ts
import { test, expect, request, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { authFile } from './auth-path';
import table from '../authz/expenses-authz.json';

const env = process.env.QA_ENV;
const baseURL = process.env.QA_BASE_URL;
const runDir = process.env.QA_RUN_DIR;
if (!env || !baseURL || !runDir) throw new Error('QA_ENV、QA_BASE_URL、QA_RUN_DIR を設定してください');

// 設定の workers: 1 で、表の行の順に1つずつ流す。mode: 'serial' は使わない。1つの失敗で後の行がすべて飛ばされる

/** ロールごとの API のコンテキスト。anonymous は storageState を読み込まない */
async function contextFor(role: string): Promise<APIRequestContext> {
  return request.newContext({
    baseURL,
    storageState: role === 'anonymous' ? undefined : authFile(role, env),
    maxRedirects: 0,  // ログイン画面への転送をたどらない
  });
}

/**
 * 状態コードと本文だけを保存する。ヘッダーは保存しない。
 * 本文を残すのは、拒否の行か、対象がテストの作った記録だけの行か、証跡の方式が local か external のとき。
 * それ以外（lfs、既存のデータを返す許可の行）は、見つかった目印の名前と行の件数だけを残す。
 */
const evidenceMethod = process.env.QA_EVIDENCE_METHOD;  // プロファイルの evidence.method
function saveResponse(tc: string, name: string, status: number, body: string, keepBody: boolean, found: string[]) {
  const dir = path.join(runDir!, 'evidence', tc);
  fs.mkdirSync(dir, { recursive: true });
  const record = keepBody ? { status, body } : { status, markersFound: found, lines: body.split('\n').filter(Boolean).length };
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(record, null, 2));
}

for (const row of table.rows) {
  test(`${row.tc} ${row.role} ${row.op} ${row.ownership} は ${row.expected}`, async () => {
    const api = await contextFor(row.role);
    try {
      const res = await send(api, row);            // 表の request と targets から組み立てて送る（CSRF のトークンも付ける）
      const body = await res.text();
      const found = [...(row.verify.mustContain ?? []), ...(row.verify.mustNotContain ?? [])].filter(t => body.includes(markerOf(t)));
      const keepBody = row.expected === 'deny' ? evidenceMethod !== 'lfs' || found.length === 0
        : evidenceMethod === 'local' || evidenceMethod === 'external' || onlySelfCreated(row);
      saveResponse(row.tc, '01-response', res.status(), body, keepBody, found);  // 判定より先に保存する

      if (row.expected === 'allow' || row.expected === 'deny-filtered') {
        expect(res.status()).toBe(row.verify.status);
      } else if (row.verify.status === '3xx') {
        expect(res.status()).toBeGreaterThanOrEqual(300);
        expect(res.status()).toBeLessThan(400);
      } else {
        expect(row.verify.status).toContain(res.status());
      }
      if (row.verify.location) expect(new URL(res.headers()['location'] ?? '', baseURL).pathname).toBe(row.verify.location);
      for (const t of row.verify.mustContain ?? []) expect(body, `${t} の目印が本文にない`).toContain(markerOf(t));
      for (const t of row.verify.mustNotContain ?? []) expect(body, `${t} の目印が本文に出た`).not.toContain(markerOf(t));
      if (row.expected === 'forced-owner') await assertOwner(row);   // 読み直して、所有者が verify.owner になったことを確かめる
      else if (row.verify.reread) await assertUnchanged(row);       // 許可されたロールで読み直し、項目が変わっていないことを確かめる
    } finally {
      await api.dispose();
    }
  });
}
```

`send`、`markerOf`、`onlySelfCreated`、`assertUnchanged`、`assertOwner` は、表の `operations` と `targets` から組み立てる関数で、QA リポジトリの `automation/web/tests/support/` などに置く。`markerOf` は setup が作った対象の目印の値を返す。`onlySelfCreated` は、その行の応答がテストの作った記録だけを返す操作か（詳細で対象がテストの作った記録のとき）を返し、一覧、検索、CSV では偽にする。`QA_EVIDENCE_METHOD` がプロファイルから決まらなければ、流す前に作業者に確かめる。値は実行ごとに作るので、表にもコードにも書かない。

`location` のパスは、判定に使うだけで証跡には書かない。書くときはパスだけにし、クエリを落とす。リターン URL やトークンがクエリに入ることがある。

### 対象の用意と片付け

対象は、表を流す前の setup（`test.beforeAll`）で作る。作るロールで作成の操作を送り、返った ID と目印の値を `.qa-scratch/authz-<area>-<run-id>.json` に書く。setup は、このファイルがあれば作らずに読む。テストが失敗すると Playwright はワーカーを作り直して `beforeAll` を流し直すので、ファイルを読まないと対象が作り直され、後の行が別の対象を見る。ID を `runs/` や表に書かない。`test-results/` に置かない（Playwright が実行のたびに消す）。

片付けは最後に、作ったロールで行う。拒否の行が誤って通って記録を変えた場合も、片付けの前に読み直しの結果を証跡に残す。アプリに削除の操作がなければ片付けの手順を作らず、残った対象の接頭辞と件数を result.md に書く。片付けが終わったら、`.qa-scratch/` のファイルを消す。

### CSRF のトークン

状態の変わる操作を直接送るときは、アプリが画面からの送信に付けるのと同じトークンを付ける。方式は、画面から一度送信してリクエストを観察して決める。

| 方式 | 取り方 |
|---|---|
| フォームの hidden の入力欄 | 同じセッションでフォームの画面を GET し、入力欄の値を取り出して本文に入れる |
| meta タグ | 同じセッションで画面を GET し、meta タグの値をアプリが使う名前のヘッダーに入れる |
| Cookie の値をヘッダーに写す方式 | storageState にある Cookie の値を、アプリが使う名前のヘッダーに入れる。値をログや証跡に出さない |
| トークンを返す API | 同じセッションでその API を呼び、返った値を付ける |

トークンはロールのセッションごとに取る。別のロールのトークンを流用すると、CSRF の検査で拒否され、認可の拒否と区別できない。トークンの扱いが正しいことは、同じ書き方で送った許可の行が通ることで確かめる。トークンの値はテストの出力、証跡、result.md に書かない。

### GraphQL

GraphQL は、操作を1つのエンドポイントに送り、拒否を 200 とエラーの本文で返すことが多い。表の `request` には操作名と変数を書き、パスはエンドポイントにする。

- 拒否は、エラーの分類（`extensions` の code や classification）が認可の拒否を表す値であることと、`data` の対象の項目に内容がないことで判定する。どの値が認可の拒否かは、許可されていないロールで一度送って確かめ、表の `verify` に書く
- `data` が `null` なだけ、エラーが空なだけのものを拒否に数えない。データがないのか拒否されたのか区別できない
- 想定外の種類のエラー（内部エラー、検証エラー）は拒否にしない。別の不具合を疑い、NG の候補にする
- 許可された操作の一覧（persisted queries）を使うサーバーでは、操作の識別子をアプリの正規の一覧から取る。識別子が合わずに一律で拒否されたものを、認可の拒否と数えない
- 入れ子のフィールドから同じデータに届く経路（別の型の関連から辿る）がないかも、操作の洗い出しで見る
