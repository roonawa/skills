import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
import {loadConfig} from '../lib/config.mjs';
const dir=path.resolve('.selftest','customer-exam-'+Date.now()),run=path.join(dir,'runs','sample');fs.mkdirSync(run,{recursive:true});
const file=path.join(dir,'site.json');fs.writeFileSync(file,JSON.stringify({name:'顧客向け報告書サンプル（架空サイト・検証用）',baseURL:'https://example.test',environment:'local',outputDir:'runs',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:true}]}));
const {config,configHash}=loadConfig(file);fs.writeFileSync(path.join(run,'context.json'),JSON.stringify({config,configHash}));
const browser=await chromium.launch();let app;
try{
 const capture=await browser.newPage({viewport:{width:900,height:420}});
 await capture.setContent('<html lang="ja"><style>body{font:18px sans-serif;padding:40px;background:#f4f7f9;color:#203444}section{padding:25px;background:white}a{display:inline-block;padding:18px;outline:4px solid #c32626;background:#edf3ff;font-size:28px}small{color:#c32626}</style><h1>サンプルサイト・お問い合わせ</h1><section><p>お問い合わせはこちら</p><a href="#form" id="contact">✉</a><p><small>1：このリンクの読み上げ名がありません（検証用の架空例）</small></p></section></html>');
 await capture.screenshot({path:path.join(run,'marked-link.png')});await capture.close();
 fs.writeFileSync(path.join(run,'axe.json'),JSON.stringify({violations:[{id:'link-name',impact:'serious',nodes:[{target:['#contact'],failureSummary:'Link has no accessible name'}]}]}));
 fs.writeFileSync(path.join(run,'marked-screenshots.json'),JSON.stringify({shots:[{id:'marked-link',rule:'link-name',target:['#contact'],status:'captured'}]}));
 const report={runId:'sample',name:config.name,baseURL:config.baseURL,configHash,runStatus:'finished',finishedAt:'2026-10-29T00:00:00Z',rows:[{id:'snapshot.home',title:'お問い合わせリンクの読み上げ名',suite:'visual',status:'fail',evidence:['axe.json','marked-screenshots.json','marked-link.png']}],summary:{fail:1}};
 fs.writeFileSync(path.join(run,'results.json'),JSON.stringify(report));app=await startUI({port:0,configPaths:[file]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(app.url);const panel=page.locator('#site-exam');await panel.locator('.exam-issue>summary').click();
 await panel.locator('[data-field=certainty]').selectOption('confirmed');for(const [n,value] of ['3','4','2'].entries())await panel.locator(`[data-score-input="${n}"]`).selectOption(value);
 await panel.locator('[data-save]').click();await expect(panel.locator('[data-message]')).not.toContainText('保存しました');
 await panel.locator('[data-field=summary]').fill('お問い合わせのアイコンに、読み上げ用の説明がありません');
 await panel.locator('[data-field=impact]').fill('画面を読み上げて利用する方が、このリンクの目的を判断できない可能性があります。');
 await panel.locator('[data-field=action]').fill('WordPressの該当ページまたはメニューの編集で、「お問い合わせ」など目的の分かるリンク文字を設定してください。テーマ側で描画している場合は、担当者がテンプレートを修正します。');
 const reasons=['読み上げ名の不足により、対象利用者がお問い合わせへの導線を判別できないため。','認証せず通常の閲覧とキーボード操作で問題を再現できる条件であるため。','今回の確認範囲はお問い合わせへの単一の主要導線で、他ページへの波及は未確認のため。'];
 for(let n=0;n<3;n++){await panel.locator(`[data-reason="${n}"]`).fill(reasons[n]);await panel.locator(`[data-proof-file="${n}"]`).selectOption('axe.json');await panel.locator(`[data-observation="${n}"]`).fill('保存した検査結果では、お問い合わせアイコンのリンクに読み上げ名がないことが検出されています。');}
 await panel.locator('[data-field=steps]').fill('サンプルページを開きます。\nTabキーで封筒のアイコンに移動し、リンクの読み上げ名を確認します。');
 await panel.locator('[data-field=expected]').fill('リンクを選択したときに「お問い合わせ」と目的が読み上げられる。');
 await panel.locator('[data-field=observed]').fill('リンクの目的を表す読み上げ名がなく、用途を判別できない状態になっている。');
 await panel.locator('[data-field=reproductionVerified]').check();
 await panel.getByText('顧客に掲載する問題箇所の画像',{exact:true}).click();await panel.locator('[data-image-file]').check();await panel.locator('[data-field=imagesReviewed]').check();await panel.locator('[data-field=reviewed]').check();
 await panel.locator('[data-save]').click();await expect(panel.locator('[data-message]')).toContainText('保存しました');
 await panel.locator('[data-preview]').click();const frame=panel.frameLocator('iframe');await expect(frame.locator('main')).toContainText('記載した課題の評価は確定済み');await expect(frame.locator('img')).toHaveCount(1);assert(await frame.locator('img').evaluate(img=>img.complete&&img.naturalWidth===900));
 const boot=await(await page.request.get(app.url+'/api/bootstrap')).json(),project=boot.projects.find(p=>p.name===config.name);const endpoint=app.url+`/api/projects/${project.id}/runs/sample`;
 const response=await page.request.get(endpoint+'/customer-report');assert(response.headers()['content-security-policy'].includes('img-src data:'));const html=await response.text();fs.writeFileSync(path.join(dir,'customer-report-sample.html'),html);
 const standalone=await browser.newPage();await standalone.setContent(html);await standalone.screenshot({path:path.join(dir,'customer-report.png'),fullPage:true});await standalone.setViewportSize({width:390,height:844});assert(await standalone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 fs.appendFileSync(path.join(run,'axe.json'),' ');await panel.locator('[data-reload]').click();await expect(panel.locator('[data-message]')).toContainText('採点基準が更新');await expect(panel.locator('[data-summary]')).toContainText('採点保留');
 console.log('PASS customer image embed/CSP, proof-backed confirmation, observed/expected/repro, mobile, evidence invalidation. '+dir);
}finally{await browser.close();await app?.close();}
