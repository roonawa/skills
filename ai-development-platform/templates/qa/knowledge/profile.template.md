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

# method は saml、oidc、form、native-form、certificate、none から選ぶ
# native-form はデスクトップアプリ自身のログイン画面に ID とパスワードを入れる方式。entry_url は要らない
# 証明書方式なら certificate_thumbprint（40桁の16進数）を書いてよい
# entry_url は、テスト対象の環境の QA_BASE_URL に、ここのパスを足した URL として使う（下の例の /login の部分）
# login: {method: form, entry_url: http://localhost:4102/login}

# stack: [node, html-form]

# Skill ごとにプロジェクトで絞る。何も絞らない npx playwright test は、ほかの Skill の spec まで流す
# automation/web に入って流す。QA リポジトリのルートから -c automation/web で流すと、npx が別の版の Playwright を取ってきて失敗する
# test_commands:
#   - {name: characterization, run: cd automation/web && npx playwright test --project=characterization}
#   - {name: authz, run: cd automation/web && npx playwright test --project=authz}
#   - {name: cases, run: cd automation/web && npx playwright test --project=cases}

# method は lfs、external、local から選ぶ。個人情報が映る案件では lfs を選ばない
# evidence: {method: local, retention: 90d}

# NG のケースを起票する Gitea のリポジトリ。aidev-qa-bug-ticket と aidev qa issue create が使う
# url は https:// で書く（http:// は localhost と 127.0.0.1 だけ）。repo は owner/name の形
# トークンはここに書かず、作業者個人のものを環境変数 GITEA_TOKEN で渡す。接続先も GITEA_URL に設定し、url と揃える
# issue_tracker: {type: gitea, url: https://gitea.example.internal, repo: your-org/your-product}
---
# 観点

この製品で繰り返し確認したい点や、過去に不具合が出た箇所を書く。

# ログイン中の目印

ログインしている間だけ出る要素のセレクタを書く（例 ログインユーザーの名前の表示）。aidev-qa-login-session がセッションの確認に使う。ログインがない製品では消してよい。
