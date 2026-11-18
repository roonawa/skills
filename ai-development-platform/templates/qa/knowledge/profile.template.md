---
# 製品名。小文字、数字、ハイフンで書く。knowledge/ の下のディレクトリ名と揃える
product: your-product

# 以下は必要になった Skill に合わせて有効にする。環境ごとに name、url、purpose を書く
# environments:
#   - {name: old, url: http://localhost:4101, purpose: 旧版}
#   - {name: new, url: http://localhost:4102, purpose: 新版}

# ロールごとに、ユーザー名とパスワードを入れた環境変数の名前を書く。値そのものは書かない
# roles:
#   - {name: staff, user_env: SAMPLE_STAFF_USER, password_env: SAMPLE_STAFF_PASSWORD}

# method は saml、oidc、form、certificate、none から選ぶ
# 証明書方式なら certificate_thumbprint（40桁の16進数）を書いてよい
# login: {method: form, entry_url: http://localhost:4101/login}

# stack: [node, html-form]

# test_commands:
#   - {name: e2e, run: npx playwright test}

# method は lfs、external、local から選ぶ。個人情報が映る案件では lfs を選ばない
# evidence: {method: local, retention: 90d}
---
# 観点

この製品で繰り返し確認したい点や、過去に不具合が出た箇所を書く。

# ログイン中の目印

ログインしている間だけ出る要素のセレクタを書く（例 ログインユーザーの名前の表示）。aidev-qa-login-session がセッションの確認に使う。ログインがない製品では消してよい。
