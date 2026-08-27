# QA確認項目一覧

カテゴリごとの対象・確認内容・自動化可否。[SKILL.md](../SKILL.md)のQuick Referenceから参照される詳細版。

## 機能品質

### ページ表示
対象: トップページ／下層ページ／固定ページ／投稿ページ
確認: HTTPステータスが正常／JavaScriptエラーが発生しない／主要コンテンツが表示される／画像が正常表示される
自動化: Playwright ○ / CI ○

### ナビゲーション
確認: グローバルナビゲーションが正常／フッターリンクが正常／パンくずが正常／外部リンクが正常
自動化: リンク存在 ○ / リンク先確認 ○ / 内容妥当性 手動

## フォーム品質
対象: 問い合わせフォーム／資料請求フォーム／予約フォーム

- **表示確認**: 入力項目が表示される／ラベルが存在する／必須項目が分かる／ボタンが操作可能（Playwright ○）
- **バリデーション確認**: 未入力エラー／形式エラー／最大文字数／不正文字（Playwright ○）
- **送信確認**: 正常送信できる／完了画面へ遷移する／二重送信対策／エラーメッセージ（Playwright ○。reCAPTCHA・メール送信など外部サービスに依存するため実施場所はQA工程。メール受信確認自体は環境依存のため自動化対象外）

## SEO品質

| 項目 | 確認内容 | 存在確認 | 内容妥当性 |
|---|---|---|---|
| Title | 存在する／空ではない／ページごとに適切 | 自動 | 手動 |
| Meta Description | 存在する／空ではない／重複していない | 自動 | 手動（SEO効果） |
| Heading | h1存在／h1重複なし／見出し階層 | 自動 | - |
| Canonical | 設定有無／URL妥当性 | 自動 | - |
| OGP | og:title/description/image/type/url | 自動 | - |
| robots meta | `<meta name="robots">`存在、公開ページでnoindexになっていない | 自動 | - |
| sitemap | `/sitemap.xml`が存在し200を返す | 自動 | - |
| robots.txt | `/robots.txt`が存在しSitemap記載がある | 自動 | - |
| lang属性 | `<html lang="ja">`がある | 自動 | - |

## Security品質

### WordPress管理画面
対象: `/wp-admin`, `/wp-login.php`
確認: 不要な公開状態ではない／意図しないログイン画面露出がない
自動化: Playwright ○

### XML-RPC
対象: `/xmlrpc.php`
確認: 使用予定がない場合は無効化されている（HTTP確認 ○）

### Directory Listing
対象例: `/wp-content/uploads/`, `/backup/`
確認: ファイル一覧が表示されない（自動 ○）

### HTTPS
確認: HTTPからHTTPSへリダイレクトされる／混在コンテンツがない（自動 ○）

### Security Header
確認対象: X-Frame-Options, X-Content-Type-Options, Content-Security-Policy, Strict-Transport-Security
判断: 存在確認は自動、設定内容の妥当性は手動レビュー

## Analytics品質

- **Google Analytics**: GA4タグ存在／測定ID設定／全ページ読み込み（自動 ○）
- **Google Tag Manager**: GTMタグ存在／コンテナID確認（自動 ○）
- **イベント計測**: 問い合わせ送信／ボタンクリック／CVイベント — タグ存在は自動、計測仕様の妥当性は手動

## reCAPTCHA品質

- **表示確認**: スクリプト読み込み／ウィジェット表示／hidden値存在（自動 ○）
- **判定確認**: Bot判定／スコア判定／不正送信防止 — 完全自動化不可（Google側サービス判定に依存するため）

## Responsive品質

対象サイズ: Mobile 375px / Tablet 768px / Desktop 1280px（必要に応じて1440px）

- **自動確認**（Playwright + Screenshot比較）: 横スクロール／要素欠落／主要ボタン表示／レイアウト崩れ
- **手動確認**: デザイン品質／余白感／文字サイズ／視認性

## Accessibility品質

- 対象: alt属性／label関連付け／コントラスト／キーボード操作
- 自動化可能: axe-core, Playwright
- 手動確認が必要: 読みやすさ／操作感／スクリーンリーダー利用感

## 重要度分類

| 重要度 | 判断基準 | 例 |
|---|---|---|
| Critical | 失敗すると公開不可 | サイト表示不可、フォーム送信不可、セキュリティ事故、本番エラー |
| High | 公開前に必ず確認 | SEO設定不足、GA未設定、主要ページ崩れ |
| Medium | 可能なら確認 | アニメーション、細かい表示差異 |
| Low | 改善候補 | 軽微なデザイン差異 |
