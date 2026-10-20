# 実 WordPress による検証

`harness/test/real-wordpress/run.mjs` は WordPress 本体を起動し、`lib/checks/wordpress.mjs` の4種類のチェックをそのまま実行する。REST 応答を自作する fixture ではない。既存の登録サイトを使わず、破棄可能な WordPress / PHP WASM / SQLite 環境を作る。

## 実行

Windows PowerShell、npm、および harness の通常依存関係を用意して、harness ディレクトリで実行する。

```powershell
./test/real-wordpress/setup.ps1
```

setup は `.selftest/real-wordpress/` に Node 24.18.0 と公式 Playground CLI 3.1.59 をインストールし、公式 WordPress 6.8.3 ZIP をダウンロードする。既存の Node/PHP や本番サイトは変更しない。初回はネットワーク速度により数分かかる。インストール時の engine 警告は親 npm の Node バージョンに対するもので、検証自体は同梱した Node 24.18.0 を使う。

導入済みなら次のコマンドだけで再実行できる。

```powershell
./.selftest/real-wordpress/node_modules/node/bin/node.exe test/real-wordpress/run.mjs
```

実測証跡は `.selftest/real-wordpress/evidence-core.json`。失敗・起動失敗・4チェック未完了は終了コード1になる。パスワード、Authorization、Cookie は証跡へ書かない。

## 実測結果（2026-10-20）

WordPress 6.8.3 / PHP 8.3.33 / SQLite / Twenty Twenty-Five 1.3 で lifecycle、authz、cache、scheduled の4件すべて PASS、所有投稿の残存ゼロ、終了コード0を確認した。ランタイムは Playground 3.1.59 / Node 24.18.0。機械可読の小さな証跡は `harness/test/real-wordpress/measured-results.json` に保存している。

Twenty Twenty-Four 1.3 / Contact Form 7 6.1.3 / WP Super Cache 3.1.4 の追加構成でも4件 PASS、CF7 は HTTP 200 / `validation_failed` / 必須エラー3件、所有投稿残存ゼロを確認した。ただしキャッシュヒットは0で、この構成の総合結果は **FAIL（終了コード1）**。キャッシュプラグインの実キャッシュ稼働と purge は未証明であり、互換性検証の成功に含めない。原因は以下のランタイム制約まで特定した。

初回の実 WordPress 実行では、下書きから公開時の canonical URL 変更と、予約時刻をまたいだレスポンスの判定で失敗した。エンジンを修正して再実行し、上記の4件成功を確認した。fixture の成功をそのまま実サイト互換の証明にはしていない。

## 判定内容

- lifecycle: 実際の管理者ログイン Cookie による下書きプレビュー、公開、本文更新、非公開化、匿名側の非公開内容非表示。
- authz: 実際の Application Password で管理者・購読者をそれぞれ認証し、購読者の正の認証対照と private 投稿の読み書き拒否、拒否後に本文が変わっていないことを確認。
- cache: 認証側の private ページ表示と匿名側の隔離、公開後の本文更新を3回連続して確認。これはオリジンの内容反映チェックであり、CDN purge の証明ではない。
- scheduled: 65秒後の予約投稿を作り、`wp-cron.php` を1秒ごとに呼ぶ。公開状態を直接書き換えず、WordPress の実際の予約イベントが投稿を公開することを確認。隔離サイト内の初期 cron イベント（外部への更新確認など）は事前に除去し、この検証の予約イベントを対象にする。
- cleanup: 各チェックが所有投稿を削除し、最後に `wpqa-` 投稿の残存数ゼロを検証する。

管理者の Application Password とログインパスワードは実行ごとに作り直す。Playground の HTTP サーバーは資格情報を作る前に `127.0.0.1` へ再 bind する。WordPress 環境は終了時に破棄する。

## プラグイン・テーマの追加構成

```powershell
$env:WPQA_REAL_VARIANT = 'plugins'
./test/real-wordpress/setup.ps1
Remove-Item Env:WPQA_REAL_VARIANT
```

