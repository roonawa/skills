---
name: capturing-playwright-evidence
description: Playwright回帰テストスキル（campus-playwright等）が生成したテストコードを実行し、その結果（スクリーンショット・トレース等）をエビデンスとして収集・整理し、C-HUB等のタスク管理システムに依存せずローカルにそのまま保存・受け渡ししたいときに使う。
---

# capturing-playwright-evidence

## Overview

Playwrightのテストコードを実行すると、テスト自身が本物の画面を操作してスクリーンショット・トレースを生成する。このスキルは、その実行結果を「証明すべき観点」ごとに整理し、目視確認・完全性ゲートを経てローカルにそのまま保存・受け渡しできる形にする。C-HUB等のタスク管理システムへの依存を持たない。

## When to Use

- Playwrightのテストコード（`campus-playwright`が生成したもの等）を実行し、その結果をエビデンスとして収集・整理し、C-HUBに依存せずローカルに保存・受け渡ししたいとき

**対象外（別スキルの領域）：**
- Playwright MCPでその場でライブ操作しながら撮影すること → `chub-capture-evidence`
- テストコード自体の生成 → `campus-playwright`
- C-HUBへの投稿 → `chub-post-evidence`
- 現行版・新版の差分判定 → `capi-regression-test`
- テストコードの中身（何を検証するか）の設計

## Core Pattern

**Before**：`chub-capture-evidence`を流用しようとすると、タスクID必須・差し戻し理由確認・`task_progress.py`連携などC-HUB前提の手順が邪魔になり、C-HUBに紐づかない文脈では使えない。

**After**：撮影のノウハウ（観点先出し、条件一致、el-dialog撮影、目視確認ゲート、完全性ゲート）はそのまま流用しつつ、実行主体をPlaywright MCPのライブ操作からテストコード実行に置き換え、成果物をローカルフォルダ／zipとして受け渡せる形にする。

**具体例**：`campus-playwright`が生成したポータル画面のテスト（`portal.spec.ts`）を`npx playwright test`で実行すると、`test-results/`配下にスクリーンショット・トレースが生成される。これを`evidence/portal_<timestamp>/`へ集約し、観点ごとの取得状況を判定表にまとめてzip化する。

## 全体フロー

```text
[撮影設定の確認]
  ↓
[テスト実行]
  ↓
[失敗性質の判定]
  ↓
[成果物の収集・命名整理]
  ↓
[撮影直後の目視確認]
  ↓
[完全性ゲート]
  ↓
[保存・受け渡し]
```

## ステップ1 撮影設定の確認

実行前に、対象のテストコード・`playwright.config.ts`を確認し、以下が設定されているかを確認する。

- `page.screenshot()`の明示的な呼び出し、または設定の`screenshot: 'on'`／`'only-on-failure'`
- 必要に応じて`trace: 'on'`／`video: 'on'`

設定されていない場合、実行しても何も撮れずに終わる。実行前に指摘し、追加を提案する。

## ステップ2 テスト実行

`npx playwright test <対象spec>`等で実行する。実行結果（pass/fail）と、レポート（HTML reporter等）・成果物の出力先を確認する。

## ステップ3 失敗性質の判定（非自明な分岐）

テストが失敗した場合、それが「証拠として価値のある失敗」か「テストコード自体の不具合」かを判定する。

```dot
digraph failure_triage {
    failed [label="テスト失敗", shape=box];
    matchesExpectation [label="失敗内容が\n検証したかった差分・不具合と\n一致するか？", shape=diamond];
    validEvidence [label="想定内の失敗\n→ エビデンスとして収集する", shape=box];
    brokenTest [label="テストコード自体の不具合\n（セレクタ崩れ・タイミング等）\n→ エビデンスではなく\nテスト側の修正課題として報告", shape=box];

    failed -> matchesExpectation;
    matchesExpectation -> validEvidence [label="一致する"];
    matchesExpectation -> brokenTest [label="一致しない"];
}
```

判定を誤ると、前者を「テストが壊れているだけ」として握りつぶし本来価値のある不具合検知を見逃す、あるいは後者を不具合として誤報告する、のいずれかが起きる。

