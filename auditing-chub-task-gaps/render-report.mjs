// 使い方: node render-report.mjs <result.json> <out.html>
// result.json の形:
// {
//   "date": "2026-09-30",
//   "projects": ["品質保証", "信大(キャンパス分離)", ...],          // 巡回したプロジェクト名
//   "overdue":  [{ "owner": "大縄", "items": [{ "project": "BPop", "title": "Gitea移行", "due": "9/4", "note": "" }] }],
//   "nodue":    [{ "owner": "小林", "items": [{ "project": "CS部", "title": "IR連携", "note": "" }] }],
//   "unassigned": [{ "project": "RPA", "items": [{ "title": "納品前チェックリスト", "due": "", "note": "" }] }]
// }
// overdue / nodue は担当者別(件数の多い順は本スクリプトが並べ替える)。unassigned はプロジェクト別。
// 外部通信なし・自己完結のHTMLを書き出す。
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) { console.error('usage: node render-report.mjs <result.json> <out.html>'); process.exit(1); }
const d = JSON.parse(readFileSync(inFile, 'utf8'));

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sortByCount = arr => [...(arr || [])].sort((a, b) => b.items.length - a.items.length);
const count = arr => (arr || []).reduce((n, g) => n + g.items.length, 0);

const overdue = sortByCount(d.overdue), nodue = sortByCount(d.nodue), unassigned = sortByCount(d.unassigned);
const nO = count(overdue), nN = count(nodue), nU = count(unassigned);

const li = (it, { showProject = true, showDue = false } = {}) =>
  `<li data-t="${esc([it.project, it.title, it.note].join(' ').toLowerCase())}">` +
  (showProject && it.project ? `<span class="proj">${esc(it.project)}</span>` : '') +
  `<span class="title">${esc(it.title)}</span>` +
  (showDue && it.due ? `<span class="due">期限: ${esc(it.due)}</span>` : '') +
  (it.note ? `<span class="note">備考: ${esc(it.note)}</span>` : '') + `</li>`;

const byOwner = (groups, showDue) => groups.length ? groups.map(g =>
  `<details open><summary><b>${esc(g.owner)}</b><span class="badge">${g.items.length}件</span></summary><ul>${g.items.map(it => li(it, { showDue })).join('')}</ul></details>`
).join('') : '<p class="none">該当なし</p>';

const byProject = groups => groups.length ? groups.map(g =>
  `<details><summary><b>${esc(g.project)}</b><span class="badge">${g.items.length}件</span></summary><ul>${g.items.map(it => li(it, { showProject: false, showDue: true })).join('')}</ul></details>`
).join('') : '<p class="none">該当なし</p>';

const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>C-HUB タスク抜け漏れ ${esc(d.date)}</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1c2330;--sub:#5c6675;--line:#dde1e8;--o:#c0392b;--n:#b9770e;--u:#1f6feb;--chip:#eef1f6}
@media (prefers-color-scheme:dark){:root{--bg:#12161d;--card:#1a2029;--fg:#e6eaf0;--sub:#9aa5b5;--line:#2a3340;--o:#ff7b6b;--n:#f0b45a;--u:#6ea8ff;--chip:#242c38}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 "Segoe UI","Hiragino Sans","Yu Gothic UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:20px;margin:0 0 4px}.meta{color:var(--sub);font-size:13px;margin-bottom:16px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.card .k{font-size:12px;color:var(--sub)}.card .v{font-size:28px;font-weight:700;line-height:1.2}
.card.o .v{color:var(--o)}.card.n .v{color:var(--n)}.card.u .v{color:var(--u)}
.tools{display:flex;gap:8px;margin-bottom:12px}.tools input{flex:1;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:inherit}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 14px 12px;margin-bottom:16px}
h2{font-size:16px;margin:8px 0}h2.o{color:var(--o)}h2.n{color:var(--n)}h2.u{color:var(--u)}
details{border-top:1px solid var(--line);padding:6px 0}details:first-of-type{border-top:0}
summary{cursor:pointer;padding:4px 0;list-style-position:inside}.badge{margin-left:8px;background:var(--chip);border-radius:999px;padding:0 8px;font-size:12px;color:var(--sub)}
ul{margin:4px 0 6px;padding-left:18px}li{padding:2px 0}li.hide{display:none}
.proj{display:inline-block;background:var(--chip);border-radius:4px;padding:0 6px;margin-right:6px;font-size:12px;color:var(--sub)}
.due{margin-left:8px;color:var(--sub);font-size:13px}.note{display:block;margin-left:2px;color:var(--sub);font-size:13px}
.none{color:var(--sub);margin:6px 0}details.proj-list>summary{font-weight:400}
@media (max-width:600px){.cards{grid-template-columns:1fr}}
@media print{.tools{display:none}details{display:block}}
</style></head><body><main>
<h1>C-HUB タスク抜け漏れ一覧</h1>
<div class="meta">実行日 ${esc(d.date)} ／ 巡回 ${(d.projects || []).length}プロジェクト(「マーケ」を除く) ／ 閲覧のみで取得</div>
<div class="cards">
<div class="card o"><div class="k">期限切れ</div><div class="v">${nO}</div></div>
<div class="card n"><div class="k">期限未入力</div><div class="v">${nN}</div></div>
<div class="card u"><div class="k">担当者未入力</div><div class="v">${nU}</div></div>
</div>
<div class="tools"><input id="q" type="search" placeholder="プロジェクト名・タスク名・担当者で絞り込み"></div>
<section><h2 class="o">■ 期限切れ(担当者別)</h2>${byOwner(overdue, true)}</section>
<section><h2 class="n">■ 期限未入力(担当者別)</h2>${byOwner(nodue, false)}</section>
<section><h2 class="u">■ 担当者未入力(プロジェクト別)</h2>${byProject(unassigned)}</section>
<section><details><summary>巡回したプロジェクト(${(d.projects || []).length})</summary><p>${(d.projects || []).map(esc).join(' / ')}</p></details></section>
<script>
const q=document.getElementById('q');
q.addEventListener('input',()=>{const v=q.value.trim().toLowerCase();
document.querySelectorAll('li').forEach(li=>{const own=(li.closest('details')?.querySelector('summary')?.textContent||'').toLowerCase();li.classList.toggle('hide',v&&!(li.dataset.t.includes(v)||own.includes(v)))});
if(v)document.querySelectorAll('details').forEach(x=>x.open=true)});
</script>
</main></body></html>`;

writeFileSync(outFile, html, 'utf8');
console.log(`wrote ${outFile}  overdue=${nO} nodue=${nN} unassigned=${nU}`);
