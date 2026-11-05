// Run from any directory: node test/editor-report-browser.mjs
// 結果画面の「編集者向け報告書を作成」パネル：AI 未設定では理由つきで無効、設定後は必要回数・残り回数・段階・完成後のリンクを出す。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
import {ProjectStore} from '../ui/project-store.mjs';
import {registrationConfig} from '../ui/registration.mjs';
import {SystemSettings} from '../ui/system-settings.mjs';
import {createSecretCodec} from '../ui/secret-codec.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
fs.mkdirSync(path.join(root,'.selftest'),{recursive:true});
const scratch=fs.mkdtempSync(path.join(root,'.selftest','editor-report-'));
const BASE='https://example.test',wait=ms=>new Promise(r=>setTimeout(r,ms));
const codec=createSecretCodec(randomBytes(32)),store=new ProjectStore(path.join(scratch,'projects'),{codec});
const profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false};
const config=registrationConfig({name:'編集者報告書UI',baseURL:BASE,environment:'staging',profile,discovery:{pages:[{path:'/'}],warnings:[]}});
const id=store.save({config,profile}),ctx=store.context(id),run=path.join(ctx.outputDir,'run-1');
fs.mkdirSync(run,{recursive:true});
const rows=[
  {id:'check.auto-security-headers',title:'セキュリティ用の設定',suite:'audit',status:'fail',level:'caution',reason:'missing-hsts'},
  {id:'check.mystery',title:'その他',suite:'audit',status:'fail',reason:'something odd'},
  {id:'sitemap.main',title:'サイトマップ',suite:'audit',status:'fail',reason:'malformed sitemap XML'},
  {id:'check.ok',title:'合格',suite:'audit',status:'pass'},
];
fs.writeFileSync(path.join(run,'results.json'),JSON.stringify({runId:'run-1',name:config.name,baseURL:BASE,environment:'staging',configHash:ctx.configHash,startedAt:'2026-11-05T00:00:00Z',finishedAt:'2026-11-05T00:10:00Z',runStatus:'finished',rows,summary:{fail:3,caution:1,pass:1}}));
const sitemap='<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/</loc></url></urlset>';
// 段階が画面で見えるよう、再確認と Claude の応答を少し遅らせる。
const client={get:async url=>{await wait(2000);return url===`${BASE}/sitemap.xml`?{status:200,location:null,headers:{},text:sitemap}:{status:200,location:null,headers:{},text:'<html><body>x</body></html>'};},head:async()=>({status:200})};
const item=i=>({index:i,title:`${i+1}番目の対応`,summary:`${i+1}番目の項目の状況をまとめました。`,impact:`${i+1}番目の項目を放置すると困ることがあります。`,steps:[`${i+1}番目の手順を行います`],location:`${i+1}番目の画面`,urgency:'normal',note:''});
let aiCalls=0;
const fetcher=async(_url,opts)=>{aiCalls++;await wait(2000);const input=JSON.parse(JSON.parse(opts.body).messages[0].content);return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items:input.map(x=>item(x.index))})}]}));};
const app=await startUI({port:0,storeDir:path.join(scratch,'projects'),credentialCodec:codec,publicDiscovery:async()=>({public:{},admin:{}}),aiOptions:{fetcher},editorRecheckClient:client});
let browser;
try{
  browser=await chromium.launch();const page=await browser.newPage();
  // AI 未設定：ボタンは無効で、理由が出る。
  await page.goto(app.url);await expect(page.locator('#metadata')).toContainText('run-1');
  await page.locator('#editor-report-panel summary').click();
  await expect(page.locator('#editor-report-status')).toHaveText('AIの利用設定（有効化・承認・取得情報の送信許可）を確認してください');
  await expect(page.locator('#editor-report-generate')).toBeDisabled();
  await expect(page.locator('#editor-report-open')).toBeHidden();

  // AI を設定すると、必要回数と残り回数が出て作成できる。
  new SystemSettings({directory:path.join(scratch,'projects','system'),codec}).save({apiKey:'sk-ant-fixture-only',enabled:true,approved:true,evidenceApproved:true,dailyLimit:5});
  await page.reload();await expect(page.locator('#metadata')).toContainText('run-1');
  await page.locator('#editor-report-panel summary').click();
  await expect(page.locator('#editor-report-calls')).toHaveText('必要なAIの回数：最大2回（本日の残り5回）');
  await expect(page.locator('#editor-report-generate')).toBeEnabled();
  await page.locator('#editor-report-generate').click();
  await expect(page.locator('#editor-report-status')).toContainText('公開ページを再確認しています',{timeout:5000});
  await expect(page.locator('#editor-report-status')).toContainText('Claudeが文章を書いています',{timeout:8000});
  await expect(page.locator('#editor-report-status')).toContainText('作成しました',{timeout:15000});
  await expect(page.locator('#editor-report-open')).toBeVisible();await expect(page.locator('#editor-report-basis')).toBeVisible();
  await expect(page.locator('#editor-report-calls')).toHaveText('必要なAIの回数：最大2回（本日の残り4回）');
  assert.equal(aiCalls,1);
  for(const link of ['#editor-report-open','#editor-report-basis']){
    const response=await page.request.get(app.url+await page.locator(link).getAttribute('href'));
    assert.equal(response.status(),200);assert.match(response.headers()['content-security-policy'],/sandbox/);assert.doesNotMatch(await response.text(),/<script/i);
  }
  const popupPromise=page.waitForEvent('popup');await page.locator('#editor-report-open').click();
  const popup=await popupPromise;await expect(popup.locator('body')).toContainText('編集者');await popup.close();
  await page.setViewportSize({width:390,height:844});
  assert(await page.locator('#editor-report-panel').evaluate(el=>el.getBoundingClientRect().width>250),'editor report panel must not be squeezed');
  await page.screenshot({path:path.join(scratch,'mobile.png'),fullPage:true});
  console.log('Editor report panel: disabled reason, calls, stages, links and file serving checks passed');
}finally{await browser?.close();await app.close();fs.rmSync(scratch,{recursive:true,force:true});}
