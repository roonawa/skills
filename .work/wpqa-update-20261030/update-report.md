SITE EXAM Linux共有版 更新記録 — 2026年10月30日

更新は完了しています。WPQA-SRV の既存データを保持したまま、2026-10-30-security-refactor にヘルプ配備の補正を加えた版へ切り替えました。最終確認は2026年10月30日13:12（日本時間）です。

| 項目 | 結果 |
|---|---|
| 接続先 | usshuser@WPQA-SRV / https://wpqa-srv:8443/ |
| 配置先 | /opt/wpqa/wordpress-qa-linux |
| Composeプロジェクト | deploy（変更なし） |
| 更新前のMANIFEST表記 | 2026-10-28 |
| 更新後の版 | 2026-10-30-security-refactor+help-assets |
| 保守停止開始 | 2026-10-30 11:57:35 JST |
| 全サービス起動 | 2026-10-30 11:57:43 JST |
| 停止開始から起動まで | 約8秒 |
| 管理者 | roonawa（ユーザー指定） |
| バックアップ | /opt/wpqa/backups/20261030-0LVM9w |
| 作業記録・事前検証 | /root/wpqa-maintenance-20261030-0LVM9w |

**保持・動作確認**

- 既存サイト「万年堂」1件、履歴1件、利用者5名を保持。
- サイトID：68a92eea-3803-4596-bc6c-05c7a4c54ea9。
- 履歴ID：2026-10-29T04-03-19-509Z-a23ea917。
- 更新直後の照合で、既存データ149ファイルのSHA-256が更新前とすべて一致。
- 復号キー・users.json・Caddyfileは停止時バックアップとバイト単位で一致。.envは既存内容を保持し、WPQA_ADMINS=roonawaだけを追記。
- コピーしたデータを外部通信のない一時コンテナーで読み込み、既存サイト設定と暗号化認証1件の復号を確認。復号内容は出力・保存していない。
- 配置済みプログラム108ファイル、稼働中イメージ内98ファイルをMANIFESTと照合。
- qa / proxy / egress / chromium / firefoxの5サービスが稼働。最終確認時は約1時間稼働し、各サービスの再起動回数0、確認対象の重大ログ0件。
- Chromiumはサンドボックスを有効にして起動確認。Firefoxも外部通信のない一時コンテナーで起動確認。
- HTTPSの既存認証で画面を閲覧でき、匿名アクセスはHTTP 401。既存CAのSHA-256指紋は一致。
- 更新前・更新後のHTMLレポートと保存画像を閲覧。代表画像は1280×900。
- 既存結果ZIPをダウンロードし、8ファイルを正常に読み取り。report.htmlとPNG画像4枚を確認。
- ヘルプHTMLと埋め込み画像7枚の表示を確認。
- 管理設定画面で、管理者権限と既存サイトの接続許可を確認。AIキーは更新前同様、未登録・無効の状態。

**保存領域と構成**

| 保存先 | コンテナー内 | 扱い |
|---|---|---|
| deploy_qa_data | qa:/data | 既存ボリュームを維持 |
| deploy_caddy_data | proxy:/data | 既存ボリュームを維持 |
| deploy_caddy_config | proxy:/config | 既存ボリュームを維持 |
| deploy/secrets/key | qa:/run/secrets/qa_key | 元のbind mountと内容を維持 |
| deploy/secrets/users.json | qa:/run/secrets/qa_users | 元のbind mountと内容を維持 |
| deploy_policy_data | qa:/policy、egress:/policy | 新規導入。既存サイトのoriginを1件登録 |

既存の公開先10.0.0.161:8443は維持。qaの4310番、ブラウザーワーカーの3000番は外部公開していません。backendはdeploy_backend_v2、controlはdeploy_controlとして内部ネットワーク化しました。旧deploy_backendは切り戻し用に残しています。

既存サイトの許可先は https://mannendo-test.rgr.jp です。将来必要になる別ドメインの画像配信先等は、管理者の「AI・接続先の設定」で個別に追加する構成です。

**配布物と補正**

元配布物：
wordpress-qa-linux-2026-10-30-security-refactor.zip
SHA-256：
875e12f907a72b55467e05778417433bc8252ae52a5d4989e475eb422bb7a0b9

転送した派生ZIP：
wordpress-qa-linux-2026-10-30-security-refactor-help-assets.zip
SHA-256：
237bcc184c3d6ae805199d69a39c788b6a616a0135651f67bbc41d92b48677ef

