#!/usr/bin/env node
/**
 * 画面ごとの report.html（と comparison.json・manifest.json）を、タブで切り替えて見られる1つの HTML にまとめる。
 * cs-webview-regression-test・cs-native-regression-test の run（evidence/<run-id>/）に共通で使う。
 *
 * 使い方:
 *   node make-tabbed-report.cjs --out <まとめ.html> [--title <題名>] [--task <依頼・タスク>] [--embed] [--draft]
 *        <run-dir> [<run-dir>...]
 *
 *   - run-dir は報告に載せる順に並べる。各 run-dir に report.html と comparison.json が必要（manifest.json は任意）。
 *   - 既定では画像を「まとめ.html から各 run-dir への相対パス」で参照する。まとめ.html は証跡フォルダ（run-dir の親）に置き、
 *     フォルダごと渡す。--embed を付けると画像を data URI で埋め込み、1ファイルで持ち出せる（大きくなる）。
 *   - --copy-evidence を付けると、報告書が参照するファイルだけを「まとめ.html と同じ場所の 証跡/<run-id>/」へ写し、
 *     そこを参照する。証跡フォルダの外（報告書の格納先 C:\_cs_regression\<対象> 等）へ置くときに使う。
 *     参照先が見つからないファイルがあれば一覧を出して終了コード4で止まる。
 *   - 報告書には未実施を残さない。ケースの判定か API の呼び出し箇所に「未実施」「期待未設定」が残っていれば、
 *     一覧を出して終了コード3で止まる。作業途中の確認用だけ --draft で作れる（題名に【途中経過】が付く）。
 *   - 秘密値は扱わない。入力の report.html・comparison.json に出ていない情報は足さない。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
    const o = { runs: [], embed: false, draft: false, title: null, task: null, out: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--out") o.out = argv[++i];
        else if (a === "--title") o.title = argv[++i];
        else if (a === "--task") o.task = argv[++i];
        else if (a === "--embed") o.embed = true;
        else if (a === "--draft") o.draft = true;
        else if (a === "--copy-evidence") o.copyEvidence = true;
        else if (a === "-h" || a === "--help") o.help = true;
        else o.runs.push(a);
    }
    return o;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, "")) : null);
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const isLocalRef = (u) => u && !/^(#|data:|https?:|mailto:|javascript:|\/)/i.test(u) && !/^[a-z]:[\\/]/i.test(u);
const jst = (d) => new Date(d).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });

/** report.html の <main> の中身を取り出し、id・アンカー・画像・リンクを1つのページ用に書き換える */
const copied = { n: 0, missing: [] };
function adaptReport(html, prefix, runDir, outDir, embed, copyDir) {
    const m = html.match(/<main[^>]*>([\s\S]*)<\/main>/i) ?? html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    let body = m ? m[1] : html;
    body = body.replace(/<script[\s\S]*?<\/script>/gi, "");
    // 横長の表はスマホ幅でページごとはみ出すので、横スクロールの枠に入れる（入れ子の表は無い前提）
    body = body.replace(/<table\b/gi, '<div class="tscroll"><table').replace(/<\/table>/gi, "</table></div>");
    body = body.replace(/\sid="([^"]+)"/g, (_, id) => ` id="${prefix}-${id}"`);
    body = body.replace(/\shref="#([^"]*)"/g, (_, id) => ` href="#${prefix}-${id}"`);
    const rel = (u) => {
        if (!copyDir) return path.relative(outDir, path.join(runDir, decodeURIComponent(u))).split(path.sep).join("/");
        // --copy-evidence：参照するファイルだけを <まとめの置き場>/証跡/<run-id>/ へ写し、そこを参照する
        const sub = decodeURIComponent(u).split(/[\\/]/);
        const src = path.join(runDir, ...sub);
        const dst = path.join(copyDir, path.basename(runDir), ...sub);
        if (fs.existsSync(src)) {
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(src, dst);
            copied.n++;
        } else copied.missing.push(path.join(path.basename(runDir), ...sub));
        return path.relative(outDir, dst).split(path.sep).join("/");
    };
    body = body.replace(/<img\b([^>]*?)\ssrc="([^"]+)"([^>]*)>/gi, (all, pre, src, post) => {
        if (!isLocalRef(src)) return all;
        if (embed) {
            const file = path.join(runDir, decodeURIComponent(src));
            if (!fs.existsSync(file)) return `<img${pre} src="${esc(rel(src))}" data-missing="1"${post}>`;
            const mime = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
            return `<img${pre} src="data:${mime};base64,${fs.readFileSync(file).toString("base64")}"${post}>`;
        }
        const lazy = /\sloading=/.test(pre + post) ? "" : ' loading="lazy"';
        return `<img${pre} src="${esc(rel(src))}"${lazy}${post}>`;
    });
    body = body.replace(/<a\b([^>]*?)\shref="([^"]+)"/gi, (all, pre, href) => (isLocalRef(href) ? `<a${pre} href="${esc(rel(href))}"` : all));
    return body;
}

