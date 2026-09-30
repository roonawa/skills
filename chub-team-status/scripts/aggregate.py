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