最終的に加えた補正は、DockerfileへのヘルプHTML3ファイルの明示COPY、.dockerignoreへの同3ファイルの明示許可、Composeの内部ネットワーク名の環境調整です。配布プログラムのLinux権限はディレクトリ755・ファイル644に整えました。deploy全体やsecretsをイメージに含める変更は行っていません。

ヘルプ配備補正をまとめたローカルZIP：
C:\Users\roonawa\.claude\skills\.work\wpqa-update-20261030\wordpress-qa-linux-2026-10-30-security-refactor-help-assets-v2.zip
SHA-256：
a3cc17fe80919d54eada5a88b700aa483c6fff99bead513015b50c9ce87c0e0e

このローカルZIPには当該サーバー専用のネットワーク名調整は含みません。実配置の照合表はサーバーの /opt/wpqa/wordpress-qa-linux/SHA256SUMS です。同ファイル自体のSHA-256：
ecf540553a5e218f3b6ede73885effd92f26a70c76d3787cbd8daf95cdf72c87

**イメージの対応**

| サービス | 更新前 | 更新後 |
|---|---|---|
| qa | sha256:e396fc16c037f97ba5049b90299ffda585980acf8bb4fa0e077a9f33c6e66d21 | sha256:dbf3fe1eb289c780801a985f0afcd6d9bdd6dcd8631d20857a1df24f67f306fa |
| proxy | sha256:5e5286cb37d44086d651a5363f05f43a692ce4d649d88fb1bd844579f45fa9e8 | 同じイメージ |
| egress | 未導入 | sha256:3e1fccb07047d5a012c011bd6426160c76135f4fc4a68b1d43f83f40a9503b5c |
| chromium | 未導入 | sha256:50bc68978458c300d5b794c64590a97e9cd5b5f207a9588dfc87db3c31ba381c |
| firefox | 未導入 | sha256:e6a18c89222da2ab6d1f3d047c24058dd1828f019967f8eaf2fcb5ffef159b8d |

qa・egress・chromium・firefoxはサービスラベルによりImage IDが異なりますが、ファイルシステムの全レイヤーが一致しています。

**バックアップと切り戻し**

バックアップディレクトリと作業記録ディレクトリはいずれもroot所有・モード700です。アプリ全体、.env、secrets、既存の全3ボリューム、旧イメージを保存しました。アプリとボリュームのアーカイブはgzip検査後に別ディレクトリへ展開し、原本・展開結果の両方をアーカイブと比較して一致を確認しました。

主なファイルはapplication.tgz、deploy_qa_data.tgz、deploy_caddy_data.tgz、deploy_caddy_config.tgz、old-images.tar.gz、verification-summary.json、image-identities.json、rollback.shです。旧イメージにはwpqa-rollback-20261030-0lvm9w:qaとwpqa-rollback-20261030-0lvm9w:proxyのタグも付けています。

切り戻し用スクリプトは旧プログラム・Compose・.envと旧イメージを戻すもので、保存データを巻き戻しません。実行前に稼働中の検査・ログイン・AI処理がないことを確認し、切り戻し時点のデータを別途保全してください。新版で変更されたデータの旧版互換性と停止時間を確認してから、Linuxのrootシェルで実施します。

    export WPQA_APP=/opt/wpqa/wordpress-qa-linux
    export WPQA_BACKUP=/opt/wpqa/backups/20261030-0LVM9w
    export WPQA_STATE="$WPQA_BACKUP"
    bash "$WPQA_BACKUP/rollback.sh"

旧イメージがローカルから失われている場合は、上記実行前にold-images.tar.gzをdocker image loadで読み込みます。データ自体の巻き戻しが必要な場合、このスクリプトだけでは実施せず、新規データへの影響を確認して別途判断します。切り戻しスクリプトは構文を検証済みですが、今回の実環境で切り戻し起動は実施していません。

バックアップ、旧イメージ、旧ネットワーク、作業記録は削除していません。

**確認範囲**

今回は共有版の更新とデータ引継ぎを検証しました。WordPressへの新たな検査、注文、問い合わせ、投稿作成、有料AI APIの呼び出しは実施していません。保存済みWordPress認証の復号は確認しましたが、対象サイト側でのセッション有効期限や実ログインまでは検証していません。過去の検査結果に含まれる不合格・実行不能は、今回の更新で再検査した結果ではありません。

画面記録：
C:\Users\roonawa\.claude\skills\.work\wpqa-update-20261030\after-update.jpg

ダウンロード確認に使用した既存結果ZIP：
C:\Users\roonawa\Downloads\qa-results-2026-10-29T04-03-19-509Z-a23ea917 (1).zip

