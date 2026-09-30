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

    def test_banner_names_the_missing_board(self):
        r = raw()
        r["skipped"] = [{"name": "CS部_保守関連", "reason": "HTTP 500"}]
        h = render(aggregate(r, TODAY))
        self.assertIn("CS部_保守関連", h)
        self.assertIn("HTTP 500", h)

    def test_gantt_bar_present(self):
        h = build([T("a", due_date="2026-10-20")])
        self.assertIn('class="bar', h)


if __name__ == "__main__":
    unittest.main()
