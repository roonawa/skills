---
name: orchestrating-capi-screen-verification
description: 信州大学キャンパス情報システムのリニューアルで、ある画面のcapi-changes（campus-api移行実装）が完了し、campus-playwrightの着手前ベースライン記録も既にある状態で、capi-authz-testの認可検証とcampus-playwrightの新旧比較回帰・エビデンス収集までを画面単位で一気通貫に実行したいときに使う。
---

# orchestrating-capi-screen-verification

## Overview

capi-changesが完了した画面は、`capi-authz-test`（認可検証）と`campus-playwright`（新旧比較回帰）の両方を通す必要があるが、両者は独立したスキルとして別々に起動されるため、素朴に並べて実行するだけでは橋渡しが漏れる。特に、`campus-playwright`のマニフェストが既知の認可不具合を`excluded`（`reason: known-authz-bug`）として抱えている画面では、その不具合が**今回のcapi-changesで実際に解消されたか**を`capi-authz-test`の実行結果でしか確認できない。解消済みなら通常の`operations`へ格上げすべきだし、未解消でリリースを優先するなら`acceptedRisks`として承認記録付きで含めるべきだが、どちらも`campus-playwright`単体では判断できない。

**このスキルの核心は、実行順序を「`capi-authz-test`を先に完走させ、その結果を`campus-playwright`のマニフェスト判断へ反映してから画面回帰を実行する」に固定し、両スキルの成果物（`coverage/authz/*.json`・不具合一覧と、screenshot/trace）を画面単位のフォルダへ統合して完全性を確認するところまでを担う**点にある。各サブスキル自体の検証ロジック・承認フローは変更せず、呼び出す順序と、両者の間で本来つながっているはずの情報（既知不具合の解消状況）を確実に橋渡しすることだけに専念する。

## When to Use

- 対象画面のcapi-changes（campus-api移行実装）が完了し、`campus-playwright`の着手前ベースライン（画面マニフェスト・テストコード）も既に存在する状態で、認可検証と画面回帰・エビデンス収集を画面単位で一気通貫に実行したいとき

**対象外（別スキルの領域）：**
- capi-changes（実装）そのもの
- `campus-playwright`の着手前ベースライン記録（特性テストの新規作成）自体：無ければ案内して停止する（ステップ0）。代わりに実施はしない
- 現行版・新版の3点照合による差分の当否判定（「意図した差分」かどうかの判断） → `capi-regression-test`（本スキルは`campus-playwright`ステップ9の新旧比較「成功/失敗」の事実確認までを範囲とする）
- 各サブスキル自体の検証基準・承認手順の変更：本スキルは呼び出し順序と成果物の橋渡し・統合のみを担う

**REQUIRED SUB-SKILL: capi-authz-test** — ロール別・行レベルの認可検証本体（ステップ1）。
**REQUIRED SUB-SKILL: campus-playwright** — 新旧比較回帰の実行本体（ステップ3。ステップ2の反映結果次第でマニフェスト更新〜再承認〜テストコード生成の再実行を伴う）。
**REQUIRED SUB-SKILL: capturing-playwright-evidence** — `campus-playwright`が実行したテスト結果のエビデンス収集（ステップ4）。

`capi-saml-login`は上記2スキルがログインを要する場面でそれぞれ内部的に要求するサブスキルであり、本スキルから直接呼び出すことはしない（各スキルの`When to Use`の対象外節・REQUIRED SUB-SKILL宣言に従う）。

## Core Pattern

**Before**：担当者が画面ごとに「`capi-authz-test`を回す」「`campus-playwright`を回す」を別々のタイミング・別々の担当者で実施する。認可の既知不具合（`campus-playwright`マニフェストの`excluded`）が今回のリリースで解消されたのか、リリース優先で先送りされたのかを`campus-playwright`側は知る手段が無く、`excluded`のまま放置される（解消済みなのに検証されない）か、逆に承認記録なしに現状挙動が`operations`へ紛れ込む。認可検証の不具合一覧（`coverage/authz/*.json`）と画面回帰のエビデンス（`evidence/`）も別々の場所に残り、「この画面は検証完了」と画面単位で言える状態を誰も保証できない。

