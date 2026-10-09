"""C-HUB の画面でタスクを開く URL の形（秘密は含まない）。

API からは画面の URL を取れないので、C-HUB の「リンクをコピー」で得た実際の URL から形を決める。
使えるのは {base_url}（config.json の接続先）・{task_id}・{project_id}。
空のままならレポートはリンクなしで出る。
"""
from urllib.parse import quote

TASK_URL_TEMPLATE = "{base_url}/?view=task-manager&taskId={task_id}"


def task_url(base_url, task_id, project_id=None, template=None):
    tpl = TASK_URL_TEMPLATE if template is None else template
    if not tpl or not task_id:
        return None
    url = tpl.format(base_url=(base_url or "").rstrip("/"),
                     task_id=quote(str(task_id), safe=""),
                     project_id=quote(str(project_id or ""), safe=""))
    return url if url.startswith("https://") else None