追加構成は Contact Form 7 6.1.3、WP Super Cache 3.1.4 を公式配布元から入れて有効化し、Twenty Twenty-Four へ切り替えて同じ4チェックを実行する。証跡は `evidence-plugins.json`。実際の WordPress、PHP、テーマ、プラグインの版、有効化状態、`WP_CACHE` 状態を採取する。

プラグインの有効化とページキャッシュの稼働は別の判定である。この追加構成では `WP_CACHE` とプラグインのキャッシュを有効にする。プラグインの `wpsc_served_header` 設定も有効にし、`wp-cache` の実行中に `X-WP-Super-Cache: Served...` の応答を少なくとも1回観測できない場合は失敗にする。CF7 では空のフォームを実際の feedback REST API へ送り、`validation_failed` と必須項目のエラーを検証する。実メール受信、reCAPTCHA、正常送信の業務結果は対象外。

## 実キャッシュが動かない原因

実HTTP応答に一時的な診断ヘッダーを付けて確認した結果、Playground の公開ページ要求は次の状態だった。

| 項目 | 実測 |
|---|---|
| `PHP_SAPI` | `cli` |
| `PHP_SELF` | `/2026/10/20/wpqa-…/`（pretty permalink） |
| `SCRIPT_FILENAME` | `/wordpress/index.php` |
| `wpsc_is_backend()` | `true` |
| `DONOTCACHEPAGE` | `1` |
| `cache_enabled` / `super_cache_enabled` / `wpsc_served_header` | すべて `true` |

`advanced-cache.php` と設定ファイルは存在し、phase1 / phase2 も実際に読み込まれていた。設定漏れではない。

[WP Super Cache 3.1.4 の `wpsc_is_backend()`](https://plugins.svn.wordpress.org/wp-super-cache/tags/3.1.4/wp-cache-phase2.php) は、`basename(PHP_SELF) !== 'index.php'` かつ `PHP_SAPI === 'cli'` の要求をバックエンド扱いする。Playground の上記組合せがこの条件に一致し、phase1 が `DONOTCACHEPAGE=1` を設定してキャッシュを迂回する。公開応答にキャッシュ生成コメントはなく、cache ディレクトリにも保護用の空 index ファイルしかなかった。

`Accept: text/html` を明示しても同じ結果で、Accept ヘッダー不足という仮説は棄却した。WordPress 本体チェック、Playground、外部プラグインの判定を改変して成功扱いにはしていない。キャッシュ層の検証は通常の Web SAPI を使う実ホスト環境で別途必要となる。

診断だけを再実行する場合：

```powershell
$env:WPQA_REAL_VARIANT = 'plugins'
$env:WPQA_REAL_CASES = 'wp-cache'
$env:WPQA_REAL_ACCEPT_HTML = '1'
./.selftest/real-wordpress/node_modules/node/bin/node.exe test/real-wordpress/run.mjs
Remove-Item Env:WPQA_REAL_VARIANT, Env:WPQA_REAL_CASES, Env:WPQA_REAL_ACCEPT_HTML
```

診断は `evidence-plugins-diagnostic.json` へ保存し、全チェック実行の証跡を上書きしない。秘密情報を除いた要約は `measured-results.json` の `cacheDiagnosis` に保存している。

## 範囲の限界

SQLite を使用するため MySQL 固有の挙動、Apache/Nginx の rewrite、外部 cron、メール配信、CDN はこの実行の保証対象外。予約投稿は明示的な cron 呼び出しを含むため、実ホストの cron が動くという意味ではない。固定した過去版の互換性検証であり、最新版への適合確認とも分ける。

公式資料:

- [Playground CLI](https://wordpress.github.io/wordpress-playground/developers/local-development/wp-playground-cli/)
- [Programmatic CLI](https://github.com/WordPress/wordpress-playground/blob/trunk/packages/docs/site/docs/main/guides/programmatic-playground-cli.md)
- [Contact Form 7](https://wordpress.org/plugins/contact-form-7/)
- [WP Super Cache](https://wordpress.org/plugins/wp-super-cache/)
