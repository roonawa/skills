# 更新手順（Linux担当者向け）

## 1. 現物を特定する

Windowsの転送作業とLinux上のrootシェルの作業を分ける。既知の例は `/opt/wpqa/wordpress-qa-linux`、接続名 `wpqa-srv`。固定値ではない。

`docker ps`のサービス名・ラベルで対象qaコンテナーを特定し、対象だけの以下を取得する：

- `.Config.Labels["com.docker.compose.project"]`
- `.Config.Labels["com.docker.compose.project.working_dir"]`
- `.Config.Labels["com.docker.compose.project.config_files"]`
- `.Mounts` のType/Name/Source/Destination/RW
- `.Image` と稼働サービス一覧

Composeのoverride、複数の`-f`、独自env-fileがあればその起動方法を維持する。単一構成例：

```bash
set -euo pipefail
umask 077
WPQA_APP=/opt/wpqa/wordpress-qa-linux
WPQA_PROJECT=実測したプロジェクト名
cd "$WPQA_APP"
wpqa_compose() { docker compose -p "$WPQA_PROJECT" --env-file "$WPQA_APP/deploy/.env" -f "$WPQA_APP/deploy/compose.yaml" "$@"; }
wpqa_compose ps -a
```

実測値に置き換えてから実行する。`compose config --quiet`で構成を検証する。展開済み設定の全文を表示しない。

**注意：`umask 077` のまま展開・配置したプログラムはコンテナで読めなくなる。** `umask 077` は鍵・バックアップ・作業記録を守るためのもの。この状態で更新ZIPを展開・コピーすると、プログラムのファイルが root だけ読める（600）状態になる。Dockerfile は `package.json`・`package-lock.json` を root の持ち物のままイメージに入れるため、node ユーザーで動く検査（Playwright）が `EACCES: permission denied, open '/app/package.json'` で失敗する（2026-11-04 に発生）。

- 展開直後に、展開先のプログラムだけ読めるようにする：`chmod -R u=rwX,go=rX <展開先>/wordpress-qa-linux`
- 配置後に、配置先のプログラムだけ読めるようにする。`bin lib builtin tests ui` は `chmod -R u=rwX,go=rX`、`package.json package-lock.json playwright.config.mjs MANIFEST.json SHA256SUMS START-HERE.txt` と `deploy/*.html` は `chmod 644`。
- `deploy/secrets`・`deploy/.env`・バックアップ・作業記録には適用しない。
- 候補イメージと切替後のコンテナで、node ユーザーが読めないファイルが無いことを確認する：`find /app -path /app/node_modules -prune -o -type f ! -readable -print` の出力が空であること。

現在のリポジトリでは次を使うが、実際の`.Mounts`を正とする：

| 領域 | コンテナー内 | 保存対象 |
|---|---|---|
| qa_data | qa:/data | projects、実行履歴、認証、systemのAI設定、監査ログ |
| policy_data | qa:/policy、egress:/policy | egress.json（許可接続先） |
| caddy_data | proxy:/data | CA鍵・証明書等 |
| caddy_config | proxy:/config | Caddy設定状態 |
| key/users.json | qa:/run/secrets | 復号キー／共有版の利用者 |

外部bind mountの結果・基準画像があれば、それも保存する。新しいサービスが存在しない旧版では、その領域を「未導入」と記録し、既存領域と混同しない。

## 2. 更新ファイルを安全に準備する

1. ローカルの`harness/dist`から利用する版を明示して選ぶ。日時だけの「最新」を盲信しない。既知の例は`wordpress-qa-linux-2026-10-30-security-refactor.zip`。
2. Windowsから一般SSHユーザーのホーム等へZIPと`.sha256`を転送する。秘密情報をコマンドラインに埋め込まない。
3. Windowsの`Get-FileHash -Algorithm SHA256`とLinuxの`sha256sum`を比較。ZIPと同時に渡されたハッシュだけでは発行者の証明にはならないので出所も確認する。
4. 展開前にZIPエントリを検査する。絶対パス・`..`・バックスラッシュでの脱出・シンボリックリンク・重複パス・想定外のルートを拒否する。ルートは`wordpress-qa-linux/`、内容はプログラムと明示した配布資料だけ。`.env`、secrets、.ui、登録サイト、実結果を含む更新物は使わない（`.env.example`はサンプル）。
5. 新しい空の更新用ディレクトリに展開する。例：`/opt/wpqa/update-日時/wordpress-qa-linux`。既存配置先には直接展開しない。
6. 展開先で`sha256sum -c SHA256SUMS`。`MANIFEST.json`のファイル一覧と実ファイル一覧も突き合わせる。リンクや追加ファイルがないことを確認。
7. 配布側のDockerfile、compose.yaml、package-lock.json、起動スクリプト、更新資料を確認。現在のイメージとPlaywrightワーカーの依存バージョンを揃える。

## 3. 停止前の引継ぎ基準

