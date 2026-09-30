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
