---
name: chub-team-status
description: C-HUB の CS部3ボード（CS部・CS部_保守関連・CS部_企画/内部）のタスクを読み取り専用で集計し、期限切れ・詰まり・動きなし・入力漏れ・担当者別の負荷を管理者目線で俯瞰する。「今週の期限切れは？」「◯◯さんの抱えている件数は？」「手が空いている人は？」「CS部のタスク状況をレポートにして」と言われたときに使う。書き込みはしない。
---

# chub-team-status

C-HUB の CS部3ボードを読み取り専用で集計する。C-HUB が正本で、このスキルはタスクを保持・更新しない。

## 使い方

- 相談（引数なし）: `python scripts/run.py`
- レポート: `python scripts/run.py report`（または `レポート`）
- オプション: `--today YYYY-MM-DD`（基準日）、`--stale-days N`（動きなしの日数、既定 14）

実行すると `%LOCALAPPDATA%\chub-team-status\runs\<日時>\` に `raw.json`・`aggregate.json`（report 時は `dashboard.html` も）が保存される。最後に出るパスを使う。

## 答え方

1. 実行して、出力された `aggregate.json` を **読む**。生データ（`raw.json`）を自分で数えない
2. 質問への対応:
   - 「◯◯さんの要対応は？」→ `action.by_assignee` のその人の `tasks`（`flags` が該当した判定）
   - 「今週の期限切れは？」→ `action.by_kind.overdue`
   - 「手が空いている人は？」→ `workload`（`open` が少ない人。期限切れ・詰まりの有無も添える）
   - 「商談状況・ゲート違反」→ `deals`
3. レポートのときは会話に、基準日・要対応の実数（`action.total_unique`）・目立つ点3つまで・HTML のパスだけを出す
4. `incomplete` が true、または `warnings` があれば、必ず先に伝える（取得できなかったボードがある＝数字は全体ではない）

## 判定の意味

期限切れ／詰まり（状態名が「詰まり」）／動きなし（最終更新から N 日以上）／ゲート違反（見積中以降で確認状況が「客先すり合わせ済み」でない）／入力漏れ（担当なし・期限なし）。1件が複数に当たる場合、担当者別では1件として数え判定を併記する。CS部_保守関連は担当なしの判定以外を行わない。CS部の失注・保留は除外し件数だけ別枠。

## 注意

- 設定（接続先とキー）は `%LOCALAPPDATA%\chub-team-status\config.json`。**キーの書き込みは Claude Code を閉じて行う**。キーが会話に出たら C-HUB の「AI とつなぐ」で失効・再発行する
- 401 はキー・接続先の違い、403 は権限不足（`task-manager:read`）
- 詳細は `chub-team-status_設計書.md`
