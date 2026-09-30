from chub_client import ChubHttpError

BOARDS = ("CS部", "CS部_保守関連", "CS部_企画/内部")
_BASE = "/api/plugin/task-manager/projects"


def _project_sections(detail):
    """詳細レスポンスから {section_id(str): 名前} を作る。形状が違えばここだけ直す。"""
    project = ((detail or {}).get("data") or {}).get("project") or {}
    return {str(s.get("id")): s.get("name") or "" for s in project.get("sections") or []}


def fetch_all(client, log=print):
    listing = client.get(_BASE)
    projects = ((listing.get("data") or {}).get("projects")) or []
    targets = [p for p in projects if p.get("name") in BOARDS and not p.get("archived")]
    found = {p["name"] for p in targets}
    missing = [b for b in BOARDS if b not in found]
    for b in missing:
        log("警告: ボード「%s」が見つかりません（名前が変わった可能性）" % b)

    out, skipped, ntasks = [], [], 0
    for p in targets:
        try:
            detail = client.get("%s/%s" % (_BASE, p["id"]))
            tasks = client.get("%s/%s/tasks" % (_BASE, p["id"]), {"show_completed": "true"})
        except ChubHttpError as e:
            if e.status == 403:
                skipped.append({"name": p["name"], "reason": "403"})
                log("警告: 「%s」は権限がなく飛ばしました" % p["name"])
                continue
            raise
        items = ((tasks.get("data") or {}).get("tasks")) or []
        ntasks += len(items)
        out.append({"id": p["id"], "name": p["name"],
                    "sections": _project_sections(detail), "tasks": items})
    log("取得: プロジェクト %d 件 / タスク %d 件" % (len(out), ntasks))
    return {"projects": out, "skipped": skipped, "missing_boards": missing,
            "counts": {"projects": len(out), "tasks": ntasks}}
