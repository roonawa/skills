---
name: wordpress-qa
description: Use when the project is a WordPress-based website (corporate site, LP, recruiting site, small EC) and QA scope, checklists, or Playwright/CI test design are needed before release — including judgment calls on what's safe to automate versus what needs manual review.
---

# WordPress QA

## Overview

WordPressサイト（コーポレートサイト、LP、採用サイト、小規模EC）の品質保証について、確認観点の洗い出し・自動化可否の判断・Playwright/CI設計・手動確認項目の管理を行うための参照ガイド。目的はテストコードを大量生成することではなく、品質判断を標準化し、自動化すべき項目と人間が確認すべき項目を明確に切り分けることにある。

## When to Use

- WordPressサイトの公開前QAで、何を確認すべきか整理したいとき
- 確認項目を自動化すべきか手動にすべきか判断に迷うとき
- PlaywrightテストやCI/CDのQAチェックを設計するとき
- リリースチェックリスト、QA分析結果、不具合報告のフォーマットが必要なとき

対象外: デザインレビュー・文言校正そのものの実施（これらは常に手動確認対象。詳細はCommon Mistakesを参照）

## Core Pattern

判断は常にこの順序で進める。順序を飛ばしてテストコードから書き始めない。

品質リスク → 確認観点 → テスト方法 → 自動化可否 → コード生成

基本方針は3つ。

1. **テストコード生成を目的にしない** — 上記の順序を必ず経由する
2. **全てを自動化しようとしない** — 判定条件が明確で反復実行に価値があるものだけ自動化する。デザイン品質・文言品質・UX・ブランド表現・業務判断は常に手動
3. **CI/CDでは高速チェックを優先する** — 短時間・高検出率・変更影響を受けにくいものをCIに置く。頻繁に壊れるVisual RegressionはQA工程で行う

## Quick Reference: 自動化判断

| カテゴリ | 自動化できる項目 | 手動必須の項目 |
|---|---|---|
| ページ表示 | HTTPステータス、JSエラー、画像読み込み | 見た目の品質 |
| ナビゲーション | リンク存在・リンク切れ | リンク先内容の妥当性 |
| フォーム | 表示・バリデーション・送信可否 | メール受信確認（環境依存） |
| SEO | title/description/canonical/h1/OGP/sitemap/robots.txt/lang属性の**存在** | 内容の妥当性・SEO効果 |
| Security | wp-login/wp-admin/xmlrpc.php露出、Directory Listing、HTTPS、セキュリティヘッダの**存在** | ヘッダ設定内容の妥当性レビュー |
| Analytics | GA4/GTMタグの**存在**、測定ID | 計測仕様の妥当性 |
| reCAPTCHA | スクリプト読込・ウィジェット表示 | Bot判定精度（Google側判定に依存するため完全自動化不可） |
| Responsive | 横スクロール・要素欠落・レイアウト崩れ（スクリーンショット比較） | 余白感・文字サイズ・視認性などデザイン品質 |
| Accessibility | alt属性・label関連付け・コントラスト（axe-core） | 読みやすさ・スクリーンリーダー利用感 |

判断ルール:
- **CIへ配置**: 実行時間が短い／結果判定が明確／頻繁な実行に価値がある／誤検知が少ない
- **QA工程へ配置**: 時間がかかる／環境依存がある／外部サービス依存
- **自動化しない**: 人間判断が必要／誤検知が多い／画面差分確認だけでは判断できない

詳細な確認項目一覧（対象URL・重要度分類など）は [references/qa-checklist.md](references/qa-checklist.md) を参照。

## Implementation

### Input

```yaml
project:
  name:
  url:
cms:
  type: wordpress
pages:
  - /
features:
  contact_form: {enabled: true}
  analytics: {enabled: true, type: GA4}
  seo: {enabled: true}
  recaptcha: {enabled: true}
  responsive: {enabled: true}
security:
  wp_login: {expected: blocked}
  admin: {expected: blocked}
deployment:
  github: {enabled: true}
  ci: {enabled: true}
```

### Workflow

1. **サイト分析** — サイト種別・ページ数・機能数・外部サービス利用・セキュリティリスクを把握する
2. **リスク分類** — Function / UI / SEO / Security / Analytics / Performance / Accessibility / Operation に分類する
3. **QA観点生成** — サイト構成（例: お問い合わせフォームあり）から具体的な確認項目（表示確認・必須入力確認・エラー表示確認・送信確認・完了画面確認）を導出する
4. **重要度分類** — Critical（失敗すると公開不可）／High（公開前に必ず確認）／Medium（可能なら確認）／Low（改善候補）
5. **出力生成** — 次の順で成果物を作る: QA分析結果 → QAチェックリスト → 自動化計画 → Playwrightテストコード → CI/CD設計 → 手動テスト仕様 → リリースチェックリスト

成果物（QA分析結果、QAチェックリスト、自動化計画、手動テスト仕様、不具合報告、リリースチェックリスト）は`.md`ではなく単体で開ける`.html`ファイルとして出力する。テンプレートとスタイルは [references/output-templates.md](references/output-templates.md) を参照。

### Playwrightテストコード生成

自動化計画の行のうち、方法が「Playwright」かつ実施場所が「CI」または「QA」（＝手動ではない）の項目**のみ**をテストコード化する。自動化計画で「手動」と判定された行はコード化しない。

各項目を、対応するカテゴリ（smoke/security/seo/analytics/form/responsive）の`tests/`配下に追加する。ディレクトリ構成・命名規則・Page Object・セレクタ優先順位、および存在確認型（SEOタグ等）と操作型（フォーム等）それぞれの実装例は [references/playwright-ci.md](references/playwright-ci.md) を参照し、その実装例のパターンに沿って書く。

### 最終出力ルール

成果物には必ず次を含める: 品質リスク／QAチェック項目／自動化対象／手動対象／CI対象／Playwright対象／リリース条件。

手動確認が必要な項目は省略せず、完了報告時に対象・確認内容・（可能であれば）再現手順とともにリスト化する。

成果物ファイルは`.html`で保存し、フォーマットの詳細は [references/output-templates.md](references/output-templates.md) に従う。

## Common Mistakes

- **確認観点なしでテストコードを生成する** — 必ず品質リスク→確認観点→テスト方法の順を経由してからコード化する
- **全ページに大量のE2Eテストを作成する** — 重要導線保証と公開事故防止に絞る。網羅性より再現性の高さを優先する
- **スクリーンショット比較だけで品質保証したと判断する** — Visual Regressionは表示崩れの検知はできるが、デザイン品質・余白感・文字サイズの妥当性は別途手動確認が必要
- **人間判断が必要な項目を自動判定扱いする** — デザイン品質・文言品質・UX・ブランド表現・業務判断・reCAPTCHAのBot判定精度は自動化対象に含めない
- **CIに時間のかかる／環境依存のチェックを混ぜる** — Visual RegressionやUX確認はQA工程に置き、CIは高速チェックに専念させる
