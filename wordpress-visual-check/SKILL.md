---
name: wordpress-visual-check
description: Use when a WordPress theme, CSS, content layout, or responsive behavior needs representative-page screenshot comparison and automated accessibility checks, with human review of visual baselines.
---

# WordPress Visual Check

テンプレート代表＋コンテンツ例外のページを検査し、表示差分と人の判断を分ける。画像の一致だけでデザイン品質やアクセシビリティ適合を保証しない。

## 手順

共通基盤は `../wordpress-qa/harness/`。[実行手順](../wordpress-qa/references/harness-guide.md) と [visuals設定](../wordpress-qa/references/configuration.md) を読み、絶対パスのサイトJSONを指定する。

1. 変更したテンプレートと主要導線を選ぶ。長いタイトル、画像なし、長い表、最大件数、固有ブロックのページも候補に含め、選定理由をreasonへ記録する。
2. ページと画面幅の組み合わせごとにvisualsを設定する。readyは表示準備を表す要素。単なるbodyでは非同期完了を保証できない場合がある。必要な待機・フォント確認は案件に合わせて追加する。
3. `node bin/qa.mjs run --config <absolute-site.json> --suite visual`。横はみ出し・画像読込・JS例外・フォントerror・axe・画像比較の結果と証拠を見る。
4. 基準がない、または実行環境が変わった画像はreview。候補画像を意図したデザインと照合し、承認済みの場合だけ `node bin/qa.mjs approve-baseline --config <absolute-site.json> --run <run-directory> --id snapshot.<id>` を実行する。
5. 承認後に再実行する。既存基準との差分が不具合なら修正し、意図した変更ならレビューして基準更新する。失敗を消す目的で全画像を一括更新しない。

## 安定性と判断

| 状況 | 判断 |
|---|---|
| 基準画像なし | 候補保存＋review。初回画像を自動採用してpassにしない |
| フォント・画像の読込失敗 | 差分レビューより前に原因を調べる。壊れた表示を基準に採用しない |
| OS・ブラウザー版変更 | 同じ環境の基準を使うか、明示的に再レビュー |
| 日時等の変動 | 最小範囲をmaskし理由を残す。主要CTAや不具合箇所を隠さない |
| 余白感、文章の意味、操作の分かりやすさ | 自動結果とは別に人が確認 |

例: 共通ヘッダー変更なら、各テンプレートの代表ページをモバイルとデスクトップで比較し、メニュー開閉・フォーカス移動はjourneyで操作確認する。全100ページで同じ操作を繰り返す必要はないが、代表ページだけで全コンテンツを保証したとは報告しない。

ハーネスの既定はChromiumのみ。必要な実機・他ブラウザー・キーボード・スクリーンリーダー確認はmanualへ残す。axeが指摘ゼロでも適合の証明ではない。CIから一律除外せず、実行環境・データ・基準が安定した対象をCIへ配置する。

報告は対象と選定理由、画像差分、axe結果、承認待ち、未確認事項を含める。設定済み他suiteのnot_runはそのまま統括へ返す。
