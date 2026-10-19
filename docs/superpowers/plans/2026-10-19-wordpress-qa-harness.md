# WordPress QA Harness Implementation Plan

Goal: 承認済みの「統括Skill＋専門Skill3つ＋薄い共通ハーネス」を既存スキルフォルダーへ実装する。

Architecture: Node.js 22 / Playwright Testを実行基盤とする。JSON設定を検証し、検査台帳からテストを組み立て、JSON/単体HTMLに結果を統一する。サイト固有の操作は通常のJavaScriptモジュールで追加する。独自テスト言語や管理画面は作らない。

Scope: 全指定ページHTTP/HTML検査、同一サイトリンク、明示的な公開方針、重要導線、Mailpit受信検証、代表ページ画像比較とaxe。検証用ローカルサイトを同梱。実サイトの認証・公開方針は推測しない。

## Tasks
- [x] 設定検証・台帳・公開条件のテストを先に書き、失敗を確認後に実装。
- [x] HTTP検査とローカルサイトを実装。正常／noindex／旧canonical／転送／秘密漏洩／リンク切れを検証。
- [x] Playwright操作、Mailpit、表示比較、axe、証拠・HTML集約を実装。欠落基準画像、未実施、環境障害を区別。
- [x] 実行可能なデモ設定と操作モジュール、CI例、利用手順を整備。
- [x] 統括Skill改訂、専門Skill3つを順に作成・検証。古い判定例を置換。
- [x] 正常系・意図的不具合・再実行の結合検証、独立レビュー、リンクとfrontmatter確認。

## Contracts
- 結果は pass/fail/blocked/not_run/not_applicable/review。必須項目はpassまたは理由付きnot_applicable以外で公開条件未達。
- 未選択suiteもnot_runとして台帳に残す。テスト0件・設定誤り・実行中断を成功にしない。
- 本番の操作テストは明示的許可設定が必要。自動再試行はしない。共有メールボックス全削除をしない。
- 基準画像が無ければ候補を保存しreview。承認コマンドで選んだ画像のみ採用し、再実行で比較する。
- 出力に環境・設定ハッシュ・実行ID・ブラウザー版・証拠を保存。認証値は設定ファイルへ書かず環境変数。
- ローカル検証はWordPress本体・実SMTP/reCAPTCHAの検証とは区別して報告。

## Decisions / verification ledger
- 既存会話で構成・目的は合意済み。実装詳細は上記の既存ランナー利用を採用。
- 指定の作業フォルダーに直接作成。既存の無関係な未追跡フォルダーは変更しない。commit/pushは今回実施しない。
- 旧Skillの独立評価で302遮断誤判定、200空本文の誤検知、canonical存在のみ、メール一律手動、未実行状態未定義を確認。専門Skillで各判断を補正し、独立評価で再確認。
- 単体テスト初回は未実装モジュールで失敗。実装後に正常判定と不正設定拒否を確認。結合テストは初回フォームのJSProperty照合、次にPlaywrightのsnapshot名正規化で失敗し、原因を修正。
- ローカル通信はsandboxで遮断されたため、許可された昇格実行で同梱fixtureのみ検証。
- 独立レビュー指摘の相対Location/HTML base URLの解決不具合を再現テストでRED確認後に修正。設定型の漏れも回帰テストを追加。
- サイトマップ収集は期待値を生成しない別コマンド。組込はChromium・Mailpit API契約まで。実WordPress、実SMTP/reCAPTCHA、他ブラウザー、性能は案件導入時に別検証。
- 最終検証: npm test 16/16成功。npm run test:integration 成功（URL収集、基準なしreview、承認後の正常10/10を2回、auditのみnot_run、noindex/旧canonical/未通知/横はみ出し/漏洩/リンク切れ、メールAPI停止blocked、認証不足blocked）。証拠: wordpress-qa/harness/.selftest/2026-10-19T07-09-42-916Z/。
- 4 Skillのquick_validate成功。Markdown相対リンク15件の存在確認成功。git diff --check成功（既存Git設定由来のLF/CRLF通知のみ）。専門Skillと統括Skillの独立シナリオ評価で重大な矛盾なし。
- 実サイト実行・本番メール送信・公開・commit/pushは未実施。CIはサンプルを配置したのみで有効化していない。
