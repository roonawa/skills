# C-HUB API でタスクを取得する手順（暫定）

C-HUB（社内コラボレーションプラットフォーム）のAPIを使って、タスク等のデータを取得・操作するための手順メモ。

- サーバー: `https://wkozu2024:3030`
- 認証: スコープ付き Bearer トークン（`chub_xxxxx`）
- 同じサーバーに **Webアプリ画面（`/`）** と **API（`/api/...`）** が同居している

---

## 1. 前提：通信コマンドの基本形

Windowsの`curl`で叩くときの固定形。**末尾のURLとトークンだけ差し替える**。

```
curl --ssl-no-revoke -H "Authorization: Bearer <トークン>" "<URL>"
```

> **`--ssl-no-revoke` について**
> C-HUBの公式サンプルには付いていない（公式サンプルは `curl -H "Authorization: Bearer xxx" https://your-server/...` の形）。
> ただしこの社内環境（`wkozu2024`）では、付けないと `CRYPT_E_NO_REVOCATION_CHECK`（証明書の失効確認エラー）で止まったため**追加している**。
> 環境によっては不要。エラーが出なければ外してよい。

### Windows特有の注意

| 症状 | 原因 | 対処 |
|---|---|---|
| `schannel: ... CRYPT_E_NO_REVOCATION_CHECK` | 証明書の**失効確認**が社内サーバーで到達できず停止 | `--ssl-no-revoke` を付ける |
| `Headers をバインドできません` | PowerShellの`curl`は別物（Invoke-WebRequest） | **cmd**で実行、または`curl.exe`と書く |
| 証明書の信頼エラー | 自己署名証明書 | 証明書をローカルにインストール（済みなら`-k`不要） |

> PowerShellではなく **cmd（コマンドプロンプト）** で実行するのが楽。

---

## 2. 認証：スコープ付きトークン

トークンは**機能ごとの権限（スコープ）制**。

- トークンには **発行した瞬間の権限が焼き込まれる**
- 後から管理画面でチェックを足しても、**既存トークンには反映されない**
- → 権限を変えたら **必ずトークンを再発行** し、新しい文字列を使う

また、**トークンはユーザー本人の権限を超えられない**。
ブラウザでログインして画面に見えない機能は、APIでも取れない（その場合は権限昇格が必要）。

確認したい権限の例:
- チャット読み取り / メディア読み取り / タスク管理読み取り / プロフィール読み取り

---

## 3. 万能の調査手順：アプリの通信を覗いて真似る

マニュアルが無くても、**アプリが実際に叩いているAPIを見れば全部分かる**。これが王道。

1. ブラウザで C-HUB を開く
2. **F12（開発者ツール）→ Network（ネットワーク）** タブ
3. 確認したい操作を画面で実行（一覧表示・作成・更新など）
4. 出てきたリクエストをクリックして確認:
   - **Request URL** … 正しいエンドポイント
   - **Request Method** … GET / POST / PUT / DELETE
   - **Request Body** … 送信データの項目
   - **Response** … 返ってくるデータの項目
5. その **URL をそのまま curl に写し、認証だけ Bearer トークンに置き換える**

---

## 4. タスク取得の実例

### エンドポイント構造

タスクは `/api/tasks` ではなく、**task-manager プラグインの下**にある。

```
/api/plugin/task-manager/projects/{プロジェクトID}/tasks
```

### プロジェクト一覧を取得

```
curl --ssl-no-revoke -H "Authorization: Bearer <トークン>" "https://wkozu2024:3030/api/plugin/task-manager/projects"
```

### 特定プロジェクトのタスク一覧を取得

```
curl --ssl-no-revoke -H "Authorization: Bearer <トークン>" "https://wkozu2024:3030/api/plugin/task-manager/projects/tp-1779268266270-h4lqw/tasks?show_completed=true"
```

- `?show_completed=true` … 完了済みも含める

### 単一タスクをピンポイントで取得

タスクIDだけで直接取れる（プロジェクトID不要）。

```
curl --ssl-no-revoke -H "Authorization: Bearer <トークン>" "https://wkozu2024:3030/api/plugin/task-manager/tasks/task-1781599844340-3tml2"
```

- `{タスクID}` … 一覧で取れた `id`（例: `task-1781599844340-3tml2`）

### エンドポイントまとめ

| 取りたいもの | URL |
|---|---|
| プロジェクト一覧 | `/api/plugin/task-manager/projects` |
| 特定プロジェクトのタスク一覧 | `/api/plugin/task-manager/projects/{プロジェクトID}/tasks` |
| 単一タスク（ピンポイント） | `/api/plugin/task-manager/tasks/{タスクID}` |

---

## 5. タスクデータの項目

### 一覧取得（`/tasks`）と単一取得（`/tasks/{ID}`）の違い

同じタスクでも、**一覧はサマリ版、単一は詳細版**で項目が違う。

