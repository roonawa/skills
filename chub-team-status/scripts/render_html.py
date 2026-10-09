from html import escape as _e

from aggregate import BOARD_MAINT, NO_ASSIGNEE

# 名前にこの文字列を含むメンバーは、開くまで中身を隠す（プルダウン）。
FOLDED_MEMBERS = ("小林", "竹内")

_CSS = """
body{font:20px/1.6 "Yu Gothic UI","Meiryo",sans-serif;margin:0 auto;padding:24px 32px 64px;background:#f6f7f9;color:#222;max-width:1700px}
h1{font-size:1.6em;margin:0 0 8px}h1 small{font-size:.65em;font-weight:normal;color:#556;margin-left:14px}
h2{font-size:1.4em;margin:0 0 10px;padding:8px 16px;background:#334;color:#fff}h2 small{font-size:.7em;font-weight:normal;margin-left:14px;color:#cdd}
h3{font-size:1.15em;margin:20px 0 6px;padding-left:12px;border-left:6px solid #99a}
h3.overdue{border-color:#d33}h3.stuck{border-color:#f0902a}h3.stale{border-color:#b8a000}h3.proj{border-color:#5b7bd5}
h3.nodue{border-color:#8a5bc4}
section{background:#fff;border:1px solid #dde;margin:28px 0;padding:0 0 14px;break-inside:avoid}
section>*:not(h2){margin-left:16px;margin-right:16px}
table{border-collapse:collapse;width:calc(100% - 32px)}th,td{border:1px solid #dde;padding:6px 12px;text-align:left;vertical-align:top}
th{background:#eef;font-weight:normal;font-size:.8em;color:#445}.num{text-align:right;white-space:nowrap}
.sum{width:auto;background:#fff;margin:12px 0}.sum th,.sum td{padding:8px 18px}.sum td.hot{background:#fde8e8;font-weight:bold}.sum td.zero{color:#aab}
.none{color:#889;margin:4px 16px}.banner{background:#fff3cd;border:1px solid #e0c060;padding:10px 16px;margin:10px 0}
ul.projs{list-style:none;padding:0;margin:0 16px}ul.projs details{margin:4px 0}ul.projs summary{cursor:pointer}
ul.projs ul{margin:4px 0 10px;padding-left:28px}.days{white-space:nowrap}.note{color:#667;font-size:.8em}
a{color:#1a56c4}details{margin:8px 16px}summary{cursor:pointer}
details.fold{margin:0}details.fold>*:not(summary){margin-left:16px;margin-right:16px}
details.fold>summary{list-style:none}details.fold>summary::-webkit-details-marker{display:none}
details.fold>summary h2{margin:0}details.fold>summary h2::before{content:"▶ ";font-size:.7em}
details.fold[open]>summary h2::before{content:"▼ "}
@media print{body{font-size:12px;background:#fff;padding:0;max-width:none}a{color:#000;text-decoration:none}}
"""


def _date(d):
    return d or "なし"


def _link(e, url_for):
    title = _e(e["title"])
    url = url_for(e) if url_for else None
    if not url:
        return title
    return '<a href="%s" target="_blank" rel="noopener noreferrer">%s</a>' % (_e(url), title)


def _ago(e):
    n = e.get("days_since_update")
    return "%s（%d日前）" % (_e(e["updated"]), n) if n is not None and e.get("updated") else "-"


def _group(title, cls, entries, head, row, url_for):
    h = '<h3 class="%s">%s（%d件）</h3>' % (cls, _e(title), len(entries))
    if not entries:
        return h + '<p class="none">なし</p>'
    rows = "".join("<tr>%s</tr>" % row(e, url_for) for e in entries)
    return h + "<table><tr>%s</tr>%s</table>" % ("".join("<th>%s</th>" % x for x in head), rows)


def _row_overdue(e, u):
    return "<td>%s</td><td>%s</td><td class=\"days\">%d日超過</td>" % (_link(e, u), _e(_date(e["due"])), e["days_overdue"] or 0)


def _row_stuck(e, u):
    return "<td>%s</td><td>%s</td><td>%s</td>" % (_link(e, u), _e(_date(e["due"])), _ago(e))


def _row_stale(e, u):
    n = e.get("days_since_update")
    return "<td>%s</td><td>%s</td><td class=\"days\">%s</td>" % (
        _link(e, u), _e(_date(e["updated"])), "%d日間" % n if n is not None else "-")


def _row_nodue(e, u):
    return "<td>%s</td><td>%s</td><td>%s</td>" % (_link(e, u), _e(e["status"] or "-"), _ago(e))


