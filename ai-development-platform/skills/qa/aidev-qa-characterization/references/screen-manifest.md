# 画面マニフェストの形式

画面マニフェストは、1つの画面について「何を記録し、何を記録しないか」を決めた表である。記録の範囲を担当者の裁量にしないため、そして完全性（すべての項目に証跡があるか）を機械的に数えるための分母にするために作る。

置き場所は QA リポジトリの `automation/web/manifests/<画面>.json` で、画面ごとに1ファイルにする。WebView2 に表示する画面も同じ場所に置く。ファイル名の `<画面>` は英小文字、数字、ハイフンで書き、TC-ID の機能名とそろえると追いやすい。マニフェストはコミットする。証跡と違い、資格情報や個人情報を書かないので、リポジトリに入れてよい。テストデータの値（実在の人の氏名、社員番号のような番号）も書かず、データの条件だけを書く。

## 例

```json
{
  "screen": "loans-list",
  "title": "貸出の一覧",
  "path": "/loans",
  "sources": ["src/pages/loans/List.vue", "src/api/loans.ts"],
  "observedBuild": {
    "environment": "old",
    "checkedAt": "2026-11-18T10:20:00+09:00",
    "version": "画面の右下の版の表示",
    "observedApis": ["API-01", "API-02"],
    "mismatch": null
  },
  "roles": [
    { "name": "staff", "reachable": true },
    { "name": "admin", "reachable": true },
    { "name": "guest", "reachable": false, "reason": "ルートのガードでログイン画面へ戻る" }
  ],
  "displayModes": [
    { "name": "貸出中", "how": "タブ「貸出中」（初期表示）" },
    { "name": "返却済み", "how": "タブ「返却済み」" }
  ],
  "operations": [
    {
      "id": "OP-01", "name": "一覧の初期表示", "kind": "display",
      "depth": "full", "risk": "high", "requiredInputs": false,
      "apis": ["API-01"],
      "cases": [
        { "tc": "TC-loans-001", "role": "staff", "mode": "貸出中" },
        { "tc": "TC-loans-002", "role": "admin", "mode": "貸出中" },
        { "tc": "TC-loans-003", "role": "staff", "mode": "返却済み" }
      ],
      "uncovered": [{ "role": "admin", "mode": "返却済み", "reason": "admin の返却済みは貸出中と同じ分岐で、表示の列も同じ（List.vue の v-if を確認）" }],
      "testDataSource": "existing"
    },
    {
      "id": "OP-02", "name": "貸出の登録", "kind": "create",
      "depth": "full", "risk": "normal", "requiredInputs": true,
      "apis": ["API-02"],
      "cases": [
        { "tc": "TC-loans-010", "role": "staff", "mode": "必須あり" },
        { "tc": "TC-loans-011", "role": "staff", "mode": "必須なし" }
      ],
      "testDataSource": "self-created",
      "testDataNote": "接頭辞 QA-<run-id>- の備品名で登録し、最後のケースで削除する"
    }
  ],
  "apis": [
    {
      "id": "API-01", "kind": "rest",
      "match": { "method": "GET", "path": "/api/loans" },
      "matchByEnvironment": {},
      "callSites": [
        { "at": "src/pages/loans/List.vue:42", "trigger": "初期表示とタブの切り替え", "reachable": true,
          "expectAt": [{ "tc": "TC-loans-001", "checkpoint": "01-initial", "min": 1 }] }
      ]
    },
    {
      "id": "API-02", "kind": "graphql",
      "match": { "operationName": "createLoan" },
      "matchByEnvironment": {},
      "callSites": [
        { "at": "src/pages/loans/New.vue:88", "trigger": "登録ボタン", "reachable": true,
          "expectAt": [{ "tc": "TC-loans-010", "checkpoint": "02-saved", "min": 1 },
                       { "tc": "TC-loans-011", "checkpoint": "02-error", "max": 0 }] }
      ]
    }
  ],
  "reports": [
    {
      "id": "RP-01", "name": "一覧の CSV", "format": "csv",
      "match": { "method": "GET", "path": "/loans.csv" },
      "matchByEnvironment": {},
      "depth": "full", "risk": "high",
      "cases": [{ "tc": "TC-loans-020", "role": "admin", "mode": "全件" }]
    }
  ],
  "acceptedRisks": [],
  "excluded": [
    { "target": "loadLegacyStats", "reason": "dead-code", "evidence": "List.vue と子の部品のどこからも呼ばれていない（参照の検索で 0 件）" },
    { "target": "一覧の自動更新（30 秒ごと）", "reason": "hard-to-record", "evidence": "setInterval による再取得。時刻に依存する" },
    { "target": "印刷ボタン", "reason": "native-required", "evidence": "OS の印刷ダイアログを開く", "handoff": "aidev-qa-desktop-gui" }
  ],
  "pending": [],
  "noTargetsReason": null
}
```

## 項目

画面の情報は次のとおり。

- `screen`：画面の識別子。ファイル名と同じにする
- `title`、`path`：画面の名前と、到達する URL のパス（WebView2 なら画面のルート）
- `sources`：読んだソースのファイル。ソースの場所はプロファイルの本文か作業者の指示による
- `observedBuild`：動いている版の確認（SKILL.md の進め方の2）の結果。モックなしで操作したときに実際に送られた API と、ソースとの食い違い（`mismatch`）を書く。食い違いがあれば、正とした版（参照したコミットなど）も書く
- `roles`：プロファイルの `roles` のうち、この画面に関係するもの。到達できないロールは `reachable: false` と理由を書く
- `displayModes`：ロールに依存しない表示の切り替え（タブ、ラジオボタン、表示件数の切り替えなど）。ない画面は空の配列にする

