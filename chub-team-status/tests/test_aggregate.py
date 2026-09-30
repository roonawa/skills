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


class GanttTest(unittest.TestCase):
    def bar(self, t):
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

    def test_warning_names_skipped_and_missing_boards_with_reason(self):
        r = raw()
        r["skipped"] = [{"name": "CS部_保守関連", "reason": "HTTP 500"}]
        r["missing_boards"] = ["CS部_企画/内部"]
        w = " ".join(aggregate(r, TODAY)["warnings"])
        self.assertIn("CS部_保守関連", w)
        self.assertIn("HTTP 500", w)
        self.assertIn("CS部_企画/内部", w)


if __name__ == "__main__":
    unittest.main()
