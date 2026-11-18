---
product: sample-web
environments:
  - {name: old, url: http://localhost:4101, purpose: 旧版}
  - {name: new, url: http://localhost:4102, purpose: 新版}
roles:
  - {name: staff, user_env: SAMPLE_STAFF_USER, password_env: SAMPLE_STAFF_PASSWORD}
  - {name: staff-fifty, user_env: SAMPLE_STAFF_FIFTY_USER, password_env: SAMPLE_STAFF_FIFTY_PASSWORD}
  - {name: staff-empty, user_env: SAMPLE_STAFF_EMPTY_USER, password_env: SAMPLE_STAFF_EMPTY_PASSWORD}
  - {name: staff-other, user_env: SAMPLE_STAFF_OTHER_USER, password_env: SAMPLE_STAFF_OTHER_PASSWORD}
  - {name: admin, user_env: SAMPLE_ADMIN_USER, password_env: SAMPLE_ADMIN_PASSWORD}
login: {method: form, entry_url: http://localhost:4101/login}
stack: [node, html-form]
test_commands:
  - {name: e2e, run: npx playwright test}
evidence: {method: local, retention: 90d}
---
# 観点

一覧、詳細、CSV はロールごとに見える範囲が違う。一覧の件数と返却予定日の範囲には境目がある。

# 落とし穴

詳細と CSV の権限はサーバー側で判定する。画面のボタンの表示は、権限の判定とは別に実装されている。

# テストデータ

検証環境の初期データとして、貸出を 51 件以上持つ staff のユーザーと、貸出を 1 件も持たない staff のユーザーを用意してある。別の staff が持つ貸出の ID は、admin で一覧を開いて調べる。

staff は 51 件以上の貸出を持つ。staff-fifty は貸出がちょうど 50 件、staff-empty は 0 件、staff-other は数件である。値は環境変数から読み、このファイルには名前だけを書く。

# 到達手順

http://localhost:4101（旧版）または http://localhost:4102（新版）の /login を開き、フォームでログインする。一覧は /loans、詳細は /loans/貸出ID、登録は /loans/new、CSV は /loans.csv である。

# 起動方法

アプリはこのリポジトリの `templates/qa/samples/web/app/` にある。上の `roles` に書いた環境変数をすべて設定してから、旧版と新版を別々のポートで起動する。1 つでも未設定だと起動しない。

```
node templates/qa/samples/web/app/server.mjs --version old --port 4101
node templates/qa/samples/web/app/server.mjs --version new --port 4102
```

標準出力に `listening http://localhost:ポート番号` と出れば起動している。止めるときは Ctrl+C で終了する。データはメモリ上にあり、起動のたびに初期データへ戻る。
