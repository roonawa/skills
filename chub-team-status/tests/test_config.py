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