| | 一覧取得 | 単一取得 |
|---|---|---|
| 用途 | ざっと見る | 1件を詳しく見る |
| サブタスク | 件数のみ（`subtask_total`/`subtask_completed`） | **中身**（`subtasks[]`） |
| 添付 | 件数のみ（`attachment_count`） | **中身**（`attachments[]`） |
| コメント | なし | **あり**（`comments[]`） |
| 操作履歴 | なし | **あり**（`activities[]`） |
| セクション名 | IDのみ（`section_id`） | 名前も（`section_name`/`section_color`） |
| 紐づくノート | なし | **あり**（`linked_notes[]`） |

レスポンス全体の形:
```json
// 一覧
{ "ok": true, "data": { "tasks": [ { ...タスク... }, ... ] } }
// 単一
{ "ok": true, "data": { "task": { ...タスク... } } }
```

### 共通の主な項目（一覧・単一どちらにもある）

| 項目 | 例 | 意味 |
|---|---|---|
| `id` | task-1781655630527-7h9e3 | タスクID |
| `project_id` | tp-1779268266270-h4lqw | 所属プロジェクトID |
| `section_id` | 351 | 所属セクションID |
| `title` | エムケー精工：セキュリティ対応 | 件名 |
| `description` | （本文テキスト） | 詳細 |
| `assignee` / `assignee_display_name` | mtakeuchi / 竹内 | 担当者（ID／表示名） |
| `status_id` / `status_name` | 219 / 進行中 | ステータス |
| `status_category` | active / open | 状態区分（active=進行中, open=未着手） |
| `status_color` | #8b9dc3 | ステータス色 |
| `start_date` / `due_date` / `completed_at` | / 2026-06-26 / null | 開始・期日・完了日 |
| `sort_order` | 1 | 並び順 |
| `created_by` / `created_at` | mtsuchiya / 2026-06-17 09:20:30 | 作成者・作成日時 |
| `updated_at` | 2026-06-24 09:22:42 | 更新日時 |
| `collaborators[]` | 小林・土屋・竹内 | 共同作業者（username, display_name） |
| `tags[]` | | タグ |
| `custom_field_values[]` | 区分=受注 等 | カスタム項目（下記参照） |
| `recurring_rule_id` / `reminder_at` / `reminder_sent` | | 繰り返し・リマインダー |

### 単一取得でのみ展開される項目

| 項目 | 中身 |
|---|---|
| `section_name` / `section_color` | セクション名・色（例: 引き合い） |
| `subtasks[]` | サブタスクの中身 |
| `comments[]` | コメント一覧 |
| `attachments[]` | 添付ファイルの中身 |
| `activities[]` | 操作履歴（誰がいつ作成・更新したか。`action_type`=create/update 等） |
| `linked_notes[]` | 紐づくナレッジ（ノート） |

### カスタムフィールド（`custom_field_values[]`）

`区分`・`確認状況` などは標準項目ではなく**カスタムフィールド**。次の性質に注意:

- **定義はプロジェクト単位**（プロジェクトごとにフィールドや選択肢が異なる）
- **値はタスクごと**。設定されていないタスクは **空配列 `[]`**
- 別プロジェクトでは `field_id` の意味や選択肢が変わりうる

1要素の構造:
```json
{ "field_id": 10, "field_name": "区分", "option_id": 84, "option_name": "受注", "option_color": "#8b95a3" }
```

| キー | 意味 |
|---|---|
| `field_id` / `field_name` | フィールド種別（例: 10=区分, 11=確認状況） |
| `option_id` / `option_name` | 選択した値（例: 受注／保留、客先すり合わせ済み） |
| `option_color` | 表示色 |

> カスタムフィールドの「全選択肢」を知りたい場合は、プロジェクトのフィールド定義を返すAPIを別途確認する（プロジェクト設定画面を F12 Network で見ると定義取得URLが分かる）。

---

## 6. データの書き込み（POST / PUT / DELETE）

サーバーは `GET, POST, PUT, DELETE, OPTIONS` を許可している。

| 操作 | メソッド |
|---|---|
| 取得 | GET（デフォルト） |
| 新規作成 | POST |
| 更新 | PUT |
| 削除 | DELETE |

書き込みの例（形は「3. Network調査」で実際の操作を見てから真似ること）:

```
curl --ssl-no-revoke -X POST ^
  -H "Authorization: Bearer <トークン>" ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"テストタスク\"}" ^
  "https://wkozu2024:3030/api/plugin/task-manager/projects/<プロジェクトID>/tasks"
```

> ⚠️ 書き込みは実データに反映される。送るBody（JSONの項目）を必ずNetworkで確認してから実行する。

---

## 7. トラブル時のチェックリスト

| エラー | 意味 | 対処 |
|---|---|---|
| `Insufficient scope for this endpoint` | トークンに権限が無い／パスが違う | パスを再確認 → 権限込みでトークン再発行 |
| `Cannot GET /xxx`（ExpressのHTML） | そのパスが存在しない | 正しいパスをNetworkで確認 |
| `CRYPT_E_NO_REVOCATION_CHECK` | 失効確認で停止 | `--ssl-no-revoke` を付ける |
| `Headers をバインドできません` | PowerShellの`curl`別名 | cmdで実行 or `curl.exe` |
| 401 Unauthorized | トークンが無効 | トークン文字列・有効期限を確認 |

---