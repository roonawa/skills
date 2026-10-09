import unittest

import _helpers  # noqa: F401
from links import task_url


class LinksTest(unittest.TestCase):
    def test_unset_template_gives_no_link(self):
        self.assertIsNone(task_url("https://chub.example", "task-1", "tp-1", template=""))

    def test_placeholders_are_filled_and_base_slash_trimmed(self):
        u = task_url("https://chub.example/", "task-1", "tp-1", template="{base_url}/x?p={project_id}&t={task_id}")
        self.assertEqual(u, "https://chub.example/x?p=tp-1&t=task-1")

    def test_ids_are_url_quoted(self):
        u = task_url("https://chub.example", "a b&c", None, template="{base_url}/?t={task_id}")
        self.assertEqual(u, "https://chub.example/?t=a%20b%26c")

    def test_non_https_result_is_refused(self):
        self.assertIsNone(task_url("http://chub.example", "t", None, template="{base_url}/?t={task_id}"))
        self.assertIsNone(task_url("https://chub.example", "t", None, template="javascript:alert({task_id})"))

    def test_default_template_matches_chub_copy_link(self):
        # C-HUB の「リンクをコピー」で得た実際の URL（2026-10-01 確認）
        self.assertEqual(task_url("https://chub.ailesys.co.jp", "task-1785827344572-6g2nj"),
                         "https://chub.ailesys.co.jp/?view=task-manager&taskId=task-1785827344572-6g2nj")

    def test_missing_task_id_gives_no_link(self):
        self.assertIsNone(task_url("https://chub.example", None, None, template="{base_url}/?t={task_id}"))


if __name__ == "__main__":
    unittest.main()
