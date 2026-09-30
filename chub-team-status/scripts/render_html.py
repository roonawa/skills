from datetime import date
from html import escape as _e

from aggregate import KIND_LABEL, KINDS, NO_ASSIGNEE

_CSS = """
body{font:14px/1.6 "Yu Gothic UI","Meiryo",sans-serif;margin:0;padding:16px 24px;background:#f6f7f9;color:#222}
h1{font-size:20px}h2{font-size:16px;margin-top:32px;border-bottom:2px solid #ccd;padding-bottom:4px}
table{border-collapse:collapse;background:#fff;width:100%}th,td{border:1px solid #dde;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#eef}.num{text-align:right}.banner{background:#fff3cd;border:1px solid #e0c060;padding:8px 12px;margin:8px 0}
.cards span{display:inline-block;background:#fff;border:1px solid #ccd;padding:6px 14px;margin:0 8px 8px 0}
.tabs button{padding:4px 14px;margin-right:4px;border:1px solid #99a;background:#fff;cursor:pointer}
.tabs button.on{background:#334;color:#fff}details{background:#fff;border:1px solid #dde;margin:6px 0;padding:4px 10px}
summary{cursor:pointer;font-weight:bold}.barbg{background:#e6e8ee;height:14px;position:relative}
.barfill{background:#5b7bd5;height:14px}.gr{position:relative;height:18px;background:#fff;border-bottom:1px solid #eee}
.bar{position:absolute;top:3px;height:12px;background:#5b7bd5}.bar.overdue{background:#d33}.bar.stuck{background:#f0902a}
.bar.done{background:#b9c3dd}.bar.nodue{background:#c7a0d8;border:1px dashed #756;box-sizing:border-box}
.bar.dotted{opacity:.8}.today{position:absolute;top:0;bottom:0;width:2px;background:#e00}
.gl{font-size:12px;color:#556}.flag{display:inline-block;background:#eef;border:1px solid #99a;font-size:11px;padding:0 4px;margin-right:3px}
"""

_JS = """
function show(v){document.getElementById('by-kind').hidden=(v!=='kind');
document.getElementById('by-assignee').hidden=(v!=='assignee');
document.getElementById('tab-kind').className=(v==='kind'?'on':'');
document.getElementById('tab-assignee').className=(v==='assignee'?'on':'');}
document.getElementById('tab-kind').onclick=function(){show('kind')};
document.getElementById('tab-assignee').onclick=function(){show('assignee')};
"""

_HEAD = "<tr><th>タスク</th><th>ボード</th><th>セクション</th><th>担当</th><th>期限</th><th>最終更新</th><th>判定</th></tr>"


def _row(e):
    flags = "".join('<span class="flag">%s</span>' % _e(KIND_LABEL[k]) for k in e["flags"])
    od = "（%d日超過）" % e["days_overdue"] if e.get("days_overdue") else ""
    return ("<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s%s</td><td>%s</td><td>%s</td></tr>" % (
        _e(e["title"]), _e(e["board"]), _e(e["section"]), _e(e["assignee_name"]),
        _e(e["due"] or "なし"), _e(od), _e(e["updated"] or "-"), flags))


def _table(entries):
    if not entries:
        return "<p>該当なし</p>"
    return "<table>%s%s</table>" % (_HEAD, "".join(_row(e) for e in entries))


def _by_kind(agg):
    out = []
    for k in KINDS:
        es = agg["action"]["by_kind"][k]
        out.append("<h3>%s（%d件）</h3>%s" % (_e(KIND_LABEL[k]), len(es), _table(es)))
    return "".join(out)


def _by_assignee(agg):
    groups = agg["action"]["by_assignee"]
    if not groups:
        return "<p>該当なし</p>"
    out = []
    for g in groups:
        name = g["name"] if g["assignee"] else NO_ASSIGNEE
        out.append("<details><summary>%s（要対応%d件）</summary>%s</details>" % (_e(name), g["count"], _table(g["tasks"])))
    return "".join(out)


