// Run from any directory: node test/first-screen-browser.mjs
// 検証環境・フォームあり・通販プラグインなしのテスト用サイトで、結果画面のB案（件数→次にやること→分かったこと→未確認）を確かめる。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
import {ProjectStore} from '../ui/project-store.mjs';
import {registrationConfig} from '../ui/registration.mjs';
import {catalog} from '../lib/config.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
fs.mkdirSync(path.join(root,'.selftest'),{recursive:true});
const scratch=fs.mkdtempSync(path.join(root,'.selftest','first-screen-'));
const page404=new Set(['/about/']);
const site=createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');res.setHeader('Content-Type','text/html; charset=utf-8');
  if(page404.has(url.pathname)){res.statusCode=404;res.end('<html lang="ja"><head><title>見つかりません</title></head><body>none</body></html>');return;}
  const form=url.pathname==='/contact/'?'<form class="wpcf7-form"><input name="your-name"><input type="email" name="your-email"><textarea name="your-message"></textarea><button type="submit">送信</button></form>':'';
  res.end(`<!doctype html><html lang="ja"><head><title>テスト ${url.pathname}</title><meta name="robots" content="noindex"></head><body><main><h1>テスト</h1><a href="/">トップ</a>${form}</main></body></html>`);
});
await new Promise(r=>site.listen(0,'127.0.0.1',r));
const baseURL=`http://127.0.0.1:${site.address().port}`;
const profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false,contactPath:'/contact/',contactFormId:1,contactNameField:'your-name',contactEmailField:'your-email',contactMessageField:'your-message',automation:{pluginInventory:{observed:true,slugs:['contact-form-7']}}};
const store=new ProjectStore(path.join(scratch,'projects'),{codec:v=>v});
// 管理画面の照合は HTTPS が必要なため、ループバックのテスト用サイトでは外す。
const config={...registrationConfig({name:'初回画面テスト',baseURL,environment:'staging',profile,discovery:{pages:[{path:'/'},{path:'/about/'},{path:'/contact/'}],warnings:[]}}),baseURL,admin:[]};
const id=store.save({config,profile});
const app=await startUI({port:0,storeDir:path.join(scratch,'projects'),credentialCodec:v=>v,publicDiscovery:async()=>({public:{},admin:{}})});
const boot=await(await fetch(app.url+'/api/bootstrap')).json();
const call=async(route,body)=>{const r=await fetch(`${app.url}/api/projects/${id}${route}`,body?{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw new Error(route+' '+r.status+' '+JSON.stringify(data));return data;};
const idle=async()=>{for(let i=0;i<600;i++){const d=await call('');if(!d.busy)return d;await new Promise(r=>setTimeout(r,500));}throw new Error('run did not finish');};
const latest=async()=>{const d=await idle();return (await call('/runs/'+encodeURIComponent(d.runs[0].runId))).report;};
const forbidden=['browser-flow','waitForMail','adminに登録','信頼済みアダプター','additionalChecks'];
let browser;
try{
  // 最初の実行：ページと表示速度の参考測定だけ（1件は404で不合格になる）。
  const rows=catalog(store.context(id).config);
  await call('/runs',{suite:'all',ids:[...rows.filter(r=>r.id.startsWith('page.')).map(r=>r.id),'check.auto-performance']});
  const first=await latest();assert.ok(first.rows.some(r=>r.status==='fail'),'fixture must produce a failure');assert.ok(first.rows.some(r=>r.status==='pass'));
  browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.url);
  const todo=page.locator('#todo-panel');
  await expect(todo.locator('[data-todo]')).toHaveCount(3);
  await expect(page.locator('#todo-summary')).toHaveText('あと3つ設定すると、さらに5件を検査できます');
  await expect(page.locator('#metric-todo')).toHaveText('3');
  await expect(page.locator('#metric-fail')).not.toHaveText('—');
  await expect(page.locator('#metric-sub')).toContainText('実行不能');await expect(page.locator('#metric-sub')).toContainText('未確認');
  // 上から件数カード → 次にやること → 分かったこと → 未確認 → 既存の一覧。
  const tops=[];for(const s of ['.metrics','#todo-panel','#findings','#unconfirmed','.workspace-grid'])tops.push((await page.locator(s).boundingBox()).y);
  assert.deepEqual([...tops].sort((a,b)=>a-b),tops,'section order: '+tops.join(','));
  await page.locator('.metrics').evaluate(e=>e.scrollIntoView());await page.screenshot({path:path.join(scratch,'first-screen-desktop.png')});
  // 各項目の説明（仕様書4章）。
  await expect(todo.locator('[data-todo="writes"]')).toContainText('「QA」で始まるテスト投稿');
  await expect(todo.locator('[data-todo="submit"]')).toContainText('通知先にもメールが届きます');
  await expect(todo.locator('[data-todo="performance"]')).toContainText(/今回の実測は \d+(\.\d+)? 秒でした/);
  await expect(todo.locator('[data-todo="performance"]')).toContainText('顧客と合意した値');
  // 分かったこと：不合格の理由をまとめて出し、合格は折りたたむ。
  await expect(page.locator('#findings')).toContainText('不合格');
  await expect(page.locator('#findings details.findings-pass')).not.toHaveAttribute('open','');
  // 重要の点滅は次にやることの項目だけ。
  const blinking=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>getComputedStyle(e).animationName.includes('preparation-priority')).map(e=>!!e.closest('#todo-panel')));
  assert.deepEqual(blinking,[true,true,true],'only todo items blink');
  // 自動の対象外の行には「自動判定」が出る（既存の一覧）。
  await page.locator('[data-group="check.coverage-order"]').click();
  await expect(page.locator('tr.group-child',{has:page.locator('[data-row="check.coverage-order"]')}).locator('.pill')).toHaveText('対象外・自動判定');
  // 未確認：3区分の見出し、通販4件と会員、根拠と「関係ありに戻す」。
  const unconfirmed=page.locator('#unconfirmed');
  await expect(unconfirmed).not.toHaveAttribute('open','');
  await unconfirmed.locator('summary').click();
  for(const heading of ['ツールが取得できなかったもの','技術担当の準備が要るもの','このサイトに関係しないもの'])await expect(unconfirmed.locator('h3',{hasText:heading})).toHaveCount(1);
  const notRelevant=unconfirmed.locator('[data-bucket="notRelevant"]');
  for(const check of ['coverage-order','coverage-order-record','coverage-order-cleanup','coverage-order-notification','coverage-membership'])await expect(notRelevant.locator(`[data-check="${check}"]`)).toHaveCount(1);
  await expect(notRelevant).toContainText('有効なプラグインに通販機能が見つからないため');
  await expect(notRelevant.getByRole('button',{name:'関係ありに戻す'})).toHaveCount(5);
  const text=await page.locator('body').innerText();for(const word of forbidden)assert.ok(!text.includes(word),'forbidden word on screen: '+word);
  // フォーム送信は投稿の許可と正しいメールアドレスがそろうまで保存できない（投稿の許可は勝手に入れない）。
  const submit=todo.locator('[data-todo="submit"]'),hint=page.locator('#todo-hint'),saveOnly=page.getByRole('button',{name:'保存だけする'});
  await expect(submit).toContainText('「テスト投稿の作成・公開・削除」の許可も必要です');
  await submit.locator('input[type=checkbox]').check();
  await expect(hint).toHaveText('フォームの送信を許可するには、テスト用メールアドレスを入れてください。');await expect(saveOnly).toBeDisabled();
  await submit.locator('input[type=email]').fill('qa-test');
  await expect(hint).toContainText('テスト用メールアドレスの形を確かめてください');await expect(saveOnly).toBeDisabled();
  await submit.locator('input[type=email]').fill('qa-test@example.test');
  await expect(hint).toContainText('「テスト投稿の作成・公開・削除を許可する」にもチェックを入れてください');await expect(saveOnly).toBeDisabled();
  await expect(page.getByRole('button',{name:/保存して、増えた\d+件だけ実行/})).toBeDisabled();
  await expect(todo.locator('[data-todo="writes"] input[type=checkbox]')).not.toBeChecked();
  await submit.locator('input[type=checkbox]').uncheck();await submit.locator('input[type=email]').fill('');
  await expect(hint).toBeHidden();await expect(saveOnly).toBeEnabled();
  // 投稿の許可だけを入れて保存・実行すると、投稿関連の3件だけが選ばれる。
  await todo.locator('[data-todo="writes"] input[type=checkbox]').check();
  const saveRun=page.getByRole('button',{name:'保存して、増えた3件だけ実行'});
  await saveRun.click();
  await expect(todo.locator('input').first()).toBeDisabled();
  await page.getByText(/^(実行が完了しました|結果のダウンロードを開始しました.*)$/).first().waitFor({timeout:180000});
  const second=await latest();
  assert.deepEqual(second.rows.filter(r=>r.selected).map(r=>r.id).sort(),['check.coverage-cache','journey.profile-post-lifecycle','journey.profile-scheduled']);
  assert.equal(store.record(id).profile.writes,true);
  await expect(todo.locator('[data-todo]')).toHaveCount(2);
  await expect(page.locator('#todo-summary')).toHaveText('あと2つ設定すると、さらに2件を検査できます');
  await expect(todo.locator('input').first()).toBeEnabled();
  // 「関係ありに戻す」で会員が技術担当の準備へ移る。
  if(await unconfirmed.getAttribute('open')===null)await unconfirmed.locator('summary').click();
  await notRelevant.locator('[data-check="coverage-membership"]').getByRole('button',{name:'関係ありに戻す'}).click();
  await expect(unconfirmed.locator('[data-bucket="technical"] [data-check="coverage-membership"]')).toHaveCount(1);
  await expect(notRelevant.locator('[data-check="coverage-membership"]')).toHaveCount(0);
  assert.deepEqual(store.record(id).profile.automation.relevantOverrides,['coverage-membership']);
  // 表示上限を保存して実行すると、合否を判定する検査が作られて実行される。
  await todo.locator('[data-todo="performance"] input').fill('3');
  await page.getByRole('button',{name:'保存して、増えた1件だけ実行'}).click();
  await expect(todo.locator('input').first()).toBeDisabled();
  await expect(todo.locator('[data-todo="performance"]')).toHaveCount(0,{timeout:180000});
  const third=await latest();
  assert.deepEqual(third.rows.filter(r=>r.selected).map(r=>r.id),['check.registration-performance']);
  assert.equal(third.rows.find(r=>r.id==='check.registration-performance').status,'pass');
  assert.equal(store.record(id).config.checks.find(c=>c.id==='registration-performance').options.budgets.durationMs,3000);
  await expect(todo.locator('input').first()).toBeEnabled();
  // 別の画面で保存したあとに保存すると、再読み込みを促し、入力は残す。
  await submit.locator('input[type=email]').fill('qa-other@example.test');
  const other=await call('/settings');await call('/settings',{version:other.version,config:other.config,profile:{...other.profile,language:'ja'}});
  const before=store.record(id).version;
  await saveOnly.click();
  await expect(page.getByText('別の画面で設定が更新されました。再読み込みしてください')).toBeVisible();
  await expect(submit.locator('input[type=email]')).toHaveValue('qa-other@example.test');
  assert.equal(store.record(id).version,before);
  const after=await page.locator('body').innerText();for(const word of forbidden)assert.ok(!after.includes(word),'forbidden word on screen: '+word);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow on mobile');
  await page.screenshot({path:path.join(scratch,'first-screen-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(`First screen browser acceptance passed: ${scratch}`);
}finally{await browser?.close();await app.close();await new Promise(r=>site.close(r));}
