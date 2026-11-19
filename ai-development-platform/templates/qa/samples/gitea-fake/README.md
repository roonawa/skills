# 確認用の偽の Gitea サーバー

`aidev qa issue create` が使う Gitea の3つの経路だけに答える、確認用の架空のサーバーです。実際の Gitea には何も送りません。
Issue はメモリ上にだけ持ち、止めると消えます。127.0.0.1 だけで待ち受けます。

```
GITEA_FAKE_TOKEN=確認用の任意の値 node server.mjs --port 3000
```

`--port 0` にすると空いているポートを使い、`listening http://localhost:N` を1行出します。
`GITEA_FAKE_TOKEN` が無いと起動しません（終了コード 1、値は出力しません）。

| 経路 | 応答 |
| --- | --- |
| `POST /api/v1/repos/:owner/:repo/issues` | 201 と Issue（number、title、body、html_url、state、user） |
| `GET /api/v1/repos/:owner/:repo/issues?q=` | 200 と、題名か本文に q を含む Issue の配列 |
| `GET /api/v1/user` | 200 と `{"login": "fake-user"}`（作った Issue の `user.login` もこの値） |
| `GET /__issues` | 作った Issue すべて（確認用） |

接続先には `http://127.0.0.1:N` を使ってください（IPv4 だけで待ち受けるため、`localhost` が IPv6 に解決される環境では届きません）。

すべての経路で `Authorization: token <GITEA_FAKE_TOKEN の値>` を求め、違えば 401 を返します。
このサーバーは `templates/qa/files.json` に入れません（利用者のプロジェクトへは配りません）。