**After**：画面情報を受け取ったら、まず`capi-authz-test`を対象操作について完走させる。その結果（不具合の解消/未解消）を`campus-playwright`マニフェストの`excluded`／`acceptedRisks`判断へ反映し、変更があれば開発者承認を得たうえで画面回帰（`campus-playwright`ステップ9の新旧比較）を実行する。両スキルの成果物を画面単位フォルダへ統合し、完全性ゲートで抜け漏れを検知してから完了報告する。

**具体例（成績入力画面 `SeisekiInput.vue`）**：`campus-playwright`のマニフェストには、担当授業・登録期間外でも成績を書き込めてしまう既知不具合（`campus-api_設計書.md`5章#7、`capi-authz-test`のCore Patternで扱う不具合そのもの）が`excluded`（`reason: known-authz-bug`）として記載されている。本スキルでは、まず`capi-authz-test`のテストケース`AZ-102`（担当外授業への書き込みが拒否されるか）を実行し、①`成功`（拒否される＝解消済み）なら`excluded`を`operations`へ格上げする変更を提案、②`失敗`（許可されてしまう＝未解消）で、かつリリース優先の方針が承認されているなら`acceptedRisks`へ承認記録付きで追加、③方針が未承認ならその項目を`excluded`のまま維持し画面回帰の実行を保留して開発者へ差し戻す——という三分岐（ステップ2）で判断する。

## 全体フロー

```text
[ステップ0 前提確認]
  ↓
[ステップ1 capi-authz-test 実行]
  ↓
[ステップ2 認可検証結果のマニフェストへの反映判断]
  ↓（保留に該当する項目が無い、または保留を明記した上で進める）
[ステップ3 campus-playwright 新旧比較実行]
  ↓
[ステップ4 capturing-playwright-evidence によるエビデンス収集]
  ↓
[ステップ5 画面単位フォルダへの統合・完全性ゲート]
  ↓
[ステップ6 完了報告]
```

## ステップ0 前提確認

画面情報として最低限以下を受け取る。不足があれば起動元に確認する。

| 項目 | 内容 |
|---|---|
| 画面ID | `campus-playwright`のマニフェスト（`coverage/screens/<ScreenId>.json`）を特定するためのID |
| capi-changesの完了状況 | 対象画面の新版実装がPT環境にデプロイ済みか |
| 対象ロール（任意） | 特定ロールに絞りたい場合のみ指定。省略時はマニフェスト・正解表から到達可能な全ロールが対象になる |

以下の前提を両方満たさない場合は、本スキルを開始せず該当スキルの実施を案内して停止する。

| 前提 | 満たさない場合の対応 |
|---|---|
| `coverage/screens/<ScreenId>.json`（`campus-playwright`の着手前ベースラインマニフェスト）が既に存在する | `campus-playwright`（着手前のベースライン記録）を先に実施するよう案内し、本スキルは停止する |
| 対象画面のcapi-changesがPT環境に完了済みである | `capi-authz-test`・`campus-playwright`ステップ9の新旧比較のいずれも実行対象が存在しないため、完了を待つよう案内して停止する |

前提を満たしたら、マニフェストの`operations`／`reports`一覧（画面が呼ぶ操作・帳票エンドポイントの一覧。承認済みマニフェストに確定済み）に加えて、`excluded`のうち`reason: known-authz-bug`に該当するエントリの対象操作（`target`欄）も対象操作一覧へ含め、`capi-authz-test`ステップ0（対象操作の特定）の入力としてそのまま渡す。