## ステップ4 成果物の収集・命名整理

生成されたスクリーンショット・トレース等を1つの受け渡し用フォルダ（例：`evidence/<シナリオ名>_<タイムスタンプ>/`）に集約する。ロール・シナリオ・修正前後がペアと分かる命名にする（例：`<screen>_<role>_<シナリオ>.png`）。複数回の実行結果を同じフォルダへ上書きしない。

## ステップ5 撮影直後の目視確認

収集したスクリーンショットをReadツールで開き、以下を確認する。確認せずに次工程へ進まない。

- 上端・下端まで写っているか（途中で切れていないか）
- 証明したい要素が実際に写っているか
- el-dialog（Element Plusダイアログ）等、`overflow: scroll`を持つ要素は全体が展開された状態か（下記ヘルパー参照）

### el-dialog全体撮影ヘルパー

内部`.el-dialog__body`が`max-height + overflow:scroll`を持つため、ナイーブな撮影では上部のみしか写らない。テストコード側で以下を`page.evaluate()`し、`scrollHeight`に合わせてビューポートを広げてから撮影する。

```javascript
window.__prepCapture = () => {
  const dialog = document.querySelector('.el-dialog');
  if (!dialog) return null;
  document.documentElement.style.overflow = 'visible';
  document.body.style.overflow = 'visible';
  let p = dialog.parentElement;
  while (p && p !== document.body) {
    p.style.position = 'static'; p.style.overflow = 'visible';
    p.style.maxHeight = 'none'; p.style.height = 'auto';
    p.style.transform = 'none'; p.style.zIndex = 'auto';
    p = p.parentElement;
  }
  dialog.style.position = 'static'; dialog.style.transform = 'none';
  dialog.style.maxHeight = 'none'; dialog.style.overflow = 'visible';
  const body = dialog.querySelector('.el-dialog__body');
  if (body) { body.style.maxHeight = 'none'; body.style.overflow = 'visible'; }
  return { w: dialog.scrollWidth, h: dialog.scrollHeight };
};
```

## ステップ6 完全性ゲート（非自明な分岐）

証明すべき観点（`campus-playwright`のテストケース表・マニフェスト等）と、実際に収集できたエビデンスを突き合わせ、判定表にまとめる。テストのpass/fail結果だけでは観点の充足は分からない。

| 観点 | エビデンス | 判定 |
|---|---|---|
| 例：教員が担当授業の次の授業を表示 | `portal_instructor_next-lecture.png` | 完全 |
| 例：職員が次の授業ブロックで拒否される | （未取得） | 不完全 |

不完全な観点があれば、原因（撮影設定不足／テスト失敗／目視確認NG）に応じて該当ステップへ戻る。「だいたい揃った」で先に進まない。

## ステップ7 保存・受け渡し

- ローカルフォルダにそのまま保存する
- 必要に応じてzip化する（例：`evidence/<シナリオ名>_<timestamp>.zip`）
- **zip化前に、機微情報（テストアカウントの個人情報・パスワード等）がスクリーンショットに写り込んでいないか確認する**

収集・zip化を自動化するスクリプトは`scripts/`配下に別途整備する（本スキル文書には手順のみを記載し、実体はコードとして保守する）。

## Common Mistakes

1. **テスト失敗の性質を確認せず片付ける**：「テストコード自体のバグ」と「想定通り不具合を検知した」を区別せず、前者を後者として誤報告する、または逆に後者を「テストが壊れているだけ」として握りつぶす
2. **撮影設定を確認せず実行し、何も撮れていないことに実行後気づく**：`playwright.config.ts`の設定、テストコード内の明示的な`page.screenshot()`呼び出しの有無を事前に確認しない
3. **収集先を都度変えて成果物が混在・上書きされる**：複数回の実行結果が区別できなくなる
4. **撮影直後の目視確認を省略する**：内容が崩れている・意図と違うスクリーンショットをそのままエビデンスとして扱ってしまう
5. **配布前に機微情報の写り込みを確認しない**：テストアカウントの個人情報等がスクリーンショットに写り込んだままzip化・受け渡ししてしまう
