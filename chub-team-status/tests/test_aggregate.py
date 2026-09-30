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