**`excluded(known-authz-bug)`の対象操作を漏らさないこと**：この種のエントリが指す操作は、正常系の記録が無い（`operations`/`reports`のどちらにも登場しない）書き込み系操作であることがある（例：担当外授業への書き込みを拒否できていない`createTblBuseiseki`が、担当内書き込みの正常系シナリオ自体は別途用意されていない場合）。`operations`／`reports`だけを機械的に拾うと、まさにステップ2で判断が必要なその操作が対象一覧から漏れ、ステップ1（`capi-authz-test`実行）でも検証されないまま`hasCase`が永久に「No」になる。`excluded`の`known-authz-bug`エントリは必ず個別に拾い出し、対象操作一覧へ明示的に加える。

これにより、`別紙D1_画面別_呼び出されるAPI一覧.csv`を画面から辿り直す手間を省略できる。

## ステップ1 capi-authz-test 実行

`capi-authz-test`のステップ0〜9を、ステップ0で渡した対象操作一覧に絞って完走させる。ログインは同スキルのREQUIRED SUB-SKILLである`capi-saml-login`に委譲される（本スキルから直接操作しない）。

- 不具合が見つかっても`capi-authz-test`ステップ8の方針どおりその場で修正しない。`status`を失敗として記録し、ステップ9の不具合一覧に含めたまま次へ進む
- `capi-authz-test`の完了条件（対象操作すべてに`coverage/authz/<操作名>.json`が存在し、テストケース・分岐対応がレビュー承認済み）を満たしたことを確認してからステップ2へ進む

## ステップ2 認可検証結果のマニフェストへの反映判断（非自明な分岐）

ステップ1の結果と、対象画面の`campus-playwright`マニフェストの`excluded`（`reason: known-authz-bug`）を突き合わせ、エントリごとに以下の判断を行う。既知不具合に対応しないエントリ（`dead-code`等の`excluded`、通常の`operations`／`reports`）はこの判断の対象外。

```dot
digraph reflect_authz_result {
    entry [label="excluded(known-authz-bug)の\n各エントリ", shape=box];
    hasCase [label="対応するcapi-authz-testの\nテストケースが実行され、\nstatusが確定しているか？", shape=diamond];
    notReady [label="未実施：capi-authz-test側の\n完了条件を満たしていないため\nステップ1へ戻る", shape=box];

    resolved [label="statusが成功\n（拒否される＝解消済み）か？", shape=diamond];
    toOperations [label="excludedからoperations/reportsへ\n移動する変更を提案し、\ncampus-playwright側の\nレビュー承認(ステップ7)を得る", shape=box];

    riskDecision [label="リリース優先で\n是正を別フェーズに回す\n承認済みの方針か？\n（担当者個人の判断では決めない）", shape=diamond];
    toAcceptedRisks [label="acceptedRisksへ追加\n（decidedBy/decidedDate必須）。\ncampus-playwrightの\nレビュー承認(ステップ7)を得て\n通常のシナリオとして含める", shape=box];
    holdEntry [label="excludedのまま維持し、\n当該操作を含む画面回帰の実行を保留。\n開発者へ差し戻し\n完了報告に未完了として記載", shape=box];

    entry -> hasCase;
    hasCase -> notReady [label="No"];
    hasCase -> resolved [label="Yes"];
    resolved -> toOperations [label="Yes"];
    resolved -> riskDecision [label="No"];
    riskDecision -> toAcceptedRisks [label="Yes"];
    riskDecision -> holdEntry [label="No/未承認"];
}
```

**要点**：
- `toOperations`・`toAcceptedRisks`のいずれも、マニフェスト変更は`campus-playwright`ステップ7相当のレビュー承認を経てから反映する。本スキルが承認を代行して即時反映してはならない
- `holdEntry`（保留）に該当する項目がある画面は、その操作を含む範囲についてステップ3（新旧比較）を実行しない。他の操作に保留が無ければ、保留対象を除いた範囲でステップ3へ進めてよい
- `toOperations`／`toAcceptedRisks`に決まった項目は、`campus-playwright`ステップ8（テストコード生成）でその項目のテストコードが未生成の場合は生成し直す必要がある（マニフェストが変わった以上、対応するテストコードも追従させる）

