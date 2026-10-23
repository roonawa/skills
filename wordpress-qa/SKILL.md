---
name: wordpress-qa
description: Use when a WordPress site needs reusable QA cases, comprehensive site testing, grouped result review, failure-cause investigation, user-impact explanation, or a release decision based on automated evidence and unresolved manual checks.
---

# WordPress QA

リスクから必要な検査を選び、専門Skillと共通ハーネスの結果を統合する。期待結果を明文化でき、環境を制御できる検査は自動化する。人は期待結果の合意・意図の評価・例外判断を担当する。

## 担当と入口

| 依頼 | 担当Skill | ハーネスsuite |
|---|---|---|
| 全対象URLのHTTP・内部リンク・SEO公開設定・エンドポイント方針 | [wordpress-site-audit](../wordpress-site-audit/SKILL.md) | audit |
| フォーム・検索・メニュー・メール・計測 | [wordpress-journey-test](../wordpress-journey-test/SKILL.md) | journey |
| 代表ページの画像比較・横はみ出し・axe | [wordpress-visual-check](../wordpress-visual-check/SKILL.md) | visual |
| 管理設定の期待値照合（REST・管理画面） | [wordpress-admin-check](../wordpress-admin-check/SKILL.md) | admin |
| 投稿・権限・キャッシュ・予約、更新復元、追加導線・性能・互換性 | このSkillと[追加検査ガイド](references/extended-checks.md) | publishing / authz / cache / operations / scheduled 等 |
| 全体計画、リスク整理、公開判断材料 | このSkill | allと手動証拠の統合 |

専門Skillは単独でも使用できる。必要なSkillだけ読み、共通ハーネスを再利用する。並列エージェントの起動や外部への書込みを、このルーティングだけで許可しない。

利用者がブラウザーで状況を見たい場合は、ハーネスで `npm run ui -- --config <absolute-site.json>` を起動する。URL・起動方法・画面操作は [利用手順](references/harness-guide.md)。設定なしの `npm run ui` は同梱のローカルデモ。実サイトはUIの「サイトを登録」で検査項目・期待値・認証を登録し、「設定を編集」で更新できる。UIでもCLIと同じ検査台帳・公開条件を使い、画面上の進捗と過去の実行結果を区別する。

## 進め方

実サイトの初回検査・他サイトへの展開では [実サイトQAの設計・運用](references/field-qa-playbook.md) を読む。大量のURL別結果を整理する場合や、不合格の原因・利用者への影響を聞かれた場合は [分類・原因調査・影響説明](references/failure-triage.md) を読む。案件のURL・認証情報・期待値は案件側へ保存し、このSkillに埋め込まない。

1. **対象を確定**: サイト種別、対象環境、変更箇所、公開URL一覧、テンプレート、重要導線、外部連携、実行可能な操作を確認する。足りない情報は独立して進められる検査と分ける。
2. **期待結果とリスクを設定**: 品質リスク→確認観点→期待結果→テスト方法の順で決める。canonicalやメール宛先を実際の出力から無批判に正解へコピーしない。
3. **検査台帳を作る**: [設定仕様](references/configuration.md) に従いサイトJSONを作成する。全ページの軽量検査、重要導線、テンプレート代表＋例外ページ、必要な手動確認を登録する。未登録の機能はハーネスでは検出できないので、[観点一覧](references/qa-checklist.md) と照合する。
4. **実行する**: [利用手順](references/harness-guide.md) を使い、専門Skillの指針に従って検査する。検査コードは毎回作り直さず、既存の共通検査と案件モジュールを保守する。
5. **結果を解釈する**: fail、blocked、not_run、reviewを区別する。検査漏れや期待値誤りがあれば台帳を直し、必要な検査を再実行する。
   失敗時は「実行経過・失敗時の証拠」の期待値・取得値・最終到達操作を確認する。停止した実行を合格にしない。未回収の投稿がある場合は同じ実行履歴から回収してから再実行する。
6. **公開判断材料をまとめる**: 対象環境・変更範囲・対象URL/導線・自動結果・手動証拠・未解決事項・適用外理由・公開条件をHTMLで共有する。実行レポートはハーネスが生成する。別の資料が必要な場合は [出力契約](references/output-templates.md) を使う。

## 公開条件

- 必要な機能・変更影響が検査台帳に登録され、未登録の検査漏れがない。
- 必須の自動検査がpass、または理由のあるnot_applicable。
- 必須の手動確認が証拠付きで完了し、Critical/Highの不具合と未確認リスクが解消、または権限のある責任者の判断が記録されている。
- 設定済みの他suiteを未実行のまま、audit単体成功を全体成功にしない。
- ハーネスは必須manual/human-reviewを自動解除しない。UIの結果詳細から判定者・実施内容・証拠を追記し、元の自動結果と区別する。都合よくrequired:falseに変更して緑にしない。
- ハーネスの終了0は「定義した台帳の条件充足」。サイト全体の品質保証・公開操作の許可ではない。

重要度: Critical＝表示不能・重要導線不能・機密漏洩等、High＝主要表示・公開設定・必要計測の不具合、Medium/Low＝影響に応じて計画対応。技術的な露出項目だけで重大度を固定せず、サイト仕様と実害で決める。

## 効率と検出力

- 全ページへ同じE2Eを複製しない。HTTPで決まるものは全件audit、操作と表示は重要導線・代表＋例外へ集中。
- テーマ/CSS変更は代表ページ、フォーム変更は通知まで、SEO設定変更は全URL、コア/プラグイン更新は重要導線＋テンプレートへ展開。不明な影響は広めに確認し定期全件も残す。
- Visual Regressionは環境・データを固定できればCIへ入れる。時間や外部依存で別ジョブにする。CI例は [Playwright/CI方針](references/playwright-ci.md)。
- 初回導入・検査変更時は隔離fixtureでnoindex、誤canonical、メール未着等を注入し、狙った検査が失敗することを確認する。本番へ故障を注入しない。
- fixture成功と[実WordPress検証](references/real-wordpress.md)の成功を区別する。実WordPress検証ではコア・テーマ・プラグイン・DB・PHPの構成を記録し、確認していない構成へ結果を一般化しない。
- 実行時間だけでなく誤検知、再実行時の揺れ、原因調査時間、公開後の漏れを改善指標にする。

## よくある誤り

存在確認だけで防御・通知・計測を保証しない。基準画像の自動採用で差分を消さない。環境依存を理由にメール確認を一律手動にしない。未実行や通信不能を合格扱いしない。デザイン・文章・使いやすさの最終判断は自動検査と区別して残す。

## 実サイトでの判断原則

- URLごとの同一検査は実行・証拠を保持したまま、表示だけを分類でまとめる。分類数、ケース数、原因数を分ける。
- 共通の表示準備で失敗した場合、後続のlayout・axe・画像比較が実行されたとは扱わない。エラー名だけで影響を断定しない。
- サイトマップ掲載URLを一律indexable:trueにしない。カート・完了ページ等の公開方針を確認する。観測値に合わせただけの期待値変更は禁止。
- 長時間処理の完了通知や終了コードだけで全件成功にしない。対象runのresults.json、完了状態、未実施を確認する。
- 原因と利用者影響は、再現済み／技術的に裏取り済み／可能性／未確認を区別し、次に必要な確認を示す。

## 検査漏れの防止

初回設計・サイト登録・網羅性の確認では[観点とケース生成](references/coverage-generation.md)を読み、この領域の必要観点を具体的なケースIDへ対応付ける。未判定・期待値未設定を台帳から除外しない。共通の生成ケースは出発点であり、登録した数だけで網羅や合格を宣言しない。
