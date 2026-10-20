# 管理設定の検査

UIの「サイトを登録」「設定を編集」から検査項目と期待値を入力できる。REST認証はユーザー名・アプリケーションパスワード、ブラウザー認証は「WordPressにログイン」から実際のログイン画面を開き、確認後に保存できる。既存のstorageStateファイル取込みも任意で利用できる。保存・編集手順は[利用ガイド](harness-guide.md)。以下は外部設定ファイルを使う場合の形式。

サイトJSONに任意の `admin` 配列を追加する。未指定は従来どおり。CLIの `--suite admin` またはUIの「管理設定」で実行し、「すべての検査」にも含める。期待値は文字列・数値・真偽値の完全一致（型変換なし）。実サイトの資格情報と期待値を登録するまでは、同梱デモの結果は実サイトを保証しない。

```json
{
  "admin": [
    {
      "id": "timezone",
      "title": "タイムゾーン",
      "source": "rest",
      "path": "/wp-json/wp/v2/settings",
      "headersEnv": "WPQA_ADMIN_HEADERS",
      "field": "timezone",
      "expected": "Asia/Tokyo"
    },
    {
      "id": "indexing",
      "title": "検索エンジンへの公開",
      "source": "browser",
      "path": "/wp-admin/options-reading.php",
      "storageStateEnv": "WPQA_ADMIN_STATE",
      "authenticatedSelector": "#wpadminbar",
      "selector": "#blog_public",
      "read": "checked",
      "expected": false
    }
  ]
}
```

この例は既存サイトJSONへ組み込む断片。`pages` 等の既存設定も必要。WordPressの設置先がサブディレクトリならpathにも含める。`blog_public` の画面上のチェックは「検索エンジンがサイトをインデックスしないようにする」の状態であり、DBの同名optionの数値とは向きが異なる。実際の画面と文言を確認する。

- 共通: `id`（小文字slug）、`source`、`path`、`expected` は必須。`title` は任意、`required` は既定true。URLは登録サイトと同一origin。local以外はHTTPS必須。
- REST: GETのみ、リダイレクトしない。`field` はドット区切りのJSONキー。`headersEnv` は認証ヘッダーJSONを格納した環境変数名。通常の公開ページ用headersEnvからは引き継がない。レスポンス全体は保存せず、指定した値のみ記録する。
- ブラウザー: `storageStateEnv` はPlaywright storageStateファイルの絶対パスを格納した環境変数名。省略は未認証（ローカルデモ用）。`authenticatedSelector` と `selector`、`read` が必須。readはvalue（文字列）、checked（真偽値）、text（前後空白除去文字列）。対象が欠落・複数ならblocked。
- `sensitive:true` は期待値・取得値を証拠とUIで非表示にする。ただしサイトJSONとローカル実行contextには期待値が残るため、パスワードやAPIキーそのものをexpectedに書かない。非機密の状態値を選ぶ。

ブラウザー検査は別コンテキストで行い、管理画面のスクリーンショット・trace・レスポンス全文は記録しない。指定した管理ページへのGETと同一originの静的画像・CSS・フォントのみ許可し、JavaScript・XHR・POSTなどは遮断する。JavaScript必須のプラグイン画面にはREST方式か手動確認を使う。取得不能時にアクセス制限を自動で緩めない。

合格・不合格の項目にはUI詳細で取得方法、期待値、取得値を表示し、JSON証拠とHTMLレポートにも残す。blockedは理由を表示する。adminだけ実行した場合、他の必須検査は未実施のままなので全体の公開条件は充足しない。

RESTで利用できる項目（timezone、show_on_front、page_on_front、default_comment_status等）は[WordPress公式Site Settings](https://developer.wordpress.org/rest-api/reference/settings/)を参照する。パーマリンクやプラグイン独自設定が標準APIに存在すると仮定しない。管理画面の値の確認に加え、公開ページや通知の実動作も別suiteで検査する。
