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

ロールごとに見える範囲が違うため、一覧と詳細と CSV は staff と admin の両方で確認する。一覧の件数は 0 件、1 件、50 件、51 件の境目を見る。返却予定日は貸出日当日と 30 日後を境目にする。

# 落とし穴

詳細と CSV の権限は画面のボタンの表示では守られていない。ボタンが出ないことと、URL を直接開いて 403 になることは別に確かめる。旧版と新版は並び順と CSV の日付の形式に差が出やすい。

# テストデータ

検証環境の初期データとして、貸出を 51 件以上持つ staff のユーザーと、貸出を 1 件も持たない staff のユーザーを用意してある。別の staff が持つ貸出の ID は、admin で一覧を開いて調べる。

# 到達手順

http://localhost:4101（旧版）または http://localhost:4102（新版）の /login を開き、フォームでログインする。一覧は /loans、詳細は /loans/貸出ID、登録は /loans/new、CSV は /loans.csv である。