def _workload(agg):
    rows = agg["workload"]
    if not rows:
        return "<p>該当なし</p>"
    mx = max(r["open"] for r in rows) or 1
    body = "".join(
        '<tr><td>%s</td><td><div class="barbg"><div class="barfill" style="width:%d%%"></div></div></td>'
        '<td class="num">%d</td><td class="num">%d</td><td class="num">%d</td><td class="num">%d</td>'
        '<td class="num">%d</td><td class="num">%d</td></tr>' % (
            _e(r["name"]), int(100 * r["open"] / mx), r["open"], r["not_started"], r["in_progress"],
            r["stuck"], r["overdue"], r["soon"]) for r in rows)
    return ("<table><tr><th>担当</th><th>未完了</th><th>件数</th><th>未着手</th><th>進行中</th><th>詰まり</th>"
            "<th>期限切れ</th><th>期限間近</th></tr>%s</table>" % body)


def _gantt(agg):
    if not agg["gantt"]:
        return "<p>該当なし</p>"
    s = date.fromisoformat(agg["gantt_range"]["start"])
    e = date.fromisoformat(agg["gantt_range"]["end"])
    span = (e - s).days or 1
    today = date.fromisoformat(agg["today"])

    def pct(d):
        return max(0.0, min(100.0, 100.0 * (d - s).days / span))

    tl = pct(today)
    out = []
    for g in agg["gantt"]:
        out.append("<h3>%s</h3>" % _e(g["name"]))
        for t in g["tasks"]:
            l, r = pct(date.fromisoformat(t["left"])), pct(date.fromisoformat(t["right"]))
            cls = "bar %s%s" % (t["color"], " dotted" if t["dotted"] else "")
            out.append('<div class="gl">%s</div><div class="gr"><div class="today" style="left:%.1f%%"></div>'
                       '<div class="%s" style="left:%.1f%%;width:%.1f%%" title="%s ～ %s"></div></div>' % (
                           _e(t["title"]), tl, cls, l, max(0.5, r - l), _e(t["left"]), _e(t["right"])))
    return "".join(out)


def _deals(agg):
    d = agg["deals"]
    rows = "".join('<tr><td>%s</td><td class="num">%d</td></tr>' % (_e(x["stage"]), x["count"]) for x in d["stages"])
    return ("<table><tr><th>段階</th><th>件数</th></tr>%s</table><p>失注・保留（除外）: %d件</p>"
            "<h3>ゲート違反</h3>%s" % (rows, d["excluded_count"], _table(d["gate_violations"])))


def _completions(agg):
    c = agg["completions"]
    head = "".join("<th>%s</th>" % _e(w[5:]) for w in c["weeks"])
    rows = ['<tr><td>全体</td>%s</tr>' % "".join('<td class="num">%d</td>' % n for n in c["total"])]
    for name in sorted(c["by_assignee"]):
        rows.append("<tr><td>%s</td>%s</tr>" % (
            _e(name), "".join('<td class="num">%d</td>' % n for n in c["by_assignee"][name])))
    return "<table><tr><th>週（月曜）</th>%s</tr>%s</table>" % (head, "".join(rows))


def render(agg):
    counts = agg["action"]["counts"]
    cards = "".join("<span>%s <b>%d</b></span>" % (_e(KIND_LABEL[k]), counts[k]) for k in KINDS)
    banner = "".join('<div class="banner">%s</div>' % _e(w) for w in agg["warnings"])
    return ('<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>CS部 タスク状況 %s</title>'
            "<style>%s</style></head><body><h1>CS部 タスク状況（基準日 %s）</h1>%s"
            '<h2>1. 要対応（棚卸し候補）</h2><div class="cards">%s<span>実数（重複除く） <b>%d</b></span></div>'
            '<div class="tabs"><button id="tab-kind" class="on">判定別</button>'
            '<button id="tab-assignee">担当者別</button></div>'
            '<div id="by-kind">%s</div><div id="by-assignee" hidden>%s</div>'
            "<h2>2. 負荷の偏り</h2>%s<h2>3. ガント</h2>%s<h2>4. CS部ボードの商談状況</h2>%s"
            "<h2>5. 完了実績の推移</h2>%s<script>%s</script></body></html>" % (
                _e(agg["today"]), _CSS, _e(agg["today"]), banner, cards, agg["action"]["total_unique"],
                _by_kind(agg), _by_assignee(agg), _workload(agg), _gantt(agg), _deals(agg),
                _completions(agg), _JS))