ブラウザーでログインして、サイトID・名前・サイト数、代表サイトの履歴件数と直近の実行ID、過去HTML/画像を閲覧できること、認証登録済み表示、AI設定済み表示を記録する。機密値は記録しない。検査・ログイン・AI補完・データ回収が動いていないことをUIとログで確認する。ローカルAPIのトークンや共有版Basic認証をチャットに貼らせない。

## 4. 整合したバックアップ

保守停止中は他の利用者による操作を避ける。対象プロジェクトのサービスを`wpqa_compose stop`で停止する。`down`は不要。停止前にコンテナーID・実マウント・旧Image IDを保護ファイルに記録しておく。

```bash
WPQA_BACKUP="/opt/wpqa/backups/$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$WPQA_BACKUP"
wpqa_compose config > "$WPQA_BACKUP/compose-resolved.yaml"
wpqa_compose stop
# アプリ配置ディレクトリ全体（.env・secretsも含む）を退避。出力先は配置先の外。
tar --acls --xattrs --numeric-owner -czpf "$WPQA_BACKUP/application.tgz" -C "$(dirname "$WPQA_APP")" "$(basename "$WPQA_APP")"
gzip -t "$WPQA_BACKUP/application.tgz"
```

`WPQA_BACKUP`が対象ディレクトリ内部にないこと、tarの終了コードが0であることを確認。結果を別bind mountに保存している場合、上のアーカイブだけでは足りない。

名前付きボリュームごとに、実測した名前で取得する。次は1領域の例であり、全対象について繰り返す：

```bash
WPQA_VOLUME=実測したボリューム名
WPQA_HELPER_IMAGE=既存qaコンテナーのImage_ID
# ホスト側リダイレクトで、バックアップ先にコンテナーから書込み権限を渡さない。
docker run --rm --network none --read-only --user 0 --entrypoint tar \
  --mount "type=volume,src=$WPQA_VOLUME,dst=/source,readonly" \
  "$WPQA_HELPER_IMAGE" --acls --xattrs --numeric-owner -czpf - -C /source . \
  > "$WPQA_BACKUP/$WPQA_VOLUME.tgz"
gzip -t "$WPQA_BACKUP/$WPQA_VOLUME.tgz"
tar -tzf "$WPQA_BACKUP/$WPQA_VOLUME.tgz" > "$WPQA_BACKUP/$WPQA_VOLUME.contents.txt"
```

先に`docker volume inspect`で存在確認する。名前を誤って空のボリュームを新規作成しない。ヘルパーは既存の信頼済みイメージを使い、tar対応を事前確認する。bind mountはホスト側の実測パスを`tar --acls --xattrs --numeric-owner`でバックアップする。

バックアップを空の一時領域に展開し、サイト数・代表履歴・ファイル件数を原本と照合する。外部へ公開・起動しない。空き容量が不足する場合は停止前に解決する。キー・利用者ファイルは`cmp --silent`等で一致を確認し、内容は表示しない。

旧サービスのImage IDを一覧化してタグ付けし、`docker image save`で保護バックアップに保存する。旧Composeと合わせて、旧バイナリーを再現できることを確認する。タグだけに頼ると後のビルドで置き換わるためImage IDも記録する。

失敗した場合は更新配置をせず、現行構成でサービスを再開する。途中生成物を完全なバックアップとして扱わない。

## 5. プログラム配置と構成差分

- 更新対象は`bin/ lib/ builtin/ tests/ ui/`と、Dockerfile・package.json・package-lock.json・playwright.config等の配布プログラム。`deploy/`は個別ファイルごとに確認する。
- `.env`・secrets・外部マウント・結果・baselineを保持。`cp -a 新版/. 既存/`の一括上書きは避ける。
- `cp`の対話aliasによる未上書きの経験があるため、対象ファイルのコピーは`/bin/cp`を使用する。コピー後に配布ハッシュで配置済みプログラムを検証する。古い文字列のgrepだけで新版判定しない。
- `compose.yaml`は新規サービス・隔離ネットワーク・制限を反映しつつ、現行のvolume名・外部指定・bind mountを維持する。`.env`は必要な新しいキーだけ追加し、origin、ポート、管理者、鍵をサンプルで置き換えない。
- Caddyfileのドメイン・TLS方式・プロキシ先と、Dockerfile内の必要資料のCOPYを照合する。証明書を再発行・CAを初期化しない。
- マイグレーションがある版では、旧データへの影響と後方互換性を確認してから起動する。未確認ならコピーしたデータを隔離した環境で先に検証する。

```bash
wpqa_compose config --quiet
wpqa_compose build
wpqa_compose up -d --no-build
wpqa_compose ps -a
```

全ビルド対象サービスを同じ配布版で再ビルド。qaのみの差替えでegressやブラウザーワーカーを旧版に残さない。起動後の実マウント・Image IDを更新前記録と照合し、[引継ぎ検証](verification-rollback.md)へ進む。
