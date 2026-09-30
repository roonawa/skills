# chub-team-status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** C-HUB の CS部3ボードのタスクを読み取り専用で取得・集計し、会話回答用の集計 JSON と、担当者別グループ表示を含む単一 HTML ダッシュボードを出す Claude Code スキルを作る。

**Architecture:** 取得（`fetch.py`）・集計（`aggregate.py`）・描画（`render_html.py`）を分ける。集計と描画は通信しない純粋関数で、固定データの unittest で数字を担保する。入口は `run.py`。設定とキーはスキル外（`%LOCALAPPDATA%\chub-team-status\config.json`）に置く。

**Tech Stack:** Python 3 標準ライブラリのみ（`urllib`, `json`, `unittest`, `html`）。追加インストールなし。

**Spec:** `chub-team-status_設計書.md`（同ディレクトリ）。特に 4〜9章。担当者別グループ表示は 6章「集計（要対応）」と 7章-1。

## Global Constraints

- C-HUB へは **GET のみ**。POST/PUT/DELETE を送るコードを書かない
- `base_url` は `https://` 必須。ホストまで（`/api` は付けない）
- 権限は `task-manager:read` のみ。**キーの値をログ・出力・エラー文・例外メッセージに一切出さない**
- リダイレクト（30x）は追いかけず止まる
- 想定外の例外は **例外の種類名だけ**表示して止まる（トレースバックを出さない）
- 呼び出し間隔 0.5 秒。429 は 60 秒待って 1 回だけ再試行、再度 429 なら止まる
- 成否は HTTP ステータスで判断（401/403/429 は `ok` 項目が無い）
- 対象ボードは完全一致の3つ：`CS部`、`CS部_保守関連`、`CS部_企画/内部`。保管済み（`archived=1`）は詳細・タスクを呼ばない
- 基準日は既定で実行日（日本時間 = UTC+9）。動きなしのしきい値は既定 14 日（引数で変更可）
- 期限間近は期限が基準日から 14 日以内。期限当日は期限切れではない
- HTML は外部 CDN・フォント・通信なし（オフラインで開ける）
- 保存先 `%LOCALAPPDATA%\chub-team-status\runs\YYYYMMDD-HHMMSS\`。直近 5 回分だけ残す
- 集計側で数える。Claude も HTML も生データを数えない

## Review Focus

1. 1件が複数判定に該当（期限切れ＋動きなし＋入力漏れ）→ 担当者別では1件として数え、判定を併記する。判定別の件数は該当ごとに数える
2. 担当者が空文字・null のタスク → 「（担当なし）」に入れ、常に末尾
3. タスク名・担当者名に `<script>` や `&` を含む → HTML でエスケープされ、スクリプトとして実行されない
4. `updated_at` が `Z` 付き ISO（UTC）→ 日本時間に直して日付判定する
5. 要対応が0件の担当者・全体0件 → 空のブロック／「該当なし」表示でクラッシュしない
6. セクション名が想定外（例：「見積提出済み（※…）」の後ろ付き、未知のセクション）→ 前方一致で段階に寄せる／「（段階なし・その他）」に数える
7. 一覧 API の `section_id` に対応する名前が詳細で取れない場合 → 段階なしに数え、警告を出す

## API 形状の前提（Task 3 の実機確認で検証）

設計書 10章の確認結果と暫定手順書から、次を前提にする。外れたら `fetch.py` の `_project_sections` だけを直す。

- `GET .../projects` → `{"ok":true,"data":{"projects":[{"id","name","archived"}]}}`
- `GET .../projects/{id}` → `{"ok":true,"data":{"project":{..., "sections":[{"id","name"}]}}}`
- `GET .../projects/{id}/tasks?show_completed=true` → `{"ok":true,"data":{"tasks":[...]}}`（項目は手順書 5章）

## ファイル構成

```
chub-team-status/
├─ SKILL.md
├─ scripts/
│   ├─ chub_config.py    設定を読む・検証する
│   ├─ chub_client.py    GET だけ。429 再試行・リダイレクト拒否
│   ├─ fetch.py          3ボード分を取得して raw dict を返す
│   ├─ aggregate.py      raw → 集計 dict（判定・担当者別・負荷・ガント・商談・完了実績）
│   ├─ render_html.py    集計 dict → 単一 HTML 文字列
│   └─ run.py            入口。保存と後始末
└─ tests/
    ├─ _helpers.py       sys.path 設定と固定データ
    ├─ test_config.py
    ├─ test_client.py
    ├─ test_fetch.py
    ├─ test_aggregate.py
    ├─ test_render.py
    └─ test_run.py
```

テスト実行（スキルのルートで）：`python -m unittest discover -s tests -v`

---

### Task 1: 設定の読み込み（chub_config.py）

**Files:**
- Create: `scripts/chub_config.py`, `tests/_helpers.py`
- Test: `tests/test_config.py`

**Interfaces:**
- Produces: `class ConfigError(Exception)`、`default_config_path(env=os.environ) -> str`、`load_config(path=None, env=os.environ) -> dict`（`{"base_url": str, "api_key": str}`。`base_url` の末尾 `/` は除く）

- [ ] **Step 1: テスト補助とテストを書く**

`tests/_helpers.py`:

```python
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
```

`tests/test_config.py`:

```python
import json
import os
import tempfile
import unittest

import _helpers  # noqa: F401
from chub_config import ConfigError, load_config

SECRET = "chub_SECRETVALUE"


def _write(d, obj, raw=None):
    p = os.path.join(d, "config.json")
    with open(p, "w", encoding="utf-8") as f:
        f.write(raw if raw is not None else json.dumps(obj))
    return p


class ConfigTest(unittest.TestCase):
    def test_ok_strips_trailing_slash(self):
        with tempfile.TemporaryDirectory() as d:
            p = _write(d, {"base_url": "https://chub.example/", "api_key": SECRET})
            self.assertEqual(load_config(p), {"base_url": "https://chub.example", "api_key": SECRET})

    def test_env_override_path(self):
        with tempfile.TemporaryDirectory() as d:
            p = _write(d, {"base_url": "https://x", "api_key": SECRET})
            self.assertEqual(load_config(env={"CHUB_CONFIG_FILE": p})["base_url"], "https://x")

    def test_missing_file_mentions_path_not_key(self):
        with self.assertRaises(ConfigError) as cm:
            load_config("Z:/nope/config.json")
        self.assertIn("config.json", str(cm.exception))

    def test_broken_json(self):
        with tempfile.TemporaryDirectory() as d:
            p = _write(d, None, raw="{ not json " + SECRET)
            with self.assertRaises(ConfigError) as cm:
                load_config(p)
            self.assertNotIn(SECRET, str(cm.exception))

    def test_empty_key(self):
        with tempfile.TemporaryDirectory() as d:
            p = _write(d, {"base_url": "https://x", "api_key": " "})
            with self.assertRaises(ConfigError):
                load_config(p)

    def test_http_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = _write(d, {"base_url": "http://x", "api_key": SECRET})
            with self.assertRaises(ConfigError) as cm:
                load_config(p)
            self.assertNotIn(SECRET, str(cm.exception))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 失敗を確認**

Run: `python -m unittest tests.test_config -v`（または `python -m unittest discover -s tests -p "test_config.py" -v`）
Expected: FAIL（`chub_config` が無い）

- [ ] **Step 3: 実装**

`scripts/chub_config.py`:

```python
import json
import os


class ConfigError(Exception):
    pass


def default_config_path(env=os.environ):
    if env.get("CHUB_CONFIG_FILE"):
        return env["CHUB_CONFIG_FILE"]
    base = env.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "chub-team-status", "config.json")


def load_config(path=None, env=os.environ):
    path = path or default_config_path(env)
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        raise ConfigError("設定ファイルを読めません。置き場所: %s" % path)
    try:
        cfg = json.loads(text)
    except ValueError:
        # 例外文字列に中身（キー）が入りうるので、理由だけ伝える
        raise ConfigError("設定ファイルの JSON が壊れています: %s" % path)
    if not isinstance(cfg, dict):
        raise ConfigError("設定ファイルの形式が違います: %s" % path)
    base_url = str(cfg.get("base_url") or "").strip().rstrip("/")
    api_key = str(cfg.get("api_key") or "").strip()
    if not api_key:
        raise ConfigError("api_key が空です: %s" % path)
    if not base_url.startswith("https://"):
        raise ConfigError("base_url は https:// で始まる必要があります（C-HUB は HTTPS のみ）")
    return {"base_url": base_url, "api_key": api_key}
```

- [ ] **Step 4: 通ることを確認**

