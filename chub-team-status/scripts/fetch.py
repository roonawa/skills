from chub_client import ChubError, ChubHttpError

BOARDS = ("CS部", "CS部_保守関連", "CS部_企画/内部", "品質保証")
_BASE = "/api/plugin/task-manager/projects"


def _project_sections(listing):
    """/sections のレスポンスから {section_id(str): 名前} を作る。形状が違えばここだけ直す。"""
    sections = ((listing or {}).get("data") or {}).get("sections") or []
    return {str(s.get("id")): s.get("name") or "" for s in sections}


def _is_archived(p):
    """archived は 0/1 の数値でも "0"/"1" の文字列でも来る（文字列 "0" は真になるので比較する）。"""
    return str(p.get("archived") or 0).strip().lower() in ("1", "true")


def fetch_all(client, log=print):
    listing = client.get(_BASE)
    projects = ((listing.get("data") or {}).get("projects")) or []
    targets = [{**p, "name": p.get("title")} for p in projects
               if p.get("title") in BOARDS and not _is_archived(p)]
    found = {p["name"] for p in targets}
    missing = [b for b in BOARDS if b not in found]
    for b in missing:
        log("警告: ボード「%s」が見つかりません（名前が変わった可能性）" % b)

    out, skipped, ntasks = [], [], 0
    for p in targets:
        try:
            sections = client.get("%s/%s/sections" % (_BASE, p["id"]))
            tasks = client.get("%s/%s/tasks" % (_BASE, p["id"]), {"show_completed": "true"})
        except ChubHttpError as e:
            if e.status in (401, 429):
                raise
            skipped.append({"name": p["name"], "reason": "HTTP %d" % e.status})
            log("警告: 「%s」は取得できず飛ばしました（HTTP %d）" % (p["name"], e.status))
            continue
        except ChubError as e:
            skipped.append({"name": p["name"], "reason": str(e)})
            log("警告: 「%s」は取得できず飛ばしました（%s）" % (p["name"], e))
            continue
        items = ((tasks.get("data") or {}).get("tasks")) or []
        ntasks += len(items)
        out.append({"id": p["id"], "name": p["name"],
                    "sections": _project_sections(sections), "tasks": items})
    log("取得: プロジェクト %d 件 / タスク %d 件" % (len(out), ntasks))
    return {"projects": out, "skipped": skipped, "missing_boards": missing,
            "counts": {"projects": len(out), "tasks": ntasks}}
