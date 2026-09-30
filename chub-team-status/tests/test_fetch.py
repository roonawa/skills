import unittest

import _helpers  # noqa: F401
from chub_client import ChubError, ChubHttpError
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

    def test_500_and_non_json_on_a_board_are_skipped_others_continue(self):
        c = FakeClient(routes(), fail={BASE + "/p1/tasks": ChubHttpError(500, "HTTP 500"),
                                       BASE + "/p2": ChubError("レスポンスが JSON ではありません")})
        raw = fetch_all(c, log=lambda *_: None)
        self.assertEqual(sorted(s["name"] for s in raw["skipped"]), ["CS部", "CS部_保守関連"])
        self.assertEqual(raw["projects"], [])

    def test_401_and_429_on_a_board_stop_the_run(self):
        for status in (401, 429):
            c = FakeClient(routes(), fail={BASE + "/p1": ChubHttpError(status, str(status))})
            with self.assertRaises(ChubHttpError):
                fetch_all(c, log=lambda *_: None)

    def test_403_on_list_is_fatal(self):
        c = FakeClient(routes(), fail={BASE: ChubHttpError(403, "403")})
        with self.assertRaises(ChubHttpError):
            fetch_all(c, log=lambda *_: None)


if __name__ == "__main__":
    unittest.main()
