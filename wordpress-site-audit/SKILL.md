---
name: wordpress-site-audit
description: Use when a WordPress site needs a URL-wide release audit for broken internal links, canonical URLs, indexability, or explicit endpoint exposure policies, without browser interaction testing.
---

# WordPress Site Audit

全対象URLを軽量なHTTP/HTML検査で確認する。フォーム操作・画面比較はそれぞれの専門Skillに任せる。

## 入力と実行

共通基盤は隣接する `../wordpress-qa/harness/`。まず [実行手順](../wordpress-qa/references/harness-guide.md) のセットアップと [設定仕様](../wordpress-qa/references/configuration.md) を読む。コマンドはハーネスフォルダーで実行し、`--config`には実サイト用JSONの絶対パスを渡す。

1. サイトマップ・CMSの公開URL一覧・移行対象一覧を照合する。`pages`は実際に検査する明示リストであり、トップページだけを設定して「全ページ確認済み」としない。孤立ページやサイトマップ対象外ページは別途追加する。
2. 各ページの期待するcanonical、indexable、必要ならtitle/description/langを設定する。期待値は合意済みの公開方針・移行表から作る。現在の応答をそのまま正解にしない。
3. エンドポイント方針は`policies`に設定する。管理画面・XML-RPC・著者一覧の公開を一律に不具合としない。301/302を許容するときは転送先も指定する。
4. `node bin/qa.mjs validate --config <absolute-site.json>`、続いて `node bin/qa.mjs run --config <absolute-site.json> --suite audit`。
5. `results.json`と`report.html`で不合格・実行不能を区別し、対象URL数、対象外URL、原因と証拠を報告する。設定済みで未選択の項目はnot_runのまま統括へ返す。設定から欠けた必要検査は先に追加する。

## 判断の要点

| 観測 | 判断 |
|---|---|
| wp-adminがログインへ302 | 遮断の証拠にはならない。期待転送先または403等の方針と照合 |
| wp-config.phpが200空本文 | ステータスのみで漏洩としない。ソース/秘密情報の禁止文字列とアクセス方針を別に検査 |
| robotsタグがない | 欠如だけで不合格にしない。metaとX-Robots-Tagのnoindexを確認 |
| canonicalが旧ドメイン | 期待URLと比較し、不一致なら不合格 |
| 通信不能・認証失敗 | 未確認として残す。成功や対象外に置き換えない |

検査例: コーポレートサイト移行では、本番ドメインをcanonical期待値に設定し、公開URL全件をauditへ渡す。外部リンク、robots.txtの経路制御、bot別指示、JSで生成されるメタデータは組込検査の保証範囲外。必要なものは追加検査または手動台帳へ登録する。

## よくある誤り

- HTTP 200だけで正常扱いする → タイトル、canonical、主要ページの操作・表示検査も組み合わせる。soft 404の意味判定はHTTPだけではできない。
- 表示された秘密値をレポートに転記する → 検出した事実と場所を残し、秘密値そのものは保存しない。
- 全ページをブラウザーで開く → HTTP/HTMLで決まる検査はauditで済ませる。
- audit成功を公開承認とする → 重要導線・表示・必要な手動確認は統括Skillの台帳で別に判定する。

## 検査漏れの防止

初回設計・サイト登録・網羅性の確認では[観点とケース生成](../wordpress-qa/references/coverage-generation.md)を読み、この領域の必要観点を具体的なケースIDへ対応付ける。未判定・期待値未設定を台帳から除外しない。共通の生成ケースは出発点であり、登録した数だけで網羅や合格を宣言しない。