## ステップ3 campus-playwright 新旧比較実行

ステップ2で`holdEntry`に該当しなかった範囲について、`campus-playwright`ステップ9「新旧比較を伴う実行」（`allcampus`〈ST〉→`allcampus-regression`〈PT〉の順、同一テストコード）を実施する。

- ステップ2でマニフェストを更新した場合は、`campus-playwright`ステップ7（再承認）→ステップ8（該当シナリオのテストコード生成・更新）→ステップ9（実行）を該当エントリについて再実行する
- `test.skip()`・アサーション緩和でPT側だけを通す対応は`campus-playwright`のCommon Mistakesどおり禁止。失敗は隠さず報告する

## ステップ4 capturing-playwright-evidence によるエビデンス収集

ステップ3で実行したテストの結果を`capturing-playwright-evidence`のステップ1〜7（撮影設定確認・実行・失敗性質の判定・成果物収集・目視確認・完全性ゲート・保存）に従って収集する。`campus-playwright`が独自に撮影を行うわけではなく、このスキルが実行結果からエビデンスを整理する担当であることに注意する。

## ステップ5 画面単位フォルダへの統合・完全性ゲート

`capturing-playwright-evidence`が出力した`evidence/<screen>_<timestamp>/`配下に、ステップ1の認可検証結果（対象操作分の`coverage/authz/*.json`のコピーと、該当する不具合一覧の抜粋）を追加し、画面単位で1つの受け渡し用フォルダに統合する。

統合後、マニフェストの`operations`／`reports`／`acceptedRisks`全項目を基準に、以下の完全性ゲートを実施する。「だいたい揃った」で完了報告に進まない。

| 観点 | 確認内容 | 判定 |
|---|---|---|
| 認可検証 | 対象操作に対応する`coverage/authz/*.json`のテストケースが実施済みか（該当が無い操作は非該当） | 完全／不完全／非該当 |
| 画面回帰 | 対象操作に対応するST→PT新旧比較の実行結果（成功/失敗）が記録されているか | 完全／不完全 |
| エビデンス | 画面表示・内部データ・帳票（該当する場合）のスクリーンショット/生データ/ファイルが揃っているか | 完全／不完全 |
| マニフェスト整合 | ステップ2で決めた反映（`toOperations`/`toAcceptedRisks`/`holdEntry`）が実際のマニフェストに反映されているか | 完全／不完全 |

不完全な観点があれば、原因に応じて該当ステップへ戻る（認可検証の不足はステップ1、画面回帰の不足はステップ3、エビデンスの不足はステップ4、マニフェスト整合の不足はステップ2）。

## ステップ6 完了報告

画面単位で以下を報告する。

- ステップ1（`capi-authz-test`）の実施率・不具合一覧
- ステップ2の反映結果（`excluded`→`operations`/`acceptedRisks`へ移した項目、保留〈`holdEntry`〉にした項目とその理由）
- ステップ3（`campus-playwright`新旧比較）の成功/失敗結果（保留により未実施の項目はその旨を明記）
- ステップ5の完全性ゲート結果と、統合済みエビデンスフォルダの場所

保留（`holdEntry`）が1件でもある画面は、「検証完了」ではなく「部分完了・要開発者判断」として報告し、完了と誤解されないようにする。

## Quick Reference

