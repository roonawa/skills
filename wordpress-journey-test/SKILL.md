---
name: wordpress-journey-test
description: Use when WordPress changes require testing contact forms, search, navigation, notification emails, or analytics events through a user journey, including repeatable staging integration checks.
---

# WordPress Journey Test

操作から期待する業務結果までを確認する。フォームは完了画面だけでなく、必要な通知・自動返信・計測も対象に含める。

## 実行方法

共通基盤は `../wordpress-qa/harness/`。[実行手順](../wordpress-qa/references/harness-guide.md) と [設定・module契約](../wordpress-qa/references/configuration.md) を読み、ハーネスから絶対パスのサイト設定を指定する。

1. 重要導線と期待する結果を決める。送信先、通知件数、自動返信、添付、計測イベント、エラー時動作を仕様と照合する。
2. 案件の通常のPlaywrightモジュールを作り、`journeys`へ登録する。操作はgetByRole/getByLabel等、待機は期待要素・通信・APIの状態を使う。実装例は [contact.mjs](../wordpress-qa/harness/examples/contact.mjs)。デモのURLやcleanupを実サイトへそのまま転用しない。
3. 検証データに実行ごとの`token`を入れる。Mailpitが利用可能なら`mail({to,subject,textIncludes,count})`で該当メールを照合する。他のAPIでは同じ契約を案件コードで実装する。
4. `node bin/qa.mjs validate --config <absolute-site.json>`、`node bin/qa.mjs run --config <absolute-site.json> --suite journey`。
5. 必要な結果それぞれにassertと証拠を残す。実サイト導入時は通知停止や誤宛先などの検証用不具合で、テストが失敗することを確認する。

## 判定と環境

| 条件 | 扱い |
|---|---|
| 完了画面あり、メール確認なし | フォーム全体の合格にしない。通知検査を実行、不能ならblocked/review |
| 検証SMTP/APIあり | 宛先・件名・本文・件数を自動照合する |
| メールAPIが停止 | blocked。必要な確認を飛ばしてpassにしない |
| 所定時間内にメールなし／誤宛先 | fail |
| reCAPTCHA実判定で再現性がない | 制御不能ならblocked、人による評価待ちはmanualのreview、決定的な期待応答違反はfail。元の結果を保存し、制御できる検証設定と実設定の確認を分ける |
| 本番で操作・外部送信する | 利用者が許可した操作・宛先・対象データだけ。allowProductionJourneys=trueは権限確認の代わりではない |

計測はタグ読込だけで合格にしない。送信前に監視を開始し、イベント名・測定先・パラメータ・観測期間内の送信回数をassertする。同意あり/なしの期待動作は案件仕様を使い、analytics未送信が正常な状態を区別する。デモの`/collect`はGA4実接続ではない。

## 再実行と証拠

setup/cleanupで準備・後片付けを行い、cleanupは自分のtokenに対応する検証データだけを対象とする。共有受信箱を全削除しない。再試行で二重送信を起こさないよう、ハーネスはretries=0。traceには入力内容が残り得るため架空の検証データを使う。

メール検査の組込範囲はTo・件名・本文・件数。添付、Cc/Bcc、外部メールボックス到達性、観測期間より後の重複配送は別のassert/確認項目を用意する。認可やnonce検証が必要なら、許可された検証環境で正しいユーザー／権限不足／nonce欠落の期待応答を確認する。nonceフィールドの存在だけで防御の有効性を保証しない。

報告には導線、確認した最終結果、証拠、未確認事項を含める。設定済みの他suiteはnot_runのまま返し、このSkillの成功をサイト全体の合格としない。
