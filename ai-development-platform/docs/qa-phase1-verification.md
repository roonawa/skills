# QA Skill 段階1の確認結果

実施日は 2026-11-18。設計は [QA Skill 汎用化の設計書](superpowers/specs/2026-11-18-qa-skills-generalization-design.md) にある。段階1で追加した aidev-qa-strategy、aidev-qa-test-design、aidev-qa-test-review が、見本の2案件で期待どおり動くかを確かめた。

## 方法

見本ごとに `aidev init qa-<見本> --template qa` で一時リポジトリを作った。`templates/qa/samples/<見本>/` の requirements.md、knowledge/、plan/acceptance.md を写し、`aidev skill add` で3つの Skill を入れた。EXPECTED.md は写していない。`aidev check` はどちらの見本でも profile が passed だった。

テスト仕様書の作成とレビューは、互いに独立した新しいセッション（サブエージェント、Sonnet）で行った。人が答える場面は、質問と仮の判断を cases/QUESTIONS.md に書いて先へ進める指示にした。aidev-qa-strategy は今回は動かしていないため、plan/strategy.md はない。

レビュー用の版は、作成された仕様書から、EXPECTED.md の「わざと抜く観点」の AC を参照するケースを機械的に削り、QUESTIONS.md も外して作った。

## 結果

|項目|見本 Web（sample-web）|見本 Desktop（sample-desktop）|
|---|---|---|
|作成したケース数|47（login 7、loan-list 9、loan-detail 7、loan-new 17、loan-csv 7）|27（list 9、save 10、delete 8）|
|対応する TC のない AC|0 件（15 件中）。期待どおり|0 件（10 件中）。期待どおり|
|質問など|質問 10 項目|質問 8 件、仮の前提 5 件、追加 AC の提案 4 件|
|レビューにかけた版|AC-008 と AC-015 のケース 4 件を削った 43 ケース|AC-009 のケース 5 件を削った 22 ケース|
|レビューの指摘|AC-008 と AC-015 を「漏れ・重要度 高」として指摘。期待どおり|AC-009 を「漏れ・重要度 高」として指摘。期待どおり|

### 見本 Web

EXPECTED.md の観点は、次のものがすべて作られた。作られなかったものはない。

- AC-008（staff が他人の貸出の URL を直接開いて 403）は TC-detail-003・004
- AC-015（staff の CSV への直接アクセス）は TC-csv-006・007
- AC-012 の境目（当日、30 日後、31 日後、前日）
- AC-014 の見出し行、列順、日付形式

レビューは、URL の直接指定でステータス 403 になることと本文に内容が出ないことを確かめるべきだと指摘した。画面の遷移やボタンの表示で代用しないことも挙げた。

### 見本 Desktop

AC-009（未選択で削除）は 5 ケースで、確認が出ないこと、警告が出ること、表が変わらないことの 3 点を含む。AC-010（起動直後の未選択）も作られた。EXPECTED.md と観点を照らし合わせたのは AC-009 と AC-010 だけである。ほかの AC は、どれにも1件以上のケースがあることだけを確かめた。レビューは AC-009 を指摘し、3 点の確認内容も挙げた。

## 期待と異なった点

優先度が期待どおりにならなかった。EXPECTED.md では AC-008（Web）と AC-009（Desktop）の優先度が「高」だが、plan/strategy.md がないため、どちらも全ケースが「中」と「⚠ 要確認」になった。この差は Skill の不具合ではない。aidev-qa-test-design は、plan/strategy.md がないときは優先度を推測しないように作ってある。aidev-qa-strategy から始めて優先度まで確かめ直す確認は、段階2の確認に回した。段階2の確認では strategy から design までを通しで動かす。

## 残件

作成を行ったセッションが、Skill の本文に現在形で書かれた `aidev qa trace` を実行しようとした。このコマンドは段階4で作る。確認の後、このブランチで本文を直し、`aidev qa trace` と、まだない aidev-qa-test-run、aidev-qa-cause-repro を後の段階で追加する予定として書いた。対応のない AC は、今は手で数えるとした。