| 段階 | 担当スキル | このスキルの役割 |
|---|---|---|
| 認可検証 | `capi-authz-test` | 対象操作を渡して完走させ、結果を受け取る（判断基準は変更しない） |
| 結果の橋渡し | （本スキル固有） | 既知不具合の解消状況をcampus-playwrightマニフェストの判断へ反映する三分岐（ステップ2） |
| 画面回帰 | `campus-playwright`（ステップ9） | 保留項目を除いた範囲で新旧比較を実行させる |
| エビデンス収集 | `capturing-playwright-evidence` | 画面回帰の実行結果を撮影規約どおりに整理させる |
| エビデンス統合 | （本スキル固有） | 認可検証結果と画面回帰エビデンスを画面単位フォルダへ統合し、完全性ゲートを通す |
| ログイン | `capi-saml-login`（間接） | 上記2スキルが内部で必要時に呼ぶ。本スキルから直接操作しない |

**実行順序が固定である理由**：`campus-playwright`マニフェストの`excluded`（`known-authz-bug`）／`acceptedRisks`の判断は、認可是正が実際に効いているかという事実（`capi-authz-test`の実行結果）に依存する。順序を逆にすると、未確定の判断のまま画面回帰を通してしまい、後から「意図した仕様」か「是正待ちのリスク」か区別できなくなる。

## Common Mistakes

1. **`capi-authz-test`の結果を待たずに`campus-playwright`の新旧比較を先に実行してしまう**：既知不具合の是正状況が未確定のまま回帰を通すと、`acceptedRisks`の承認記録なしに現状挙動が既成事実化してしまう
2. **`capi-authz-test`の結果（解消/未解消）を`campus-playwright`マニフェストへ反映せず放置する**：`excluded`/`acceptedRisks`が実態と食い違ったまま次フェーズへ進んでしまい、次に見た担当者が誤った前提で判断する
3. **前提確認（ステップ0）を省略し、ベースライン（`coverage/screens/<ScreenId>.json`）が無い画面でオーケストレーションを開始してしまう**：比較対象のテストコードが無く、新旧比較そのものが実行できない
4. **マニフェスト変更（`excluded`→`operations`/`acceptedRisks`への移動）を、`campus-playwright`ステップ7相当の開発者承認を経ずに反映してしまう**：本スキルは橋渡しを担うだけであり、承認そのものを代行してはならない
5. **保留（`holdEntry`）に該当する項目があるにもかかわらず、画面全体を「検証完了」として報告してしまう**：一部の操作が是正未承認のまま保留になっていることを埋もれさせず、部分完了として明記する
6. **認可検証結果と画面回帰エビデンスを別々の場所に残したまま完了報告する**：完全性ゲート（ステップ5）を省略すると、画面単位で「両方揃って検証完了」と言える状態を後から誰も確認できなくなる
7. **各サブスキル自身の判定基準（`capi-authz-test`の拒否判定、`campus-playwright`の記録深度判定等）を、オーケストレーションの都合で緩めてしまう**：本スキルは順序と橋渡しのみを担い、各サブスキルの検証ロジックは変更しない
8. **ステップ0で`operations`／`reports`だけを機械的に対象操作一覧へ渡し、`excluded`（`known-authz-bug`）の対象操作を含め忘れる**：正常系の記録が無い書き込み系操作など、`operations`／`reports`のどちらにも登場しない既知不具合対象がある場合、`capi-authz-test`の対象から漏れて`status`が確定せず、ステップ2の`hasCase`判断が永久に「未実施」のまま進めなくなる

## 完了条件

- ステップ0の前提（ベースライン存在・capi-changes完了）を満たしている
- `capi-authz-test`が対象操作について完走し、同スキルの完了条件（不具合一覧確定を含む）を満たしている
- 既知不具合の反映判断（ステップ2）が全エントリについて完了し、`toOperations`/`toAcceptedRisks`は開発者承認を得ている
- 保留（`holdEntry`）に該当する項目がある場合、その旨と対象操作が完了報告に明記されている
- 保留を除く範囲で`campus-playwright`ステップ9（新旧比較）が完了している
- `capturing-playwright-evidence`によるエビデンス収集・完全性ゲートを通過している
- 画面単位フォルダへの統合・完全性ゲート（ステップ5）で不完全な観点が無い、またはあれば理由付きで報告済みである
