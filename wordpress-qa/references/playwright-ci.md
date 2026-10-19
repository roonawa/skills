# PlaywrightとCIの運用

テストコードの正は `../harness/tests/site.spec.mjs` と案件のjourneyモジュール。古い「存在のみ」「302なら遮断」「メールは手動固定」のサンプルは使用しない。

## 実行条件

- Node/依存ライブラリはpackage-lock.json、ブラウザーはPlaywrightと対応する版へ固定する。
- ブラウザー操作はrole/label、必要ならtestidを優先。固定sleepより対象状態を待つ。
- workers=1、retries=0が既定。状態を変える操作を再試行で重複させない。
- allは全設定項目を実行する。auditのみでも他の必須検査が残れば終了2。CI側で一律 `|| true` にしない。
- HTML、JSON、trace、失敗画像をジョブ失敗時にも保存する。保管期間と公開範囲は案件の情報分類に合わせる。

## 変更とジョブ

| 起点 | 対象 |
|---|---|
| PR/テーマ変更 | audit＋影響するjourney/visual |
| CMSからのコンテンツ変更 | 変更ページaudit＋例外表示 |
| プラグイン/コア更新 | 重要導線と全テンプレート代表 |
| 公開前・定期 | 全URL audit＋必要な回帰 |
| 公開直後 | 公開設定・到達性等の許可された限定確認 |

画像比較は安定した環境ならCIでも実行する。基準画像更新はCIで自動承認しない。手動reviewや環境不足を成功へ読み替えない。

## 自己検証CI例

`../harness/examples/qa-selftest.yml` はハーネスのテスト用で、実サイトへアクセスしない。リポジトリに導入する場合のみworkflowとして配置する。今回は自動で有効化していない。

実サイト用CIは、検証環境のURL・認証変数・レビュー済み期待値・基準画像を用意した後に `node bin/qa.mjs run --config <site.json> --suite all` を実行する。手動必須項目はハーネスでreviewのままとし、公開判断は別の証拠と統合する。
