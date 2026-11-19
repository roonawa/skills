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

Issue の列は、実行したときは空けておきます。NG のケースを起票すると `aidev qa issue create` が `#番号` を書き込みます。このコマンドは、その行の Issue の列だけを書き換え、ほかの行や列、表の後の節は変えません。同じ原因の NG を1件の Issue にまとめたときは、残りの TC の行にも同じ `#番号` を書きます。Issue の列には `#番号` 以外を書かないでください。すでに別の番号が書かれている行は、コマンドが書き換えずに止まります。

```bash
# 送る題名と本文を確かめる（何も送らず、result.md も変えない）
aidev qa issue create --profile knowledge/<製品名>/profile.md --run runs/20261118-new-cases --tc TC-order-002 --dry-run
# 送信先と本文を確かめてから送る。トークンは環境変数 GITEA_TOKEN、接続先は GITEA_URL で渡す
aidev qa issue create --profile knowledge/<製品名>/profile.md --run runs/20261118-new-cases --tc TC-order-002
```

Issue の本文は、表の後の「NG の詳細」にある TC-ID の節から作ります。本文の先頭には `<!-- aidev-qa: <製品名> <TC-ID> -->` の目印が入り、同じ目印を持つ、自分（トークンの持ち主）が作った開いている Issue がすでにあれば、新しく作らずにその番号を書きます。閉じた Issue や他の人が作った Issue は重複とみなさず、番号と理由を出力に出します。

トークンは環境変数 GITEA_URL の接続先にだけ送ります。GITEA_URL は GITEA_TOKEN と一緒に作業者が設定し、プロファイルの issue_tracker.url と接続先（スキーム・ホスト・ポート）が違えば、`--dry-run` でも止まります。本文に秘密情報らしい記述があると、送らずに止まります。

証跡は runs/YYYYMMDD-run-id/evidence/TC-ID/ に、ケースごとのディレクトリで保存します。証跡の列には、リポジトリのルートからの相対パスで、ケースのディレクトリを書きます。

プロファイルの evidence の method が lfs のときは、証跡をこのリポジトリにコミットします。local や external のときは、証跡をリポジトリに入れません。

- 証跡をリポジトリの外に置くときは、同じ構成（保存先/runs/YYYYMMDD-run-id/evidence/TC-ID/）にし、証跡の列に保存先のパスを書きます
- local で、作業の都合で証跡をこの runs/ の下に置くときは、先に .gitignore に `runs/*/evidence/` を足し、`git status` に証跡が出ないことを確かめてから流します。result.md はコミットし、証跡の列には runs/ の下のパスを書きます。雛形の .gitignore は、lfs の案件のために evidence/ を除外していません

テストの途中の実行や失敗の診断に使った証跡は runs/ に置かず、.qa-scratch/ などの Git に入らない場所に置きます。
