# 案件プロファイル

製品ごとに knowledge/製品名/profile.md を置きます。profile.template.md をコピーして product を埋め、必要な項目を足します。製品名は小文字、数字、ハイフンで書きます。

プロファイルには秘密情報を書きません。ユーザー名やパスワードは user_env、password_env のように環境変数の名前だけを書きます。値が書かれていると aidev check が失敗します。

使う Skill によって必須の項目が違います。aidev qa profile check の --skill で、Skill ごとの不足を確認できます。