def _row_free(e, u):
    return "<td>%s</td><td>%s</td><td>%s</td><td>%s</td>" % (
        _link(e, u), _e(e["board"]), _e(_date(e["due"])), _ago(e))


def _projects(m, url_for):
    items = []
    for p in m["projects"]:
        tasks = "".join("<li>%s</li>" % _link(e, url_for) for e in p["tasks"])
        items.append("<li><details><summary>%s <b>%d件</b></summary><ul>%s</ul></details></li>" % (
            _e(p["name"]), p["count"], tasks))
    return ('<h3 class="proj">抱えているプロジェクト（%d案件・未完了%d件）</h3><ul class="projs">%s</ul>' % (
        len(m["projects"]), m["open"], "".join(items)))


def _is_folded(name):
    return any(k in name for k in FOLDED_MEMBERS)


def _member(i, m, stale_days, url_for):
    body = "%s%s%s%s" % (
        _projects(m, url_for),
        _group("期限切れ", "overdue", m["overdue"], ["タスク", "期限", "超過"], _row_overdue, url_for),
        _group("詰まり", "stuck", m["stuck"], ["タスク", "期限", "最終更新"], _row_stuck, url_for),
        _group("動きなし（%d日以上更新なし）" % stale_days, "stale", m["stale"],
               ["タスク", "最終更新", "更新なし"], _row_stale, url_for)
        + _group("期限未設定", "nodue", m["nodue"], ["タスク", "状態", "最終更新"], _row_nodue, url_for))
    if _is_folded(m["name"]):
        return ('<section id="m-%d"><details class="fold"><summary><h2>%s<small>未完了%d件・クリックで開く</small></h2>'
                "</summary>%s</details></section>" % (i, _e(m["name"]), m["open"], body))
    return '<section id="m-%d"><h2>%s</h2>%s</section>' % (i, _e(m["name"]), body)


def _summary(agg):
    def cell(n):
        return '<td class="num %s">%d</td>' % ("hot" if n else "zero", n)

    rows = []
    for i, m in enumerate(agg["members"]):
        rows.append('<tr><td><a href="#m-%d">%s</a></td><td class="num">%d</td><td class="num">%d</td>%s%s%s%s</tr>' % (
            i, _e(m["name"]), m["open"], len(m["projects"]), cell(len(m["overdue"])),
            cell(len(m["stuck"])), cell(len(m["stale"])), cell(len(m["nodue"]))))
    n = len(agg["unassigned"])
    rows.append('<tr><td><a href="#unassigned">%s</a></td><td class="num">%d</td>%s</tr>' % (
        _e(NO_ASSIGNEE), n, "<td></td>" * 5))
    return ('<table class="sum"><tr><th>メンバー</th><th>未完了</th><th>案件</th><th>期限切れ</th><th>詰まり</th>'
            '<th>動きなし</th><th>期限未設定</th></tr>%s</table>' % "".join(rows))


def _unassigned(agg, url_for):
    free = agg["unassigned"]
    head = "".join("<th>%s</th>" % x for x in ["タスク", "ボード", "期限", "最終更新"])
    table = lambda es: "<table><tr>%s</tr>%s</table>" % (head, "".join("<tr>%s</tr>" % _row_free(e, url_for) for e in es))
    main = [e for e in free if e["board"] != BOARD_MAINT]
    maint = [e for e in free if e["board"] == BOARD_MAINT]
    body = table(main) if main else '<p class="none">なし</p>'
    if maint:
        body += "<details><summary>%s（%d件）</summary>%s</details>" % (_e(BOARD_MAINT), len(maint), table(maint))
    return ('<section id="unassigned"><h2>%s<small>%d件</small></h2>'
            '<p class="note">メンバー別の集計には含めていません。</p>%s</section>' % (_e(NO_ASSIGNEE), len(free), body))


def render(agg, url_for=None):
    """url_for(entry) -> タスクの URL（https）または None。None ならリンクなしで出す。"""
    banner = "".join('<div class="banner">%s</div>' % _e(w) for w in agg["warnings"])
    if url_for is None:
        banner += '<div class="banner">タスクへのリンクは未設定です（scripts/links.py）。</div>'
    members = "".join(_member(i, m, agg["stale_days"], url_for) for i, m in enumerate(agg["members"]))
    return ('<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>CS部 メンバー別タスク状況 %s</title>'
            "<style>%s</style></head><body><h1>CS部 メンバー別タスク状況<small>基準日 %s</small></h1>%s%s%s%s</body></html>" % (
                _e(agg["today"]), _CSS, _e(agg["today"]), banner, _summary(agg), members, _unassigned(agg, url_for)))
