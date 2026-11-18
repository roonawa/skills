# 実行結果

実行ごとに runs/YYYYMMDD-run-id/ を作り、result.md と証跡を置きます。run-id は実行を区別する短い名前です。

result.md には次の表を書きます。

```
| TC-ID | 結果 | 証跡 | Issue |
|---|---|---|---|
| TC-order-001 | OK | evidence/order-001.png | |
```

結果は OK、NG、実行不能のいずれかです。実行不能は、環境や前提の問題でケースを実行できなかった場合に使います。証跡にはパスワードやトークンが映らないようにしてください。

result.md の冒頭には、実行した環境名（プロファイルの environments の name）、版、実行日時を書きます。

証跡は runs/YYYYMMDD-run-id/evidence/TC-ID/ に、ケースごとのディレクトリで保存します。証跡の列にはリポジトリのルートからの相対パスを書きます。

プロファイルの evidence の method が lfs のときは、証跡をこのリポジトリにコミットします。local や external のときは、証跡をリポジトリの外に保存し、証跡の列に保存先のパスだけを書きます。リポジトリには入れません。
