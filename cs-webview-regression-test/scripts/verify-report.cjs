#!/usr/bin/env node
/**
 * タブでまとめた報告書（make-tabbed-report.cjs の出力）と不具合報告書を、ヘッドレスのブラウザで開いて確かめる（読み取りだけ）。
 *   - すべてのタブが切り替わる・各タブの画像がすべて読める（naturalWidth>0）
 *   - コンソールにエラーが無い
 *   - 画面内リンク（#<タブ>-<TC> 等）で該当タブに移る（各タブの先頭のリンクを抜き取りで確認）
 *   - スマホ幅（390px）で横にはみ出さない
 *   - ダーク表示で本文の文字色と背景色が同じにならない
 *   - 不具合報告書を渡したときは、その中の画像と、報告書へのリンク先のファイルの存在
 * 使い方: node verify-report.cjs <report.html> [<bugs.html>] [--playwright <node_modules のあるフォルダ>]
 * 終了コード: 0＝問題なし、1＝問題あり（JSON の problems に一覧）
 */
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const pwIdx = args.indexOf("--playwright");
const pwBase = pwIdx >= 0 ? args.splice(pwIdx, 2)[1] : process.env.CS_PLAYWRIGHT_BASE || "C:/Users/roonawa/allcampus/frontend";
const [reportPath, bugsPath] = args;
if (!reportPath) { console.error("usage: node verify-report.cjs <report.html> [<bugs.html>]"); process.exit(2); }
const { chromium } = require(require.resolve("playwright", { paths: [pwBase] }));
const fileUrl = (p) => "file:///" + path.resolve(p).replace(/\\/g, "/");

(async () => {
    const browser = await chromium.launch();
    const problems = [];
    const summary = { report: reportPath, tabs: 0, images: 0 };

    // ---- テスト報告書 ----
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(fileUrl(reportPath));
    const tabIds = await page.$$eval('[role="tab"]', (ts) => ts.map((t) => t.getAttribute("aria-controls")));
    summary.tabs = tabIds.length;
    if (!tabIds.length) problems.push("タブが無い");
    for (const id of tabIds) {
        await page.click(`[role="tab"][aria-controls="${id}"]`);
        // $eval は Playwright の API（ページ内で DOM を読むだけ。JavaScript の eval ではない）
        const shown = await page.$eval(`[id="${id}"]`, (p) => !p.hidden).catch(() => false);
        if (!shown) { problems.push(`タブ ${id} が表示されない`); continue; }
        const imgs = await page.$$eval(`[id="${id}"] img`, async (is) => {
            is.forEach((i) => { i.loading = "eager"; }); // 遅延読み込みのままだと表示外の画像が読まれない
            // decode() は読み込みとデコードの完了を待つ。全体の上限は120秒（多数の画像を持つタブでも誤検出しない）
            await Promise.race([Promise.allSettled(is.map((i) => i.decode())), new Promise((r) => setTimeout(r, 120000))]);
            return is.map((i) => ({ src: i.getAttribute("src")?.slice(0, 120), ok: i.naturalWidth > 0 }));
        });
        summary.images += imgs.length;
        for (const i of imgs.filter((x) => !x.ok)) problems.push(`タブ ${id}：画像が読めない ${i.src}`);
        // 画面内リンクを1つ抜き取って、移った先が表示されるか
        const link = await page.$eval(`[id="${id}"]`, (p) => [...p.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href")).find((h) => h.length > 1 && !h.startsWith("#t-")) ?? null);
        if (link) {
            await page.goto(fileUrl(reportPath) + link);
            await page.waitForTimeout(200);
            const target = decodeURIComponent(link.slice(1));
            const vis = await page.evaluate((t) => { const e = document.getElementById(t); if (!e) return "なし"; let x = e; while (x) { if (x.hidden) return "非表示"; x = x.parentElement; } return "ok"; }, target);
            if (vis !== "ok") problems.push(`タブ ${id}：リンク ${link} の移動先が${vis}`);
            await page.goto(fileUrl(reportPath));
        }
    }
    if (errors.length) problems.push(...errors.slice(0, 10).map((e) => `コンソールのエラー：${e.slice(0, 200)}`));

    // スマホ幅
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(fileUrl(reportPath));
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) problems.push(`スマホ幅（390px）で横に ${overflow}px はみ出す`);

    // ダーク表示
    const dark = await browser.newPage({ colorScheme: "dark" });
    await dark.goto(fileUrl(reportPath));
    const same = await dark.evaluate(() => { const s = getComputedStyle(document.body); return s.color === s.backgroundColor; });
    if (same) problems.push("ダーク表示で本文の文字色と背景色が同じ");

    // ---- 不具合報告書 ----
    if (bugsPath) {
        const b = await browser.newPage();
        await b.goto(fileUrl(bugsPath));
        const imgs = await b.$$eval("img", async (is) => {
            is.forEach((i) => { i.loading = "eager"; }); // 遅延読み込みのままだと表示外の画像が読まれない
            // decode() は読み込みとデコードの完了を待つ。全体の上限は120秒（多数の画像を持つタブでも誤検出しない）
            await Promise.race([Promise.allSettled(is.map((i) => i.decode())), new Promise((r) => setTimeout(r, 120000))]);
            return is.map((i) => ({ src: i.getAttribute("src")?.slice(0, 120), ok: i.naturalWidth > 0 }));
        });
        summary.bugImages = imgs.length;
        for (const i of imgs.filter((x) => !x.ok)) problems.push(`不具合報告書：画像が読めない ${i.src}`);
        const links = await b.$$eval('a[href$=".html"], a[href*=".html#"]', (as) => as.map((a) => a.getAttribute("href")));
        for (const l of links) {
            if (/^[a-z]+:/i.test(l)) continue;
            const f = path.resolve(path.dirname(bugsPath), decodeURIComponent(l.split("#")[0]));
            if (!fs.existsSync(f)) problems.push(`不具合報告書：リンク先が無い ${l}`);
        }
    }

    await browser.close();
    console.log(JSON.stringify({ ...summary, ok: problems.length === 0, problems }, null, 2));
    process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