Run: `python -m unittest discover -s tests -p "test_config.py" -v`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/chub_config.py tests/_helpers.py tests/test_config.py
git commit -m "feat: chub-team-status 設定の読み込み"
```

---

### Task 2: C-HUB クライアント（chub_client.py）

**Files:**
- Create: `scripts/chub_client.py`
- Test: `tests/test_client.py`

**Interfaces:**
- Consumes: `load_config` の返す dict
- Produces: `class ChubError(Exception)`、`class ChubHttpError(ChubError)`（`.status` を持つ）、`class Client(base_url, api_key, transport=None, sleep=time.sleep, interval=0.5)`、`Client.get(path, params=None) -> dict`（`data` 部ではなくレスポンス JSON 全体）。`transport(url, headers) -> (status:int, body:str)`

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_client.py`:

```python
import json
import unittest

import _helpers  # noqa: F401
from chub_client import ChubError, ChubHttpError, Client

KEY = "chub_SECRETVALUE"


def make(responses, sleeps=None):
    calls = []
    seq = list(responses)

    def transport(url, headers):
        calls.append((url, headers))
        return seq.pop(0)

    sl = (lambda s: sleeps.append(s)) if sleeps is not None else (lambda s: None)
    return Client("https://chub.example", KEY, transport=transport, sleep=sl), calls


class ClientTest(unittest.TestCase):
    def test_get_builds_url_and_bearer(self):
        c, calls = make([(200, json.dumps({"ok": True, "data": {}}))])
        c.get("/api/plugin/task-manager/projects", {"show_completed": "true"})
        url, headers = calls[0]
        self.assertEqual(url, "https://chub.example/api/plugin/task-manager/projects?show_completed=true")
        self.assertEqual(headers["Authorization"], "Bearer " + KEY)

    def test_401_message_has_no_key(self):
        c, _ = make([(401, "{}")])
        with self.assertRaises(ChubHttpError) as cm:
            c.get("/x")
        self.assertEqual(cm.exception.status, 401)
        self.assertNotIn(KEY, str(cm.exception))

    def test_429_retries_once_after_60s(self):
        sleeps = []
        c, calls = make([(429, "{}"), (200, '{"ok": true, "data": {}}')], sleeps)
        c.get("/x")
        self.assertEqual(len(calls), 2)
        self.assertIn(60, sleeps)

    def test_429_twice_stops(self):
        c, _ = make([(429, "{}"), (429, "{}")])
        with self.assertRaises(ChubHttpError) as cm:
            c.get("/x")
        self.assertEqual(cm.exception.status, 429)

    def test_redirect_stops(self):
        c, _ = make([(302, "")])
        with self.assertRaises(ChubHttpError):
            c.get("/x")

    def test_interval_sleep_between_calls(self):
        sleeps = []
        c, _ = make([(200, '{"ok": true, "data": {}}')] * 2, sleeps)
        c.get("/a")
        c.get("/b")
        self.assertTrue(any(abs(s - 0.5) < 1e-9 for s in sleeps))

    def test_non_json_body(self):
        c, _ = make([(200, "<html>")])
        with self.assertRaises(ChubError):
            c.get("/x")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 失敗を確認**

Run: `python -m unittest discover -s tests -p "test_client.py" -v`
Expected: FAIL（`chub_client` が無い）

- [ ] **Step 3: 実装**

`scripts/chub_client.py`:

```python
import json
import time
import urllib.error
import urllib.parse
import urllib.request


class ChubError(Exception):
    pass


