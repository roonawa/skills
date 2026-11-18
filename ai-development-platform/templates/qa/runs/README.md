# 実行結果

実行ごとに runs/YYYYMMDD-run-id/ を作り、result.md と証跡を置きます。run-id は実行を区別する短い名前です。最終の結果にする実行ごとに新しい run-id を使い、同じディレクトリに別の実行の結果を足しません。

result.md の冒頭には、実行した環境名（プロファイルの environments の name）、版、実行日時を書き、その後に次の表を書きます。

```markdown
# 実行結果 20261118-new-cases

- 環境: new
- 版: 2.3.0（画面の右下の表示）
- 実行日時: 2026-11-18 14:05〜14:21

| TC-ID | 結果 | 証跡 | Issue |
|---|---|---|---|
| TC-order-001 | OK | runs/20261118-new-cases/evidence/TC-order-001/ | |
```

結果は OK、NG、実行不能のいずれかです。実行不能は、環境や前提の問題でケースを実行できなかった場合に使います。証跡にはパスワードやトークンが映らないようにしてください。

証跡は runs/YYYYMMDD-run-id/evidence/TC-ID/ に、ケースごとのディレクトリで保存します。証跡の列には、リポジトリのルートからの相対パスで、ケースのディレクトリを書きます。

プロファイルの evidence の method が lfs のときは、証跡をこのリポジトリにコミットします。local や external のときは、証跡をリポジトリに入れません。

- 証跡をリポジトリの外に置くときは、同じ構成（保存先/runs/YYYYMMDD-run-id/evidence/TC-ID/）にし、証跡の列に保存先のパスを書きます
- local で、作業の都合で証跡をこの runs/ の下に置くときは、先に .gitignore に `runs/*/evidence/` を足し、`git status` に証跡が出ないことを確かめてから流します。result.md はコミットし、証跡の列には runs/ の下のパスを書きます。雛形の .gitignore は、lfs の案件のために evidence/ を除外していません

テストの途中の実行や失敗の診断に使った証跡は runs/ に置かず、.qa-scratch/ などの Git に入らない場所に置きます。
