---
name: wordpress-admin-check
description: Use when WordPress general, reading, discussion, permalink, or plugin settings must be checked against project expectations through authenticated REST or read-only admin pages, with results in the QA harness UI.
---

# WordPress 管理設定の検査

設定値を案件・環境ごとの期待値と照合し、共通ハーネスの `admin` suiteに記録する。実際の値をそのまま正解として採用しない。

1. 対象サイト、環境、設定項目、期待値、その根拠を確認する。本番と検証環境では検索エンジンへの公開方針などが異なる。登録していない設定を検査済みと言わない。
2. [管理設定の設定仕様](../wordpress-qa/references/admin-settings.md)を読み、サイトJSONの `admin` 配列を作る。RESTで取得できる項目はRESTを優先し、それ以外は実際の管理画面を確認してselectorを設定する。プラグインの名前だけから画面構造やRESTフィールドを推測しない。
3. UIで設定する場合は「サイトを登録」「設定を編集」を使う。RESTにはユーザー名・アプリケーションパスワードを設定する。管理画面認証は「WordPressにログイン」で専用ブラウザーを開き、利用者がログイン・追加認証を終えたら「ログインを確認」→「保存」で登録する。セッションファイルを利用者に用意させる必要はない。既存ファイルの取込みは任意。詳細は[利用手順](../wordpress-qa/references/harness-guide.md)。ファイル設定を使う場合、RESTの認証ヘッダーは環境変数、ブラウザーの認証は既存のstorageStateファイルを参照する環境変数で渡す。認証情報や機密設定値をJSON・Skillに直書きしない。秘密そのものの一致検査は行わず、設定済み状態など非機密の指標を選ぶ。
4. `node bin/qa.mjs validate --config <site.json>` の後、UIの「管理設定」または `run --suite admin` で実行する。各項目の期待値・取得値・証拠JSONを確認する。
5. 不一致はfail、認証切れ・権限不足・項目欠落はblocked。設定変更、保存ボタン、プラグイン有効化、更新操作はこの検査に含めない。修正依頼が別途ある場合にのみ扱う。

管理画面の検査はスクリプトやXHRを実行しない読み取り専用表示を用いる。JavaScriptで組み立てる設定画面は取得不能になり得る。その場合はプラグインの読み取りAPIを確認し、対応できなければmanualへ根拠を記録する。認証マーカーはログイン画面には存在しない要素を指定する。

設定値の一致だけで機能正常と結論しない。SEO公開設定は `wordpress-site-audit`、SMTP等は `wordpress-journey-test` の通知確認と組み合わせる。全体の公開判断は `wordpress-qa` へ戻す。

## 検査漏れの防止

初回設計・サイト登録・網羅性の確認では[観点とケース生成](../wordpress-qa/references/coverage-generation.md)を読み、この領域の必要観点を具体的なケースIDへ対応付ける。未判定・期待値未設定を台帳から除外しない。共通の生成ケースは出発点であり、登録した数だけで網羅や合格を宣言しない。