class ChubHttpError(ChubError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # 追いかけない（キーをリダイレクト先に送らない）


def _default_transport(url, headers):
    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with opener.open(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, ""


_MESSAGES = {
    401: "401: キーが違う・期限切れ・失効済み、または接続先の違い",
    403: "403: キーの権限不足（task-manager:read が必要）",
    429: "429: 回数上限に達しました（再試行後も解消せず）",
}


class Client:
    def __init__(self, base_url, api_key, transport=None, sleep=time.sleep, interval=0.5):
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._transport = transport or _default_transport
        self._sleep = sleep
        self._interval = interval
        self._first = True

    def get(self, path, params=None):
        url = self._base + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {"Authorization": "Bearer " + self._key, "Accept": "application/json"}
        if not self._first:
            self._sleep(self._interval)
        self._first = False
        status, body = self._transport(url, headers)
        if status == 429:
            self._sleep(60)
            status, body = self._transport(url, headers)
        if status != 200:
            raise ChubHttpError(status, _MESSAGES.get(status, "HTTP %d" % status))
        try:
            return json.loads(body)
        except ValueError:
            raise ChubError("レスポンスが JSON ではありません")
```

- [ ] **Step 4: 通ることを確認**

Run: `python -m unittest discover -s tests -p "test_client.py" -v`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/chub_client.py tests/test_client.py
git commit -m "feat: chub-team-status GET 専用クライアント"
```

---

### Task 3: 取得（fetch.py）と実機での形状確認

**Files:**
- Create: `scripts/fetch.py`
- Test: `tests/test_fetch.py`

**Interfaces:**
- Consumes: `Client.get(path, params) -> dict`、`ChubHttpError`
- Produces: `BOARDS: tuple[str]`、`fetch_all(client, log=print) -> dict`。戻り値は
  `{"base_url_shown": None, "projects": [{"id","name","sections": {"<section_id>": "<name>"}, "tasks": [<API のタスク dict>]}], "skipped": [{"name","reason"}], "missing_boards": [str], "counts": {"projects": int, "tasks": int}}`

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_fetch.py`:

```python
import unittest

import _helpers  # noqa: F401
from chub_client import ChubHttpError
from fetch import BOARDS, fetch_all


class FakeClient:
    def __init__(self, routes, fail=None):
        self.routes = routes
        self.fail = fail or {}
        self.paths = []

    def get(self, path, params=None):
        self.paths.append(path)
        if path in self.fail:
            raise self.fail[path]
        return self.routes[path]


BASE = "/api/plugin/task-manager/projects"


def routes():
    return {
        BASE: {"ok": True, "data": {"projects": [
            {"id": "p1", "name": "CS部", "archived": 0},
            {"id": "p2", "name": "CS部_保守関連", "archived": 0},
            {"id": "p9", "name": "テンプレート：CS案件", "archived": 0},
            {"id": "p8", "name": "CS部_企画/内部", "archived": 1},
        ]}},
        BASE + "/p1": {"ok": True, "data": {"project": {"sections": [{"id": 1, "name": "見積中"}]}}},
        BASE + "/p1/tasks": {"ok": True, "data": {"tasks": [{"id": "t1", "section_id": 1}]}},
        BASE + "/p2": {"ok": True, "data": {"project": {"sections": []}}},
        BASE + "/p2/tasks": {"ok": True, "data": {"tasks": []}},
    }


class FetchTest(unittest.TestCase):
    def test_only_target_boards_and_skips_archived(self):
        c = FakeClient(routes())
        raw = fetch_all(c, log=lambda *_: None)
        self.assertEqual([p["name"] for p in raw["projects"]], ["CS部", "CS部_保守関連"])
        self.assertNotIn(BASE + "/p9", c.paths)
        self.assertNotIn(BASE + "/p8", c.paths)
        self.assertEqual(raw["projects"][0]["sections"], {"1": "見積中"})
        self.assertEqual(raw["counts"], {"projects": 2, "tasks": 1})

    def test_missing_board_is_warned_not_fatal(self):
        raw = fetch_all(FakeClient(routes()), log=lambda *_: None)
        self.assertEqual(raw["missing_boards"], ["CS部_企画/内部"])

    def test_tasks_requested_with_completed(self):
        seen = []

        class C(FakeClient):
            def get(self, path, params=None):
                seen.append((path, params))
                return super().get(path, params)

        fetch_all(C(routes()), log=lambda *_: None)
        self.assertIn((BASE + "/p1/tasks", {"show_completed": "true"}), seen)

    def test_403_on_project_is_skipped_and_recorded(self):
        c = FakeClient(routes(), fail={BASE + "/p2/tasks": ChubHttpError(403, "403")})
        raw = fetch_all(c, log=lambda *_: None)
        self.assertEqual([s["name"] for s in raw["skipped"]], ["CS部_保守関連"])
        self.assertEqual([p["name"] for p in raw["projects"]], ["CS部"])

    def test_403_on_list_is_fatal(self):
        c = FakeClient(routes(), fail={BASE: ChubHttpError(403, "403")})
        with self.assertRaises(ChubHttpError):
            fetch_all(c, log=lambda *_: None)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 失敗を確認**

Run: `python -m unittest discover -s tests -p "test_fetch.py" -v`
Expected: FAIL（`fetch` が無い）

- [ ] **Step 3: 実装**

`scripts/fetch.py`:

```python
from chub_client import ChubHttpError

BOARDS = ("CS部", "CS部_保守関連", "CS部_企画/内部")
_BASE = "/api/plugin/task-manager/projects"


def _project_sections(detail):
    """詳細レスポンスから {section_id(str): 名前} を作る。形状が違えばここだけ直す。"""
    project = ((detail or {}).get("data") or {}).get("project") or {}
    return {str(s.get("id")): s.get("name") or "" for s in project.get("sections") or []}


def fetch_all(client, log=print):
    listing = client.get(_BASE)
    projects = ((listing.get("data") or {}).get("projects")) or []
    targets = [p for p in projects if p.get("name") in BOARDS and not p.get("archived")]
    found = {p["name"] for p in targets}
    missing = [b for b in BOARDS if b not in found]
    for b in missing:
        log("警告: ボード「%s」が見つかりません（名前が変わった可能性）" % b)

    out, skipped, ntasks = [], [], 0
    for p in targets:
        try:
            detail = client.get("%s/%s" % (_BASE, p["id"]))
            tasks = client.get("%s/%s/tasks" % (_BASE, p["id"]), {"show_completed": "true"})
        except ChubHttpError as e:
            if e.status == 403:
                skipped.append({"name": p["name"], "reason": "403"})
                log("警告: 「%s」は権限がなく飛ばしました" % p["name"])
                continue
            raise
        items = ((tasks.get("data") or {}).get("tasks")) or []
        ntasks += len(items)
        out.append({"id": p["id"], "name": p["name"],
                    "sections": _project_sections(detail), "tasks": items})
    log("取得: プロジェクト %d 件 / タスク %d 件" % (len(out), ntasks))
    return {"projects": out, "skipped": skipped, "missing_boards": missing,
            "counts": {"projects": len(out), "tasks": ntasks}}
```

- [ ] **Step 4: 通ることを確認**

Run: `python -m unittest discover -s tests -p "test_fetch.py" -v`
Expected: 5 tests PASS

- [ ] **Step 5: 実機で形状を確認する（キーを入れた後。Claude Code を閉じてキーを書く運用は設計書 4章のとおり）**

Run（スキルのルートで。キーは表示されない）:

```bash
python -c "import sys; sys.path.insert(0,'scripts'); import json; from chub_config import load_config; from chub_client import Client; from fetch import fetch_all; c=load_config(); r=fetch_all(Client(c['base_url'],c['api_key'])); print({p['name']:(len(p['tasks']), len(p['sections'])) for p in r['projects']}, r['missing_boards'], r['skipped'])"
```

Expected: 3ボードそれぞれ「タスク数, セクション数」が出て、セクション数が 0 でない（CS部は 8 前後）。`missing_boards` と `skipped` は空。
外れた場合（セクション数 0 など）：`_project_sections` を実レスポンスに合わせて直し、`test_fetch.py` の固定データも同じ形に直してから次へ進む。

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch.py tests/test_fetch.py
git commit -m "feat: chub-team-status CS部3ボードの取得"
```

---

### Task 4: 判定と要対応の集計（aggregate.py 前半）

**Files:**
- Create: `scripts/aggregate.py`
- Test: `tests/test_aggregate.py`

**Interfaces:**
- Consumes: `fetch_all` の戻り値 dict（raw）
- Produces:
  - 定数 `BOARD_MAIN, BOARD_MAINT, BOARD_PLAN, STAGES, GATE_STAGES, KINDS, KIND_LABEL`
  - `aggregate(raw, today: date, stale_days: int = 14) -> dict`。この Task で埋めるキー：
    `today`(iso str), `stale_days`, `incomplete`(bool), `warnings`([str]), `excluded_count`(int),
    `action.counts`(`{kind:int}`), `action.by_kind`(`{kind:[entry]}`), `action.by_assignee`(`[{"assignee","name","count","tasks":[entry]}]`), `action.total_unique`(int)
  - `entry` = `{"id","title","board","section","assignee","assignee_name","status","due","updated","days_overdue","flags":[kind]}`
  - Task 5・6 で `workload`, `gantt`, `deals`, `completions` を追加する（この Task では空の枠を返す）

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_aggregate.py`:

```python
import unittest
from datetime import date

import _helpers  # noqa: F401
from aggregate import aggregate

TODAY = date(2026, 9, 30)


def T(id, **kw):
    t = {"id": id, "title": "タスク" + id, "section_id": 1, "assignee": "a", "assignee_display_name": "甲",
         "status_name": "進行中", "status_category": "active", "due_date": "2026-10-30",
         "start_date": None, "created_at": "2026-09-01 09:00:00",
         "updated_at": "2026-09-29 10:00:00", "completed_at": None, "custom_field_values": []}
    t.update(kw)
    return t


def raw(main=(), maint=(), plan=(), sections=None):
    secs = sections or {"1": "製造", "2": "引き合い/予定", "3": "保留中"}
    return {"projects": [
        {"id": "p1", "name": "CS部", "sections": secs, "tasks": list(main)},
        {"id": "p2", "name": "CS部_保守関連", "sections": {"1": "契約中"}, "tasks": list(maint)},
        {"id": "p3", "name": "CS部_企画/内部", "sections": {"1": "作業"}, "tasks": list(plan)},
    ], "skipped": [], "missing_boards": [], "counts": {}}


def cf(kubun=None, confirm=None):
    v = []
    if kubun:
        v.append({"field_name": "区分", "option_name": kubun})
    if confirm:
        v.append({"field_name": "確認状況", "option_name": confirm})
    return v


def ids(agg, kind):
    return [e["id"] for e in agg["action"]["by_kind"][kind]]


class JudgementTest(unittest.TestCase):
    def test_due_today_is_not_overdue_yesterday_is(self):
        a = aggregate(raw(plan=[T("a", due_date="2026-09-30"), T("b", due_date="2026-09-29")]), TODAY)
        self.assertEqual(ids(a, "overdue"), ["b"])
        e = a["action"]["by_kind"]["overdue"][0]
        self.assertEqual(e["days_overdue"], 1)

    def test_completed_task_is_never_flagged(self):
        t = T("a", status_category="done", due_date="2026-01-01", assignee="", updated_at="2026-01-01 00:00:00")
        a = aggregate(raw(plan=[t]), TODAY)
        self.assertEqual(a["action"]["total_unique"], 0)

    def test_stuck_by_status_name(self):
        a = aggregate(raw(plan=[T("a", status_name="詰まり")]), TODAY)
        self.assertEqual(ids(a, "stuck"), ["a"])

    def test_stale_threshold_and_override(self):
        old = T("a", updated_at="2026-09-16 10:00:00")  # 14日前
        self.assertEqual(ids(aggregate(raw(plan=[old]), TODAY), "stale"), ["a"])
        self.assertEqual(ids(aggregate(raw(plan=[old]), TODAY, stale_days=15), "stale"), [])

    def test_utc_z_updated_at_converted_to_jst(self):
        # 2026-09-15T16:00Z = 日本時間 09-16 01:00 → 14日前
        t = T("a", updated_at="2026-09-15T16:00:00.000Z")
        self.assertEqual(ids(aggregate(raw(plan=[t]), TODAY), "stale"), ["a"])

    def test_missing_assignee_or_due(self):
        a = aggregate(raw(plan=[T("a", assignee=None, assignee_display_name=None), T("b", due_date=None)]), TODAY)
        self.assertEqual(sorted(ids(a, "missing")), ["a", "b"])

    def test_gate_violation_only_from_estimating_on(self):
        s = {"1": "見積中", "2": "引き合い/予定"}
        ok = T("ok", custom_field_values=cf(confirm="客先すり合わせ済み"))
        bad = T("bad")  # 確認状況なし＝未設定
        early = T("early", section_id=2)
        a = aggregate(raw(main=[ok, bad, early], sections=s), TODAY)
        self.assertEqual(ids(a, "gate"), ["bad"])

    def test_gate_stage_matches_prefix_section(self):
        s = {"1": "見積提出済み（※受注したら、製造セクションへ移動）"}
        a = aggregate(raw(main=[T("a")], sections=s), TODAY)
        self.assertEqual(ids(a, "gate"), ["a"])

    def test_lost_and_hold_excluded_and_counted(self):
        s = {"1": "製造", "3": "保留中"}
        lost = T("l", custom_field_values=cf(kubun="失注"), due_date="2026-01-01")
        hold = T("h", section_id=3, due_date="2026-01-01")
        live = T("v", due_date="2026-01-01")
        a = aggregate(raw(main=[lost, hold, live], sections=s), TODAY)
        self.assertEqual(ids(a, "overdue"), ["v"])
        self.assertEqual(a["excluded_count"], 2)

    def test_maintenance_board_only_missing_assignee_is_judged(self):
        m = T("m", due_date="2026-01-01", updated_at="2026-01-01 00:00:00", status_name="詰まり")
        m2 = T("m2", assignee=None, assignee_display_name=None, due_date=None)
        a = aggregate(raw(maint=[m, m2]), TODAY)
        self.assertEqual(ids(a, "overdue"), [])
        self.assertEqual(ids(a, "stale"), [])
        self.assertEqual(ids(a, "missing"), ["m2"])


class ByAssigneeTest(unittest.TestCase):
    def test_multi_flag_task_counted_once_per_assignee_with_flags(self):
        t = T("a", due_date="2026-01-01", updated_at="2026-01-01 00:00:00")  # overdue+stale
        a = aggregate(raw(plan=[t]), TODAY)
        g = a["action"]["by_assignee"]
        self.assertEqual(len(g), 1)
        self.assertEqual(g[0]["count"], 1)
        self.assertEqual(g[0]["tasks"][0]["flags"], ["overdue", "stale"])
        self.assertEqual(a["action"]["counts"]["overdue"], 1)
        self.assertEqual(a["action"]["counts"]["stale"], 1)
        self.assertEqual(a["action"]["total_unique"], 1)

    def test_unassigned_group_is_last(self):
        u = T("u", assignee=None, assignee_display_name=None)
        many = [T("x%d" % i, due_date="2026-01-01") for i in range(3)]
        a = aggregate(raw(plan=[u] + many), TODAY)
        names = [g["name"] for g in a["action"]["by_assignee"]]
        self.assertEqual(names[-1], "（担当なし）")
        self.assertEqual(names[0], "甲")

    def test_sum_of_groups_equals_total_unique(self):
        ts = [T("a", due_date="2026-01-01"), T("b", assignee="b", assignee_display_name="乙", status_name="詰まり"),
              T("c", assignee=None, assignee_display_name=None), T("d")]
        a = aggregate(raw(plan=ts), TODAY)
        self.assertEqual(sum(g["count"] for g in a["action"]["by_assignee"]), a["action"]["total_unique"])
        self.assertEqual(a["action"]["total_unique"], 3)

    def test_empty_is_safe(self):
        a = aggregate(raw(), TODAY)
        self.assertEqual(a["action"]["by_assignee"], [])
        self.assertEqual(a["action"]["total_unique"], 0)
        self.assertEqual(set(a["action"]["by_kind"]), {"overdue", "stuck", "stale", "gate", "missing"})

    def test_unknown_section_goes_to_other_and_warns(self):
        t = T("a", section_id=99)
        a = aggregate(raw(main=[t]), TODAY)
        self.assertTrue(any("セクション" in w for w in a["warnings"]))


class IncompleteTest(unittest.TestCase):
    def test_skipped_or_missing_marks_incomplete(self):
        r = raw()
        r["missing_boards"] = ["CS部_企画/内部"]
        self.assertTrue(aggregate(r, TODAY)["incomplete"])
        self.assertFalse(aggregate(raw(), TODAY)["incomplete"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 失敗を確認**

Run: `python -m unittest discover -s tests -p "test_aggregate.py" -v`
Expected: FAIL（`aggregate` が無い）

- [ ] **Step 3: 実装**

`scripts/aggregate.py`:

```python
from datetime import date, datetime, timedelta, timezone

BOARD_MAIN = "CS部"
BOARD_MAINT = "CS部_保守関連"
BOARD_PLAN = "CS部_企画/内部"

STAGES = ["引き合い/予定", "見積中", "見積提出済み", "製造", "テスト", "納品待ち", "請求書発行待ち", "完了"]
GATE_STAGES = STAGES[1:]
OTHER_STAGE = "（段階なし・その他）"
EXCLUDE_KUBUN = {"失注", "保留"}
EXCLUDE_SECTION = {"失注", "保留中"}

KINDS = ["overdue", "stuck", "stale", "gate", "missing"]
KIND_LABEL = {"overdue": "期限切れ", "stuck": "詰まり", "stale": "動きなし",
              "gate": "ゲート違反", "missing": "入力漏れ"}
NO_ASSIGNEE = "（担当なし）"
_JST = timedelta(hours=9)


def _d(s):
    if not s:
        return None
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def _d_jst(s):
    """updated_at / completed_at 用。Z 付き（UTC）は日本時間に直す。"""
    if not s:
        return None
    s = str(s)
    if s.endswith("Z"):
        try:
            return (datetime.fromisoformat(s[:-1]) + _JST).date()
        except ValueError:
            return _d(s)
    return _d(s)


def _stage(section):
    for st in STAGES:
        if section.startswith(st):
            return st
    return None


def _normalize(board, sections, t):
    cf = {c.get("field_name"): c.get("option_name") for c in t.get("custom_field_values") or []}
    sid = str(t.get("section_id"))
    known = sid in sections
    section = sections.get(sid, t.get("section_name") or "")
    return {
        "id": t.get("id"), "title": t.get("title") or "", "board": board,
        "section": section, "section_known": known or bool(t.get("section_name")),
        "assignee": t.get("assignee") or "",
        "assignee_name": t.get("assignee_display_name") or t.get("assignee") or NO_ASSIGNEE,
        "status_name": t.get("status_name") or "", "status_category": t.get("status_category") or "",
        "due": _d(t.get("due_date")), "start": _d(t.get("start_date")), "created": _d(t.get("created_at")),
        "updated": _d_jst(t.get("updated_at")), "completed": _d_jst(t.get("completed_at")),
        "kubun": cf.get("区分") or "", "confirm": cf.get("確認状況") or "未設定",
    }


def _is_open(t):
    return t["status_category"] in ("open", "active")


def _is_excluded(t):
    return t["board"] == BOARD_MAIN and (t["kubun"] in EXCLUDE_KUBUN or t["section"] in EXCLUDE_SECTION)


def _flags(t, today, stale_days):
    if not _is_open(t):
        return []
    maint = t["board"] == BOARD_MAINT
    f = []
    if not maint and t["due"] and t["due"] < today:
        f.append("overdue")
    if t["status_name"] == "詰まり":
        f.append("stuck")
    if not maint and t["updated"] and (today - t["updated"]).days >= stale_days:
        f.append("stale")
    if t["board"] == BOARD_MAIN and _stage(t["section"]) in GATE_STAGES and t["confirm"] != "客先すり合わせ済み":
        f.append("gate")
    if not t["assignee"] or (not maint and not t["due"]):
        f.append("missing")
    return f


def _iso(d):
    return d.isoformat() if d else None


def _entry(t, flags, today):
    return {"id": t["id"], "title": t["title"], "board": t["board"], "section": t["section"],
            "assignee": t["assignee"], "assignee_name": t["assignee_name"], "status": t["status_name"],
            "due": _iso(t["due"]), "updated": _iso(t["updated"]),
            "days_overdue": (today - t["due"]).days if "overdue" in flags else None,
            "flags": flags}


def _action(tasks, today, stale_days):
    by_kind = {k: [] for k in KINDS}
    flagged = []
    for t in tasks:
        f = _flags(t, today, stale_days)
        if not f:
            continue
        e = _entry(t, f, today)
        flagged.append(e)
        for k in f:
            by_kind[k].append(e)
    groups = {}
    for e in flagged:
        g = groups.setdefault(e["assignee"], {"assignee": e["assignee"], "name": e["assignee_name"], "tasks": []})
        g["tasks"].append(e)
    for g in groups.values():
        g["tasks"].sort(key=lambda e: (KINDS.index(e["flags"][0]), e["title"]))
        g["count"] = len(g["tasks"])
    ordered = sorted((g for k, g in groups.items() if k), key=lambda g: (-g["count"], g["name"]))
    if "" in groups:
        groups[""]["name"] = NO_ASSIGNEE
        ordered.append(groups[""])
    return {"counts": {k: len(v) for k, v in by_kind.items()}, "by_kind": by_kind,
            "by_assignee": ordered, "total_unique": len(flagged)}


def aggregate(raw, today, stale_days=14):
    tasks, warnings, unknown_sections = [], [], 0
    for p in raw["projects"]:
        for t in p["tasks"]:
            n = _normalize(p["name"], p.get("sections") or {}, t)
            if not n["section_known"]:
                unknown_sections += 1
            tasks.append(n)
    if unknown_sections:
        warnings.append("セクション名を引けないタスクが %d 件あります（段階なし・その他に数えます）" % unknown_sections)
    excluded = [t for t in tasks if _is_excluded(t)]
    live = [t for t in tasks if not _is_excluded(t)]
    incomplete = bool(raw.get("skipped") or raw.get("missing_boards"))
    if incomplete:
        warnings.append("欠けあり: 取得できなかったボードがあります")
    return {
        "today": today.isoformat(), "stale_days": stale_days, "incomplete": incomplete,
        "warnings": warnings, "excluded_count": len(excluded),
        "action": _action(live, today, stale_days),
        "workload": [], "gantt": [], "deals": {}, "completions": {},
    }
```

- [ ] **Step 4: 通ることを確認**

Run: `python -m unittest discover -s tests -p "test_aggregate.py" -v`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/aggregate.py tests/test_aggregate.py
git commit -m "feat: chub-team-status 判定と担当者別の要対応集計"
```

---

### Task 5: 負荷・完了実績・商談状況（aggregate.py 中盤）

**Files:**
- Modify: `scripts/aggregate.py`（`aggregate()` の返す `workload`, `deals`, `completions` を埋める）
- Test: `tests/test_aggregate.py`（クラス追加）

**Interfaces:**
- Consumes: Task 4 の `_normalize` 結果、`_is_open`, `_is_excluded`, `_flags`
- Produces:
  - `workload`: `[{"assignee","name","open","not_started","in_progress","stuck","overdue","soon"}]`（保守ボード除外、未完了のみ、`open` 降順）
  - `deals`: `{"stages": [{"stage": str, "count": int}], "gate_violations": [entry], "excluded_count": int}`。`stages` は `STAGES` の並び＋末尾に `OTHER_STAGE`。対象は CS部ボードの失注・保留を除く全カード（状態を問わない）
  - `completions`: `{"weeks": ["YYYY-MM-DD"(月曜)×8, 古い順], "total": [int×8], "by_assignee": {"名前": [int×8]}}`（保守ボード除外）

- [ ] **Step 1: 失敗するテストを書く**（`tests/test_aggregate.py` に追記。`import` と `T`, `raw`, `cf` は既存）

```python
class WorkloadTest(unittest.TestCase):
    def test_counts_and_maintenance_excluded(self):
        ts = [T("a"), T("b", status_category="open", status_name="未着手"),
              T("c", status_name="詰まり", due_date="2026-01-01"),
              T("d", due_date="2026-10-05"),
              T("e", status_category="done")]
        m = T("m")
        a = aggregate(raw(plan=ts, maint=[m]), TODAY)
        w = {r["name"]: r for r in a["workload"]}["甲"]
        self.assertEqual(w["open"], 4)
        self.assertEqual(w["not_started"], 1)
        self.assertEqual(w["stuck"], 1)
        self.assertEqual(w["in_progress"], 2)
        self.assertEqual(w["overdue"], 1)
        self.assertEqual(w["soon"], 1)


class CompletionsTest(unittest.TestCase):
    def test_eight_weeks_monday_start(self):
        # 基準日 2026-09-30(水)。今週の月曜は 2026-09-28
        done_this = T("a", status_category="done", completed_at="2026-09-29 09:00:00")
        done_old = T("b", status_category="done", completed_at="2026-08-05 09:00:00")   # 8週窓の外
        done_edge = T("c", status_category="done", completed_at="2026-08-10 09:00:00")  # 最古の週(月曜)
        a = aggregate(raw(plan=[done_this, done_old, done_edge]), TODAY)
        c = a["completions"]
        self.assertEqual(len(c["weeks"]), 8)
        self.assertEqual(c["weeks"][-1], "2026-09-28")
        self.assertEqual(c["weeks"][0], "2026-08-10")
        self.assertEqual(c["total"][-1], 1)
        self.assertEqual(c["total"][0], 1)
        self.assertEqual(sum(c["total"]), 2)
        self.assertEqual(sum(c["by_assignee"]["甲"]), 2)

    def test_maintenance_not_counted(self):
        m = T("m", status_category="done", completed_at="2026-09-29 09:00:00")
        self.assertEqual(sum(aggregate(raw(maint=[m]), TODAY)["completions"]["total"]), 0)


class DealsTest(unittest.TestCase):
    def test_stage_counts_other_and_excluded(self):
        s = {"1": "製造", "2": "見積提出済み（※受注したら…）", "3": "保留中", "4": "謎"}
        ts = [T("a"), T("b", section_id=2), T("c", section_id=3), T("d", section_id=4),
              T("e", custom_field_values=cf(kubun="失注"))]
        d = aggregate(raw(main=ts, sections=s), TODAY)["deals"]
        counts = {x["stage"]: x["count"] for x in d["stages"]}
        self.assertEqual(counts["製造"], 1)
        self.assertEqual(counts["見積提出済み"], 1)
        self.assertEqual(counts["（段階なし・その他）"], 1)
        self.assertEqual(d["excluded_count"], 2)
        self.assertEqual([x["stage"] for x in d["stages"]][-1], "（段階なし・その他）")

    def test_gate_violations_listed(self):
        s = {"1": "製造"}
        d = aggregate(raw(main=[T("a")], sections=s), TODAY)["deals"]
        self.assertEqual([e["id"] for e in d["gate_violations"]], ["a"])
```

- [ ] **Step 2: 失敗を確認**

Run: `python -m unittest discover -s tests -p "test_aggregate.py" -v`
Expected: 新規3クラスが FAIL（`workload` などが空）

- [ ] **Step 3: 実装**（`aggregate.py` の `_action` の下に関数を追加し、`aggregate()` の return を差し替える）

```python
def _workload(tasks, today):
    rows = {}
    for t in tasks:
        if t["board"] == BOARD_MAINT or not _is_open(t):
            continue
        r = rows.setdefault(t["assignee"], {"assignee": t["assignee"], "name": t["assignee_name"],
                                            "open": 0, "not_started": 0, "in_progress": 0, "stuck": 0,
                                            "overdue": 0, "soon": 0})
        r["open"] += 1
        if t["status_name"] == "詰まり":
            r["stuck"] += 1
        elif t["status_category"] == "open":
            r["not_started"] += 1
        else:
            r["in_progress"] += 1
        if t["due"]:
            if t["due"] < today:
                r["overdue"] += 1
            elif t["due"] <= today + timedelta(days=14):
                r["soon"] += 1
    for r in rows.values():
        if not r["assignee"]:
            r["name"] = NO_ASSIGNEE
    return sorted(rows.values(), key=lambda r: (-r["open"], r["name"]))


def _completions(tasks, today):
    monday = today - timedelta(days=today.weekday())
    weeks = [monday - timedelta(days=7 * i) for i in range(7, -1, -1)]
    total, by = [0] * 8, {}
    for t in tasks:
        c = t["completed"]
        if t["board"] == BOARD_MAINT or not c:
            continue
        idx = (c - weeks[0]).days // 7
        if 0 <= idx < 8:
            total[idx] += 1
            by.setdefault(t["assignee_name"], [0] * 8)[idx] += 1
    return {"weeks": [w.isoformat() for w in weeks], "total": total, "by_assignee": by}


def _deals(live, excluded, action_entries_gate):
    counts = {s: 0 for s in STAGES}
    other = 0
    for t in live:
        if t["board"] != BOARD_MAIN:
            continue
        st = _stage(t["section"])
        if st:
            counts[st] += 1
        else:
            other += 1
    stages = [{"stage": s, "count": counts[s]} for s in STAGES] + [{"stage": OTHER_STAGE, "count": other}]
    return {"stages": stages, "gate_violations": action_entries_gate,
            "excluded_count": len([t for t in excluded if t["board"] == BOARD_MAIN])}
```

`aggregate()` の return の該当行を次に差し替える（`action` を変数に取り出す）：

```python
    action = _action(live, today, stale_days)
    return {
        "today": today.isoformat(), "stale_days": stale_days, "incomplete": incomplete,
        "warnings": warnings, "excluded_count": len(excluded),
        "action": action,
        "workload": _workload(live, today),
        "gantt": [],
        "deals": _deals(live, excluded, action["by_kind"]["gate"]),
        "completions": _completions(live, today),
    }
```

- [ ] **Step 4: 通ることを確認**

Run: `python -m unittest discover -s tests -p "test_aggregate.py" -v`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/aggregate.py tests/test_aggregate.py
git commit -m "feat: chub-team-status 負荷・商談状況・完了実績の集計"
```

---

### Task 6: ガント用データ（aggregate.py 後半）

**Files:**
- Modify: `scripts/aggregate.py`
- Test: `tests/test_aggregate.py`（クラス追加）

**Interfaces:**
- Consumes: `_normalize` 結果
- Produces: `gantt`: `[{"assignee","name","tasks":[{"id","title","left":"YYYY-MM-DD","right":"YYYY-MM-DD","color":"overdue|stuck|done|normal|nodue","dotted":bool}]}]`。担当者は未完了件数の多い順、担当なしは末尾。表示範囲は「今日の 4 週前〜8 週後」。`aggregate()` は `gantt_range: {"start","end"}` も返す

- [ ] **Step 1: 失敗するテストを書く**

```python
class GanttTest(unittest.TestCase):
    def bar(self, t, **kw):
        a = aggregate(raw(plan=[t]), TODAY)
        return a["gantt"][0]["tasks"][0], a

    def test_left_is_start_or_created_right_is_due(self):
        b, a = self.bar(T("a", start_date="2026-09-10", due_date="2026-10-20"))
        self.assertEqual((b["left"], b["right"], b["color"], b["dotted"]), ("2026-09-10", "2026-10-20", "normal", False))
        b, _ = self.bar(T("b", start_date=None, created_at="2026-09-05 08:00:00", due_date="2026-10-20"))
        self.assertEqual(b["left"], "2026-09-05")

    def test_overdue_extends_to_today_and_is_red(self):
        b, _ = self.bar(T("a", due_date="2026-09-20"))
        self.assertEqual((b["right"], b["color"]), ("2026-09-30", "overdue"))

    def test_no_due_is_dotted_to_today(self):
        b, _ = self.bar(T("a", due_date=None))
        self.assertEqual((b["right"], b["color"], b["dotted"]), ("2026-09-30", "nodue", True))

    def test_stuck_is_orange(self):
        b, _ = self.bar(T("a", status_name="詰まり"))
        self.assertEqual(b["color"], "stuck")

    def test_done_in_range_shown_out_of_range_hidden(self):
        inr = T("a", status_category="done", completed_at="2026-09-20 10:00:00", due_date="2026-09-25")
        out = T("b", status_category="done", completed_at="2026-05-01 10:00:00")
        a = aggregate(raw(plan=[inr, out]), TODAY)
        got = [x["id"] for g in a["gantt"] for x in g["tasks"]]
        self.assertEqual(got, ["a"])
        self.assertEqual(a["gantt"][0]["tasks"][0]["right"], "2026-09-20")
        self.assertEqual(a["gantt"][0]["tasks"][0]["color"], "done")

    def test_maintenance_and_excluded_not_in_gantt(self):
        a = aggregate(raw(maint=[T("m")], main=[T("l", custom_field_values=cf(kubun="失注"))]), TODAY)
        self.assertEqual(a["gantt"], [])

    def test_range(self):
        a = aggregate(raw(), TODAY)
        self.assertEqual(a["gantt_range"], {"start": "2026-09-02", "end": "2026-11-25"})
```

- [ ] **Step 2: 失敗を確認**

Run: `python -m unittest discover -s tests -p "test_aggregate.py" -v`
Expected: `GanttTest` が FAIL

- [ ] **Step 3: 実装**

`aggregate.py` に追加：

```python
def _gantt(tasks, today):
    start, end = today - timedelta(weeks=4), today + timedelta(weeks=8)
    groups = {}
    for t in tasks:
        if t["board"] == BOARD_MAINT:
            continue
        done = t["status_category"] not in ("open", "active")
        left = t["start"] or t["created"]
        if not left:
            continue
        if done:
            if not t["completed"] or not (start <= t["completed"] <= end):
                continue
            right, color, dotted = t["completed"], "done", False
        elif not t["due"]:
            right, color, dotted = today, "nodue", True
        elif t["due"] < today:
            right, color, dotted = today, "overdue", False
        else:
            right, color, dotted = t["due"], "normal", False
        if not done and t["status_name"] == "詰まり":
            color = "stuck"
        g = groups.setdefault(t["assignee"], {"assignee": t["assignee"],
                                              "name": t["assignee_name"] if t["assignee"] else NO_ASSIGNEE,
                                              "tasks": [], "_open": 0})
        if not done:
            g["_open"] += 1
        g["tasks"].append({"id": t["id"], "title": t["title"], "left": left.isoformat(),
                           "right": max(left, right).isoformat(), "color": color, "dotted": dotted})
    ordered = sorted((g for k, g in groups.items() if k), key=lambda g: (-g["_open"], g["name"]))
    if "" in groups:
        ordered.append(groups[""])
    for g in ordered:
        g.pop("_open")
        g["tasks"].sort(key=lambda x: (x["right"], x["title"]))
    return ordered, {"start": start.isoformat(), "end": end.isoformat()}
```

`aggregate()` の return で `"gantt": [],` を削除し、直前に `gantt, gantt_range = _gantt(live, today)` を置いて `"gantt": gantt, "gantt_range": gantt_range,` を返す。

- [ ] **Step 4: 通ることを確認**

Run: `python -m unittest discover -s tests -v`
Expected: これまでの全テスト PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/aggregate.py tests/test_aggregate.py
git commit -m "feat: chub-team-status ガント用データ"
```

---

### Task 7: HTML ダッシュボード（render_html.py）

**Files:**
- Create: `scripts/render_html.py`
- Test: `tests/test_render.py`

**Interfaces:**
- Consumes: `aggregate()` の戻り値 dict（Task 4〜6 のキー）
- Produces: `render(agg: dict) -> str`（単一 HTML。外部参照なし）

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_render.py`:

```python
import unittest
from datetime import date

import _helpers  # noqa: F401
from aggregate import aggregate
from render_html import render
from test_aggregate import T, raw

TODAY = date(2026, 9, 30)


def build(ts, **kw):
    return render(aggregate(raw(plan=ts, **kw), TODAY))


class RenderTest(unittest.TestCase):
    def test_no_external_refs(self):
        h = build([T("a", due_date="2026-01-01")])
        for bad in ("http://", "https://", "<link", "src="):
            self.assertNotIn(bad, h)

    def test_title_is_escaped(self):
        h = build([T("a", title="<script>alert(1)</script>&x", due_date="2026-01-01")])
        self.assertNotIn("<script>alert(1)</script>", h)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;&amp;x", h)

    def test_assignee_name_is_escaped(self):
        h = build([T("a", assignee_display_name="<b>甲</b>", due_date="2026-01-01")])
        self.assertNotIn("<b>甲</b>", h)

    def test_by_assignee_view_and_toggle(self):
        ts = [T("a", due_date="2026-01-01"), T("u", assignee=None, assignee_display_name=None)]
        h = build(ts)
        self.assertIn("判定別", h)
        self.assertIn("担当者別", h)
        self.assertIn("（担当なし）", h)
        self.assertIn("甲（要対応1件）", h)
        self.assertLess(h.index("甲（要対応1件）"), h.index("（担当なし）（要対応"))

    def test_empty_data_does_not_crash_and_says_none(self):
        h = render(aggregate(raw(), TODAY))
        self.assertIn("該当なし", h)

    def test_incomplete_banner(self):
        r = raw()
        r["missing_boards"] = ["CS部_企画/内部"]
        self.assertIn("欠けあり", render(aggregate(r, TODAY)))

    def test_gantt_bar_present(self):
        h = build([T("a", due_date="2026-10-20")])
        self.assertIn('class="bar', h)


if __name__ == "__main__":
    unittest.main()
```

（注：`test_no_external_refs` の `src=` は HTML 内に `src=` 属性を出さない、という意味。`<script>` はインライン JS のみ。）

- [ ] **Step 2: 失敗を確認**

Run: `python -m unittest discover -s tests -p "test_render.py" -v`
Expected: FAIL（`render_html` が無い）

- [ ] **Step 3: 実装**

`scripts/render_html.py`:

```python
from datetime import date
from html import escape as _e

from aggregate import KIND_LABEL, KINDS, NO_ASSIGNEE

_CSS = """
body{font:14px/1.6 "Yu Gothic UI","Meiryo",sans-serif;margin:0;padding:16px 24px;background:#f6f7f9;color:#222}
h1{font-size:20px}h2{font-size:16px;margin-top:32px;border-bottom:2px solid #ccd;padding-bottom:4px}
table{border-collapse:collapse;background:#fff;width:100%}th,td{border:1px solid #dde;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#eef}.num{text-align:right}.banner{background:#fff3cd;border:1px solid #e0c060;padding:8px 12px;margin:8px 0}
.cards span{display:inline-block;background:#fff;border:1px solid #ccd;padding:6px 14px;margin:0 8px 8px 0}
.tabs button{padding:4px 14px;margin-right:4px;border:1px solid #99a;background:#fff;cursor:pointer}
.tabs button.on{background:#334;color:#fff}details{background:#fff;border:1px solid #dde;margin:6px 0;padding:4px 10px}
summary{cursor:pointer;font-weight:bold}.barbg{background:#e6e8ee;height:14px;position:relative}
.barfill{background:#5b7bd5;height:14px}.gr{position:relative;height:18px;background:#fff;border-bottom:1px solid #eee}
.bar{position:absolute;top:3px;height:12px;background:#5b7bd5}.bar.overdue{background:#d33}.bar.stuck{background:#f0902a}
.bar.done{background:#b9c3dd}.bar.nodue{background:#c7a0d8;border:1px dashed #756;box-sizing:border-box}
.bar.dotted{opacity:.8}.today{position:absolute;top:0;bottom:0;width:2px;background:#e00}
.gl{font-size:12px;color:#556}.flag{display:inline-block;background:#eef;border:1px solid #99a;font-size:11px;padding:0 4px;margin-right:3px}
"""

_JS = """
function show(v){document.getElementById('by-kind').hidden=(v!=='kind');
document.getElementById('by-assignee').hidden=(v!=='assignee');
document.getElementById('tab-kind').className=(v==='kind'?'on':'');
document.getElementById('tab-assignee').className=(v==='assignee'?'on':'');}
document.getElementById('tab-kind').onclick=function(){show('kind')};
document.getElementById('tab-assignee').onclick=function(){show('assignee')};
"""


def _row(e):
    flags = "".join('<span class="flag">%s</span>' % _e(KIND_LABEL[k]) for k in e["flags"])
    od = "（%d日超過）" % e["days_overdue"] if e.get("days_overdue") else ""
    return ("<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s%s</td><td>%s</td><td>%s</td></tr>" % (
        _e(e["title"]), _e(e["board"]), _e(e["section"]), _e(e["assignee_name"]),
        _e(e["due"] or "なし"), _e(od), _e(e["updated"] or "-"), flags))


_HEAD = "<tr><th>タスク</th><th>ボード</th><th>セクション</th><th>担当</th><th>期限</th><th>最終更新</th><th>判定</th></tr>"


def _table(entries):
    if not entries:
        return "<p>該当なし</p>"
    return "<table>%s%s</table>" % (_HEAD, "".join(_row(e) for e in entries))


def _by_kind(agg):
    out = []
    for k in KINDS:
        es = agg["action"]["by_kind"][k]
        out.append("<h3>%s（%d件）</h3>%s" % (_e(KIND_LABEL[k]), len(es), _table(es)))
    return "".join(out)


def _by_assignee(agg):
    groups = agg["action"]["by_assignee"]
    if not groups:
        return "<p>該当なし</p>"
    out = []
    for g in groups:
        name = g["name"] if g["assignee"] else NO_ASSIGNEE
        out.append("<details><summary>%s（要対応%d件）</summary>%s</details>" % (_e(name), g["count"], _table(g["tasks"])))
    return "".join(out)


def _workload(agg):
    rows = agg["workload"]
    if not rows:
        return "<p>該当なし</p>"
    mx = max(r["open"] for r in rows) or 1
    body = "".join(
        "<tr><td>%s</td><td><div class=\"barbg\"><div class=\"barfill\" style=\"width:%d%%\"></div></div></td>"
        "<td class=\"num\">%d</td><td class=\"num\">%d</td><td class=\"num\">%d</td><td class=\"num\">%d</td>"
        "<td class=\"num\">%d</td><td class=\"num\">%d</td></tr>" % (
            _e(r["name"]), int(100 * r["open"] / mx), r["open"], r["not_started"], r["in_progress"],
            r["stuck"], r["overdue"], r["soon"]) for r in rows)
    return ("<table><tr><th>担当</th><th>未完了</th><th>件数</th><th>未着手</th><th>進行中</th><th>詰まり</th>"
            "<th>期限切れ</th><th>期限間近</th></tr>%s</table>" % body)


def _gantt(agg):
    if not agg["gantt"]:
        return "<p>該当なし</p>"
    s = date.fromisoformat(agg["gantt_range"]["start"])
    e = date.fromisoformat(agg["gantt_range"]["end"])
    span = (e - s).days or 1
    today = date.fromisoformat(agg["today"])

    def pct(d):
        return max(0.0, min(100.0, 100.0 * (d - s).days / span))

    tl = pct(today)
    out = []
    for g in agg["gantt"]:
        out.append("<h3>%s</h3>" % _e(g["name"]))
        for t in g["tasks"]:
            l, r = pct(date.fromisoformat(t["left"])), pct(date.fromisoformat(t["right"]))
            cls = "bar %s%s" % (t["color"], " dotted" if t["dotted"] else "")
            out.append('<div class="gl">%s</div><div class="gr"><div class="today" style="left:%.1f%%"></div>'
                       '<div class="%s" style="left:%.1f%%;width:%.1f%%" title="%s ～ %s"></div></div>' % (
                           _e(t["title"]), tl, cls, l, max(0.5, r - l), _e(t["left"]), _e(t["right"])))
    return "".join(out)


def _deals(agg):
    d = agg["deals"]
    rows = "".join("<tr><td>%s</td><td class=\"num\">%d</td></tr>" % (_e(x["stage"]), x["count"]) for x in d["stages"])
    return ("<table><tr><th>段階</th><th>件数</th></tr>%s</table><p>失注・保留（除外）: %d件</p>"
            "<h3>ゲート違反</h3>%s" % (rows, d["excluded_count"], _table(d["gate_violations"])))


def _completions(agg):
    c = agg["completions"]
    head = "".join("<th>%s</th>" % _e(w[5:]) for w in c["weeks"])
    rows = ["<tr><td>全体</td>%s</tr>" % "".join("<td class=\"num\">%d</td>" % n for n in c["total"])]
    for name in sorted(c["by_assignee"]):
        rows.append("<tr><td>%s</td>%s</tr>" % (
            _e(name), "".join("<td class=\"num\">%d</td>" % n for n in c["by_assignee"][name])))
    return "<table><tr><th>週（月曜）</th>%s</tr>%s</table>" % (head, "".join(rows))


def render(agg):
    counts = agg["action"]["counts"]
    cards = "".join("<span>%s <b>%d</b></span>" % (_e(KIND_LABEL[k]), counts[k]) for k in KINDS)
    banner = ""
    if agg["incomplete"]:
        banner += '<div class="banner">欠けあり：取得できなかったボードがあります。数字は全体ではありません。</div>'
    for w in agg["warnings"]:
        if "欠けあり" not in w:
            banner += '<div class="banner">%s</div>' % _e(w)
    return ("<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><title>CS部 タスク状況 %s</title>"
            "<style>%s</style></head><body><h1>CS部 タスク状況（基準日 %s）</h1>%s"
            "<h2>1. 要対応（棚卸し候補）</h2><div class=\"cards\">%s<span>実数（重複除く） <b>%d</b></span></div>"
            "<div class=\"tabs\"><button id=\"tab-kind\" class=\"on\">判定別</button>"
            "<button id=\"tab-assignee\">担当者別</button></div>"
            "<div id=\"by-kind\">%s</div><div id=\"by-assignee\" hidden>%s</div>"
            "<h2>2. 負荷の偏り</h2>%s<h2>3. ガント</h2>%s<h2>4. CS部ボードの商談状況</h2>%s"
            "<h2>5. 完了実績の推移</h2>%s<script>%s</script></body></html>" % (
                _e(agg["today"]), _CSS, _e(agg["today"]), banner, cards, agg["action"]["total_unique"],
                _by_kind(agg), _by_assignee(agg), _workload(agg), _gantt(agg), _deals(agg),
                _completions(agg), _JS))
```

- [ ] **Step 4: 通ることを確認**

Run: `python -m unittest discover -s tests -v`
Expected: 全 PASS。`test_no_external_refs` が落ちたら、出力に `http://`/`https://`/`src=` が入っていないか（CSS・JS 内も）確認して直す。

- [ ] **Step 5: Commit**

```bash
git add scripts/render_html.py tests/test_render.py
git commit -m "feat: chub-team-status HTML ダッシュボード（担当者別表示つき）"
```

---

### Task 8: 入口・保存と後始末（run.py）

**Files:**
- Create: `scripts/run.py`
- Test: `tests/test_run.py`

**Interfaces:**
- Consumes: `load_config`, `Client`, `fetch_all`, `aggregate`, `render`, `ConfigError`, `ChubError`
- Produces: `prune(runs_dir: str, keep: int = 5) -> list[str]`（消したディレクトリ名）、`main(argv=None, env=os.environ, client_factory=None) -> int`。CLI: `python scripts/run.py [report|レポート] [--today YYYY-MM-DD] [--stale-days N]`。標準出力の最終行に `集計: <path>\aggregate.json`（report 時は `HTML: <path>\dashboard.html` も）

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_run.py`:

```python
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout

import _helpers  # noqa: F401
from chub_client import ChubHttpError
from run import main, prune
from test_aggregate import T, raw


class PruneTest(unittest.TestCase):
    def test_keeps_latest_five(self):
        with tempfile.TemporaryDirectory() as d:
            names = ["20260901-000000", "20260902-000000", "20260903-000000", "20260904-000000",
                     "20260905-000000", "20260906-000000", "20260907-000000"]
            for n in names:
                os.makedirs(os.path.join(d, n))
            removed = prune(d, keep=5)
            self.assertEqual(sorted(removed), names[:2])
            self.assertEqual(sorted(os.listdir(d)), names[2:])


class FakeClientFactory:
    def __init__(self, exc=None):
        self.exc = exc

    def __call__(self, cfg):
        exc = self.exc

        class C:
            def get(self, path, params=None):
                if exc:
                    raise exc
                base = "/api/plugin/task-manager/projects"
                if path == base:
                    return {"data": {"projects": [{"id": "p1", "name": "CS部_企画/内部", "archived": 0}]}}
                if path.endswith("/tasks"):
                    return {"data": {"tasks": [T("a", due_date="2026-01-01")]}}
                return {"data": {"project": {"sections": [{"id": 1, "name": "作業"}]}}}

        return C()


def env_with_config(d):
    p = os.path.join(d, "config.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"base_url": "https://chub.example", "api_key": "chub_SECRETVALUE"}, f)
    return {"CHUB_CONFIG_FILE": p, "LOCALAPPDATA": d}


class MainTest(unittest.TestCase):
    def test_report_writes_files_and_hides_key(self):
        with tempfile.TemporaryDirectory() as d:
            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = main(["report", "--today", "2026-09-30"], env=env_with_config(d),
                          client_factory=FakeClientFactory())
            self.assertEqual(rc, 0)
            out = buf.getvalue()
            self.assertNotIn("chub_SECRETVALUE", out)
            self.assertIn("dashboard.html", out)
            runs = os.path.join(d, "chub-team-status", "runs")
            run_dir = os.path.join(runs, os.listdir(runs)[0])
            self.assertEqual(sorted(os.listdir(run_dir)), ["aggregate.json", "dashboard.html", "raw.json"])
            agg = json.load(open(os.path.join(run_dir, "aggregate.json"), encoding="utf-8"))
            self.assertEqual(agg["action"]["total_unique"], 1)

    def test_consult_mode_has_no_html(self):
        with tempfile.TemporaryDirectory() as d:
            with redirect_stdout(io.StringIO()):
                main(["--today", "2026-09-30"], env=env_with_config(d), client_factory=FakeClientFactory())
            runs = os.path.join(d, "chub-team-status", "runs")
            self.assertNotIn("dashboard.html", os.listdir(os.path.join(runs, os.listdir(runs)[0])))

    def test_http_error_returns_1_with_message(self):
        with tempfile.TemporaryDirectory() as d:
            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = main([], env=env_with_config(d),
                          client_factory=FakeClientFactory(ChubHttpError(401, "401: キーが違う")))
            self.assertEqual(rc, 1)
            self.assertIn("401", buf.getvalue())

    def test_unexpected_error_prints_type_only(self):
        with tempfile.TemporaryDirectory() as d:
            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = main([], env=env_with_config(d),
                          client_factory=FakeClientFactory(RuntimeError("chub_SECRETVALUE leaked")))
            self.assertEqual(rc, 1)
            self.assertIn("RuntimeError", buf.getvalue())
            self.assertNotIn("chub_SECRETVALUE", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 失敗を確認**

Run: `python -m unittest discover -s tests -p "test_run.py" -v`
Expected: FAIL（`run` が無い）

- [ ] **Step 3: 実装**

`scripts/run.py`:

```python
import argparse
import json
import os
import shutil
import sys
from datetime import date, datetime, timedelta, timezone

from aggregate import aggregate
from chub_client import ChubError, Client
from chub_config import ConfigError, load_config
from fetch import fetch_all
from render_html import render


def prune(runs_dir, keep=5):
    if not os.path.isdir(runs_dir):
        return []
    names = sorted(n for n in os.listdir(runs_dir) if os.path.isdir(os.path.join(runs_dir, n)))
    removed = names[:-keep] if keep else names
    for n in removed:
        shutil.rmtree(os.path.join(runs_dir, n), ignore_errors=True)
    return removed


def _default_client(cfg):
    return Client(cfg["base_url"], cfg["api_key"])


def _dump(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, default=str)


def main(argv=None, env=os.environ, client_factory=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", nargs="?", default="consult", choices=["consult", "report", "レポート"])
    ap.add_argument("--today")
    ap.add_argument("--stale-days", type=int, default=14)
    args = ap.parse_args(argv)
    try:
        cfg = load_config(env=env)
        print("接続先: %s" % cfg["base_url"])
        client = (client_factory or _default_client)(cfg)
        raw = fetch_all(client)
        jst_today = (datetime.now(timezone.utc) + timedelta(hours=9)).date()
        today = date.fromisoformat(args.today) if args.today else jst_today
        agg = aggregate(raw, today, args.stale_days)

        base = env.get("LOCALAPPDATA") or os.path.expanduser("~")
        runs = os.path.join(base, "chub-team-status", "runs")
        run_dir = os.path.join(runs, datetime.now().strftime("%Y%m%d-%H%M%S"))
        os.makedirs(run_dir, exist_ok=True)
        _dump(os.path.join(run_dir, "raw.json"), raw)
        _dump(os.path.join(run_dir, "aggregate.json"), agg)
        print("集計: %s" % os.path.join(run_dir, "aggregate.json"))
        if args.mode in ("report", "レポート"):
            html_path = os.path.join(run_dir, "dashboard.html")
            with open(html_path, "w", encoding="utf-8") as f:
                f.write(render(agg))
            print("HTML: %s" % html_path)
        prune(runs, keep=5)
        return 0
    except (ConfigError, ChubError) as e:
        print("エラー: %s" % e)
        return 1
    except Exception as e:  # キーが紛れ込む経路を断つため、種類名だけ出す
        print("想定外のエラー: %s" % type(e).__name__)
        return 1


if __name__ == "__main__":
    sys.exit(main())
```

同一秒に2回実行すると同じディレクトリ名になる点は、`exist_ok=True` で上書きされるだけで実害なし（手動運用のため）。

- [ ] **Step 4: 通ることを確認**

Run: `python -m unittest discover -s tests -v`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/run.py tests/test_run.py
git commit -m "feat: chub-team-status 入口と保存・後始末"
```

---

### Task 9: SKILL.md と実機での通し確認

**Files:**
- Create: `SKILL.md`

**Interfaces:**
- Consumes: `python scripts/run.py`、集計 JSON のキー（`action.by_assignee`, `action.by_kind`, `action.counts`, `workload`, `deals`, `completions`, `warnings`, `incomplete`）

- [ ] **Step 1: SKILL.md を書く**

```markdown
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
```

- [ ] **Step 2: 実機で通す**

Run: `python scripts/run.py report`
Expected: 接続先・取得件数（プロジェクト 3 件）が出て、`集計:` と `HTML:` のパスが出る。キーは出ない。
確認（設計書 9章）:
- `aggregate.json` の `action.total_unique` と、HTML の「担当者別」の各見出しの件数合計が一致する
- HTML をブラウザで開き、「判定別／担当者別」の切替が動き、担当なしが末尾にある
- CS部ボードのカード総数が C-HUB 画面と一致する（`deals.stages` の合計 + `excluded_count` ≒ CS部の全カード数）
- ガントが見づらい場合は、設計書 11章の候補（操作履歴から着手日を推定）として別途検討する

- [ ] **Step 3: 全テストの最終確認**

Run: `python -m unittest discover -s tests -v`
Expected: 全 PASS

- [ ] **Step 4: Commit**

```bash
git add SKILL.md
git commit -m "feat: chub-team-status SKILL.md"
```

---

## Self-Review メモ

- **Spec coverage**: 4章（設定・キー）= Task 1／5章（取得・回数・429・403 スキップ・保管済み除外）= Task 2・3／6章（判定・除外・保守ボード・段階・集計）= Task 4〜6／7章（HTML・担当者別切替・ガント）= Task 6・7／8章（エラー時）= Task 1・2・8／9章（テスト）= 各 Task／5章 保存・後始末 = Task 8／担当者別グループ = Task 4（データ）・7（表示）・9（会話）。
- **実機依存は Task 3 Step 5 に集約**（セクション取得の形状）。
- **型の一貫性**: `entry` のキー、`by_assignee[].{assignee,name,count,tasks}`、`gantt_range`、`completions.{weeks,total,by_assignee}` は Task 4〜7 で同名。
- ファイル権限（`icacls`）の設定は利用者の手作業（設計書 4章）でありコード化しない。
