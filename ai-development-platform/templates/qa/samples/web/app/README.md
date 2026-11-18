# 備品貸出アプリ（見本・架空）

`requirements.md` を実装した、依存のない Node.js 製の小さな Web アプリです。QA Skill の動作確認に使います。旧版と新版を別のポートで動かせます。

## 起動

```
node templates/qa/samples/web/app/server.mjs --version old --port 4101
node templates/qa/samples/web/app/server.mjs --version new --port 4102
```

- `--version` は `old` か `new`。省略できません。
- `--port` を省くと、旧版は 4101、新版は 4102 を使います。`0` を渡すと空いているポートを選びます。
- 起動すると標準出力に `listening http://localhost:ポート番号` を 1 行出します。`SIGTERM` で終了します。

## 環境変数

ユーザー名とパスワードは環境変数から読みます。既定値はなく、1 つでも未設定だと終了コード 1 で起動を断ります。名前は `knowledge/sample-web/profile.md` の `roles` と同じです。

| ロール | ユーザー名 | パスワード |
| --- | --- | --- |
| staff（貸出 51 件以上、備考あり・なし） | `SAMPLE_STAFF_USER` | `SAMPLE_STAFF_PASSWORD` |
| staff-fifty（貸出ちょうど 50 件） | `SAMPLE_STAFF_FIFTY_USER` | `SAMPLE_STAFF_FIFTY_PASSWORD` |
| staff-empty（貸出 0 件） | `SAMPLE_STAFF_EMPTY_USER` | `SAMPLE_STAFF_EMPTY_PASSWORD` |
| staff-other（貸出数件） | `SAMPLE_STAFF_OTHER_USER` | `SAMPLE_STAFF_OTHER_PASSWORD` |
| admin | `SAMPLE_ADMIN_USER` | `SAMPLE_ADMIN_PASSWORD` |

ユーザー名は互いに異なる値にしてください。

## 作り

- データはメモリ上にあり、起動のたびに `seed.mjs` の `seed()` から作り直します。
- セッションは HttpOnly、SameSite=Lax の Cookie とメモリ上の表で持ちます。
- 権限はすべてサーバー側で判定します。画面のボタンの表示とは別です。
- 画面の要素には `data-testid` を付けてあります。