const VERDICT_ORDER = ["一致", "期待どおり", "意図した差分", "要確認", "比較不能", "未実施"];
const BADGE = { 一致: "ok", 期待どおり: "ok", 意図した差分: "info", 要確認: "ng", 比較不能: "warn", 未実施: "warn" };

function main() {
    const o = parseArgs(process.argv.slice(2));
    if (o.help || !o.out || !o.runs.length) {
        console.error("usage: node make-tabbed-report.cjs --out <まとめ.html> [--title T] [--task T] [--embed] [--copy-evidence] [--draft] <run-dir>...");
        process.exit(o.help ? 0 : 2);
    }
    const outFile = path.resolve(o.out);
    const outDir = path.dirname(outFile);
    let style = "";
    const screens = [];
    o.runs.forEach((r, i) => {
        const runDir = path.resolve(r);
        const reportFile = path.join(runDir, "report.html");
        const comp = readJson(path.join(runDir, "comparison.json"));
        if (!fs.existsSync(reportFile) || !comp) throw new Error(`${runDir} に report.html と comparison.json が要る`);
        const man = readJson(path.join(runDir, "manifest.json")) ?? {};
        const html = fs.readFileSync(reportFile, "utf8");
        if (!style) style = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/i) ?? [])[1] ?? "";
        const title = (html.match(/<title>([\s\S]*?)<\/title>/i) ?? [])[1]?.replace(/\s*(回帰テスト|レポート)\s*$/, "").trim();
        const label = String(man.screen ?? "").match(/（(.+)）\s*$/)?.[1] ?? title ?? comp.screen ?? path.basename(runDir);
        const prefix = `s${i + 1}`;
        const copyDir = o.copyEvidence && !o.embed ? path.join(outDir, "証跡") : null;
        screens.push({ i, prefix, runDir, label, comp, man, body: adaptReport(html, prefix, runDir, outDir, o.embed, copyDir) });
    });

    // ---- 未実施の確認（報告書には残さない）
    const PENDING = /^(未実施|期待未設定)/;
    const pending = screens.flatMap((s) => [
        ...s.comp.cases.filter((c) => PENDING.test(c.verdict)).map((c) => ({ s, kind: "ケース", what: `${c.id} ${c.operation ?? ""}`, why: (c.reasons ?? []).join(" ／ ") })),
        ...(s.comp.apis ?? [])
            .filter((a) => Object.values(a.perEnv ?? {}).some((p) => PENDING.test(p.verdict)))
            .map((a) => ({ s, kind: "API", what: `${a.name} @${a.at}`, why: Object.values(a.perEnv).map((p) => p.detail).find(Boolean) ?? "" })),
    ]);
    if (pending.length && !o.draft) {
        console.error(`未実施が ${pending.length} 件残っている。WebView2で実施する・cs-native で実施する（報告書の前に利用者へ報告）・母数から外す（excluded に理由）のどれかに片付けてから作り直す。作業途中の確認だけなら --draft。`);
        for (const x of pending) console.error(`  [${x.s.label}] ${x.kind} ${x.what} :: ${String(x.why).slice(0, 160)}`);
        process.exit(3);
    }
    const title = (o.draft ? "【途中経過】" : "") + (o.title ?? "回帰テスト結果");

    // ---- まとめ（集計）
    const verdicts = [...new Set([...VERDICT_ORDER, ...screens.flatMap((s) => s.comp.cases.map((c) => c.verdict))])].filter((v) =>
        screens.some((s) => s.comp.cases.some((c) => c.verdict === v)),
    );
    const total = Object.fromEntries(verdicts.map((v) => [v, 0]));
    let totalCases = 0;
    let totalApi = 0;
    let totalApiNg = 0;
    // 母数から外した（除外の）呼び出し箇所は報告書に載せない。古い comparison.json に残っていても数えない
    const isEx = (a) => Object.values(a.perEnv ?? {}).every((p) => p.verdict === "除外");
    for (const s of screens) s.comp.apis = (s.comp.apis ?? []).filter((a) => !isEx(a));
    const rows = screens.map((s) => {
        const cnt = Object.fromEntries(verdicts.map((v) => [v, s.comp.cases.filter((c) => c.verdict === v).length]));
        verdicts.forEach((v) => (total[v] += cnt[v]));
        totalCases += s.comp.cases.length;
        const apiNg = (s.comp.apis ?? []).filter((a) => Object.values(a.perEnv ?? {}).some((p) => /要確認/.test(p.verdict))).length;
        totalApi += (s.comp.apis ?? []).length;
        totalApiNg += apiNg;
        const envs = (s.comp.envs ?? []).join("・");
        const at = Object.values(s.man.env ?? {}).map((e) => e.executedAt).filter(Boolean)[0] ?? jst(s.comp.generatedAt);
        return `<tr><td><a href="#${s.prefix}" data-tab="${s.prefix}">${esc(s.label)}</a></td><td>${esc(envs)}</td><td class="n">${s.comp.cases.length}</td>${verdicts
            .map((v) => `<td class="n">${cnt[v] ? `<span class="b ${BADGE[v] ?? "info"}">${cnt[v]}</span>` : '<span class="mut">0</span>'}</td>`)
            .join("")}<td class="n">${(s.comp.apis ?? []).length}</td><td class="n">${apiNg ? `<span class="b ng">${apiNg}</span>` : '<span class="mut">0</span>'}</td><td class="mut">${esc(at)}</td></tr>`;
    });
    const totalRow = `<tr class="tot"><th>合計（${screens.length}画面）</th><td></td><td class="n">${totalCases}</td>${verdicts
        .map((v) => `<td class="n">${total[v]}</td>`)
        .join("")}<td class="n">${totalApi}</td><td class="n">${totalApiNg}</td><td></td></tr>`;

    const pick = (pred) =>
        screens.flatMap((s) =>
            s.comp.cases.filter(pred).map(
                (c) =>
                    `<tr><td><a href="#${s.prefix}-${esc(c.id)}">${esc(s.label)} ${esc(c.id)}</a></td><td>${esc(c.operation)}</td><td>${esc(c.cause ?? c.proposal ?? (c.reasons ?? []).filter((x) => !/^判定の上書き/.test(x)).join(" ／ "))}</td></tr>`,
            ),
        );
    const ngRows = pick((c) => c.verdict === "要確認" || c.verdict === "比較不能");
    const naRows = pending.map((x) => `<tr><td><a href="#${x.s.prefix}">${esc(x.s.label)}</a></td><td>${esc(x.kind)} ${esc(x.what)}</td><td>${esc(x.why)}</td></tr>`);
    const apiNgRows = screens.flatMap((s) =>
        (s.comp.apis ?? [])
            .filter((a) => Object.values(a.perEnv ?? {}).some((p) => /要確認/.test(p.verdict)))
            .map((a) => `<tr><td>${esc(s.label)}</td><td>${esc(a.name)}</td><td>${esc(a.at)}</td><td>${esc(Object.entries(a.perEnv).map(([e, p]) => `${e}：${p.detail}`).join(" ／ "))}</td></tr>`),
    );
    const table = (head, body, empty) =>
        body.length ? `<div class="wrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body.join("")}</tbody></table></div>` : `<p class="mut">${esc(empty)}</p>`;

    const summary = `
<h1>${esc(title)}</h1>
${o.task ? `<p class="mut">${esc(o.task)}</p>` : ""}
<p class="mut">作成 ${esc(jst(Date.now()))}（各画面の report.html・comparison.json から集計）。画面名を押すと、その画面のタブに移る。</p>
<h2>画面ごとの判定</h2>
<div class="wrap"><table class="sum"><thead><tr><th>画面</th><th>環境</th><th>ケース</th>${verdicts.map((v) => `<th>${esc(v)}</th>`).join("")}<th>API 箇所</th><th>API 要確認</th><th>実行</th></tr></thead>
<tbody>${rows.join("")}</tbody><tfoot>${totalRow}</tfoot></table></div>
<h2>要確認・比較不能のケース</h2>
${table(["ケース", "操作", "原因・提案"], ngRows, "なし")}
<h2>API の要確認</h2>
${table(["画面", "API", "呼び出し箇所", "記録"], apiNgRows, "なし")}
${o.draft ? `<h2>未実施（途中経過。報告書の前に片付ける）</h2>
${table(["画面", "対象", "理由"], naRows, "なし")}` : ""}`;

    const tabs = [`<button role="tab" id="t-sum" aria-controls="sum" data-tab="sum">まとめ</button>`]
        .concat(
            screens.map((s) => {
                const ng = s.comp.cases.filter((c) => c.verdict === "要確認" || c.verdict === "比較不能").length;
                return `<button role="tab" id="t-${s.prefix}" aria-controls="${s.prefix}" data-tab="${s.prefix}">${esc(s.label)}${ng ? ` <span class="b ng">${ng}</span>` : ""}</button>`;
            }),
        )
        .join("");
    const panels = [`<section role="tabpanel" id="sum" aria-labelledby="t-sum">${summary}</section>`]
        .concat(screens.map((s) => `<section role="tabpanel" id="${s.prefix}" aria-labelledby="t-${s.prefix}" hidden>${s.body}</section>`))
        .join("\n");

    const page = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${style}
