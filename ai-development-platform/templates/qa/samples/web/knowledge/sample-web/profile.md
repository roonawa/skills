---
product: sample-web
environments:
  - {name: old, url: http://localhost:4101, purpose: 旧版}
  - {name: new, url: http://localhost:4102, purpose: 新版}
roles:
  - {name: staff, user_env: SAMPLE_STAFF_USER, password_env: SAMPLE_STAFF_PASSWORD}
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

# 到達手順

http://localhost:4101（旧版）または http://localhost:4102（新版）の /login を開き、フォームでログインする。一覧は /loans、詳細は /loans/貸出ID、登録は /loans/new、CSV は /loans.csv である。
