import unittest
from datetime import date

import _helpers  # noqa: F401
from aggregate import aggregate
from render_html import render
from test_aggregate import T, raw

TODAY = date(2026, 9, 30)


def build(ts, url_for=None, **kw):
    return render(aggregate(raw(plan=ts, **kw), TODAY), url_for)


class RenderTest(unittest.TestCase):
    def test_no_external_refs_without_links(self):
        h = build([T("a", due_date="2026-01-01")])
        for bad in ("http://", "https://", "<link", "src=", "<script"):
            self.assertNotIn(bad, h)

    def test_title_is_escaped(self):
        h = build([T("a", title="<script>alert(1)</script>&x", due_date="2026-01-01")])
        self.assertNotIn("<script>alert(1)</script>", h)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;&amp;x", h)

    def test_assignee_name_is_escaped(self):
        h = build([T("a", assignee_display_name="<b>甲</b>", due_date="2026-01-01")])
        self.assertNotIn("<b>甲</b>", h)

    def test_member_sections_split_by_category(self):
        ts = [T("o", due_date="2026-09-20"),                       # 期限切れ（10日超過）
              T("s", status_name="詰まり"),                          # 詰まり
              T("t", updated_at="2026-09-10 10:00:00")]             # 動きなし（20日間）
        h = build(ts)
        sec = h[h.index('id="m-0"'):h.index('id="unassigned"')]
        for want in ("抱えているプロジェクト（1案件・未完了3件）", "期限切れ（1件）", "10日超過",
                     "詰まり（1件）", "動きなし（14日以上更新なし）（1件）", "20日間"):
            self.assertIn(want, sec)
        self.assertLess(sec.index("期限切れ"), sec.index("詰まり"))
        self.assertLess(sec.index("詰まり"), sec.index("動きなし"))

    def test_folded_members_are_collapsed_and_others_are_not(self):
        h = build([T("a", assignee_display_name="小林 太郎", title="隠すタスク"),
                   T("b", assignee_display_name="山田 花子", title="見せるタスク")])
        kobayashi = h[h.index("小林 太郎"):h.index("隠すタスク")]
        self.assertIn('<details class="fold"><summary><h2>小林 太郎', h)
        self.assertNotIn("<details open", h)
        self.assertEqual(h.count('class="fold"'), 1)
        self.assertNotIn("山田 花子</h2></summary>", h)
        self.assertIn("見せるタスク", h)
        self.assertTrue(kobayashi)

    def test_nodue_group_lists_tasks_without_due_date(self):
        h = build([T("n", due_date=None, title="期限なしタスク"), T("d")])
        sec = h[h.index('id="m-0"'):h.index('id="unassigned"')]
        self.assertIn("期限未設定（1件）", sec)
        self.assertLess(sec.index("動きなし"), sec.index("期限未設定"))
        self.assertIn("期限なしタスク", sec[sec.index("期限未設定"):])
        self.assertIn("<th>期限未設定</th>", h)

    def test_empty_categories_say_none(self):
        h = build([T("a")])
        self.assertIn("期限切れ（0件）</h3><p class=\"none\">なし</p>", h)

    def test_project_names_shown_with_counts(self):
        h = build([T("a", title="信州大学：A"), T("b", title="信州大学：B"), T("c", title="山洋電気:C")])
        self.assertIn("信州大学 <b>2件</b>", h)
        self.assertIn("山洋電気 <b>1件</b>", h)

    def test_unassigned_is_separate_and_after_members(self):
        ts = [T("a", due_date="2026-01-01"), T("u", assignee=None, assignee_display_name=None, title="宙ぶらりん")]
        h = build(ts)
        self.assertIn("（担当なし）", h)
        self.assertLess(h.index('id="m-0"'), h.index('id="unassigned"'))
        member_part = h[h.index('id="m-0"'):h.index('id="unassigned"')]
        self.assertNotIn("宙ぶらりん", member_part)
        self.assertIn("宙ぶらりん", h[h.index('id="unassigned"'):])

    def test_maint_unassigned_is_collapsed(self):
        m = T("m", assignee=None, assignee_display_name=None, title="契約X")
        h = render(aggregate(raw(maint=[m]), TODAY))
        tail = h[h.index('id="unassigned"'):]
        self.assertIn("<details><summary>CS部_保守関連（1件）", tail)
        self.assertIn("契約X", tail)

    def test_links_use_url_for_and_are_escaped(self):
        url_for = lambda e: 'https://chub.example/t?id=%s&x="1"' % e["id"]
        h = build([T("a", due_date="2026-01-01")], url_for)
        self.assertIn('href="https://chub.example/t?id=a&amp;x=&quot;1&quot;"', h)
        self.assertIn('rel="noopener noreferrer"', h)
        self.assertNotIn("リンクは未設定", h)

    def test_no_links_when_url_for_returns_none(self):
        h = build([T("a", due_date="2026-01-01")], lambda e: None)
        self.assertNotIn("<a href=\"https", h)
        self.assertIn("タスクa", h)

    def test_unset_links_are_announced(self):
        self.assertIn("リンクは未設定", build([T("a")]))

    def test_summary_links_to_each_member(self):
        h = build([T("a"), T("b", assignee="b", assignee_display_name="乙")])
        self.assertIn('href="#m-0"', h)
        self.assertIn('href="#m-1"', h)
        self.assertIn('href="#unassigned"', h)

    def test_empty_data_does_not_crash(self):
        h = render(aggregate(raw(), TODAY))
        self.assertIn("（担当なし）", h)
        self.assertIn("なし", h)

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

    def test_font_is_large_enough_for_a_meeting_room_screen(self):
        import re
        h = build([T("a")])
        screen = h[h.index("<style>"):h.index("@media print")]
        self.assertGreaterEqual(int(re.search(r"body\{font:(\d+)px", screen).group(1)), 20)

    def test_print_keeps_a_normal_size(self):
        import re
        h = build([T("a")])
        self.assertLessEqual(int(re.search(r"@media print\{body\{font-size:(\d+)px", h).group(1)), 14)

    def test_dropped_sections_are_gone(self):
        h = build([T("a", due_date="2026-10-20")])
        for gone in ("ガント", "完了実績", "商談状況", "ゲート違反", "負荷の偏り"):
            self.assertNotIn(gone, h)


if __name__ == "__main__":
    unittest.main()