記録の対象は `operations`（画面の操作）と `reports`（帳票）に書く。

- `id`：画面の中で一意の ID。ケースや証跡から参照する
- `kind`：`display`、`search`、`dialog`、`create`、`update`、`delete` など
- `depth`：`light` か `full`。迷ったら `full`
- `risk`：`high`、`normal`、`low`。個人情報や担当範囲の判定に触れる操作は `high`
- `requiredInputs`：必須入力のあるフォームなら `true`。`true` なら「必須あり」と「必須なし」のケースが両方要る
- `apis`：その操作が呼ぶ API の ID
- `cases`：ケースと、そのケースのロールと表示モード。`tc` は `cases/<機能>.md` の TC-ID
- `uncovered`：ロールと表示モードの組み合わせのうちケースを付けないものと、その理由。理由のない組み合わせを残さない
- `testDataSource`：`existing`（既存のアカウントとデータ）か `self-created`（このために用意した）。後者なら `testDataNote` に用意した内容を書く

`reports` の `match` は、帳票のダウンロードの URL のパス（または操作名）である。帳票のない画面では空の配列にする。

### API の母数（apis）

`apis` は、ケースの網羅とは別の母数で、「画面が呼ぶ API がすべて、画面の操作で適切に呼ばれたか」を確かめるために使う。

- `kind`：`rest`、`graphql` など
- `match`：記録した環境で応答を捕まえる条件。REST は `method` と `path`、GraphQL は `operationName`。テストはこの値を読み、コードに直接書かない
- `matchByEnvironment`：記録した環境と別の環境で名前が変わった場合の条件を、プロファイルの環境名ごとに書く（例 `{"new": {"operationName": "listLoans"}}`）。記録の時点では空でよく、分かっていない名前を推測で埋めない。1つの API が分かれた場合は配列、複数が1つにまとまった場合は各項目に同じ条件を書く。改修後に aidev-qa-regression-compare が埋める
- `callSites`：同じ API でも呼び出し箇所が複数あれば分ける。`at` はファイルと行、`trigger` は呼ばれるきっかけ（画面の表示、ボタン、ダイアログを開いたとき、入力したときの照会）。この画面から届かない呼び出し箇所は `reachable: false` と根拠を書く
- `expectAt`：その呼び出し箇所を呼ぶケースと checkpoint、最小の回数（`min`）か最大の回数（`max`。呼ばれないことを確かめるなら 0）

テストは条件を次の順で決める。実行している環境の名前が `matchByEnvironment` にあればそれを使い、なければ `match` を使う。`match` を無条件に新しい名前で上書きすると、記録した環境に流したときに待ち続けて壊れる。

API を呼ばない画面（サーバーで HTML を組み立てる画面など）では `apis` を空の配列にし、`noApisReason` に理由（ソースを追った結果）を書く。

ダイアログの中のダイアログ、コードを入れたときの照会、選択肢の読み込みは、ボタン1つ奥にあって抜けやすい。対応するケースのない呼び出し箇所があれば、それを呼ぶ操作のケースを足す。

### 既知のリスク（acceptedRisks）

既知の認可の不具合を、承認のうえで記録の対象にするときに書く。`operations` と同じくテストを作って記録するが、テスト名かコメントに既知のリスクであることを書き、区別できるようにする。

```json
{
  "target": "担当外の貸出の詳細が開ける",
  "evidence": "設計書 5章 既知の課題 #7",
  "decision": "リリースを優先し、是正は次の段階で行う",
  "decidedBy": "承認者の名前",
  "decidedDate": "2026-11-18",
  "fixPlan": "次の段階の改修で是正する",
  "cases": ["TC-loans-030"]
}
```

`decidedBy` と `decidedDate` を空のままコミットしない。承認がなければ `excluded` にする。

### 除外（excluded）

`reason` は次のどれかにし、`evidence` に具体的な根拠（検索の結果、設計書の節、ソースの行）を書く。「確認済み」のような感想は根拠にならない。

| reason | 内容 |
|---|---|
| `dead-code` | どこからも呼ばれていない |
| `known-authz-bug` | 既知の認可の不具合。検証は aidev-qa-authz-test に回す |
| `hard-to-record` | タイミングや外部の要因に依存し、標準の待ち方では安定しない |
| `native-required` | OS のダイアログ、外部アプリ、IME など。`handoff` に `aidev-qa-desktop-gui` と書く |
| `external-side-effect` | メールの送信、外部への連携など、取り消せない書き込みを伴う |

`pending` には、開発者の答えを待っている「要確認」の項目を、質問の内容と一緒に書く。`pending` が空でないマニフェストは未完成である。

`noTargetsReason` はいつも書く。普通は `null` で、`operations` と `reports` がどちらも空になる画面だけ理由を書く。該当のない配列やキーを省かず、空の配列か `null` を書く。省くと、書き忘れと該当なしの区別がつかない。

## 完全性の数え方

マニフェストを分母にして、次をスクリプトで数える。手で数えない。

- `operations`、`reports`、`acceptedRisks` の各ケースに、`runs/<YYYYMMDD>-<run-id>/evidence/<TC-ID>/` があり、スクリーンショットが1枚以上ある
- 内部データ（API の応答か、構造化した表示値）が、ケースごとに保存されている
- `reports` のケースに、帳票のファイルが保存されている
- `apis` の届く呼び出し箇所ごとに、`expectAt` があり、実行の記録で回数を満たし、状態が 200 台で、応答にエラーがない

数えた結果は result.md の末尾か作業者への返答に、ケースごとの表で書く。画面ごとの合計のファイル数で判断しない。あるケースで増えたファイルが、別のケースの欠落を隠す。
