import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout

import _helpers  # noqa: F401
from chub_client import ChubHttpError
from run import main, prune
from test_aggregate import T


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