.tabs{position:sticky;top:0;z-index:5;background:var(--bg,#fff);display:flex;gap:4px;overflow-x:auto;border-bottom:2px solid var(--line,#d9dee3);padding:8px 16px 0;margin:0 -16px 16px;scrollbar-width:thin}
.tabs button{flex:0 0 auto;font:inherit;font-size:13px;color:var(--fg,#1d2329);background:var(--head,#f4f6f8);border:1px solid var(--line,#d9dee3);border-bottom:none;border-radius:6px 6px 0 0;padding:6px 12px;cursor:pointer;white-space:nowrap}
.tabs button[aria-selected="true"]{background:var(--bg,#fff);font-weight:700;box-shadow:inset 0 3px 0 var(--info,#1f5fa8)}
.tabs button:focus-visible{outline:2px solid var(--info,#1f5fa8);outline-offset:-2px}
[role=tabpanel] [id]{scroll-margin-top:64px}.tscroll{overflow-x:auto;max-width:100%}[role=tabpanel]{min-width:0;overflow-wrap:anywhere}[role=tabpanel] img{max-width:100%;height:auto}
a{color:var(--info,#1f5fa8)}table.sum th,table.sum td:nth-child(2){white-space:nowrap}
td.n,th.n{text-align:right}table.sum tfoot th,table.sum tfoot td{background:var(--head,#f4f6f8);font-weight:700}
</style></head><body><main>
<nav class="tabs" role="tablist" aria-label="画面">${tabs}</nav>
${panels}
</main><script>
(function(){
  var tabs=[].slice.call(document.querySelectorAll('[role=tab]'));
  function show(id,scrollTo){
    var panel=document.getElementById(id);if(!panel||panel.getAttribute('role')!=='tabpanel')return false;
    tabs.forEach(function(t){var on=t.getAttribute('aria-controls')===id;t.setAttribute('aria-selected',on);t.tabIndex=on?0:-1;
      var p=document.getElementById(t.getAttribute('aria-controls'));if(p)p.hidden=!on;if(on)t.scrollIntoView({block:'nearest',inline:'nearest'});});
    if(scrollTo){var el=document.getElementById(scrollTo);if(el)el.scrollIntoView();}else window.scrollTo(0,0);
    return true;
  }
  function route(){
    var h=decodeURIComponent(location.hash.slice(1));if(!h){show('sum');return;}
    if(show(h))return;
    var el=document.getElementById(h);var p=el&&el.closest('[role=tabpanel]');if(p)show(p.id,h);else show('sum');
  }
  tabs.forEach(function(t,i){
    t.addEventListener('click',function(){var id=t.getAttribute('aria-controls');show(id);if(location.hash.slice(1)!==id)history.pushState(null,'','#'+id);});
    t.addEventListener('keydown',function(e){var k=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(!k)return;var n=tabs[(i+k+tabs.length)%tabs.length];n.focus();n.click();e.preventDefault();});
  });
  document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href^="#"]');if(!a||a.closest('[role=tablist]'))return;
    var h=decodeURIComponent(a.getAttribute('href').slice(1));if(!document.getElementById(h))return;e.preventDefault();history.pushState(null,'','#'+h);route();});
  window.addEventListener('hashchange',route);window.addEventListener('popstate',route);route();
})();
</script></body></html>`;
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, page, "utf8");
    const size = fs.statSync(outFile).size;
    console.log(JSON.stringify({ out: outFile, screens: screens.length, cases: totalCases, verdicts: total, apiSites: totalApi, apiNg: totalApiNg, pending: pending.length, draft: o.draft, embed: o.embed, copiedEvidence: o.copyEvidence ? copied.n : undefined, bytes: size }));
    if (copied.missing.length) {
        console.error(`証跡の写しで、参照先が見つからないファイルが ${copied.missing.length} 件ある（報告書の画像が欠ける）。`);
        for (const f of copied.missing.slice(0, 20)) console.error(`  ${f}`);
        process.exit(4);
    }
}

try {
    main();
} catch (e) {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
}
