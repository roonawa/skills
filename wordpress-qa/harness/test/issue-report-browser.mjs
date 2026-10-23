import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
import {loadConfig} from '../lib/config.mjs';
const scratch=path.resolve('.selftest',`issue-report-${Date.now()}`);
fs.mkdirSync(scratch,{recursive:true});
const config={name:'報告書UIテスト',baseURL:'https://example.test',environment:'production',outputDir:'runs',pages:[{id:'home',path:'/',indexable:true,canonical:'https://example.test/'}],policies:[],journeys:[],visuals:[],manual:[]};
const file=path.join(scratch,'site.json');fs.writeFileSync(file,JSON.stringify(config));
const {configHash}=loadConfig(file);
const rows=[{id:'javascript.home-pc',title:'home: 1280px JavaScript errors',suite:'visual',status:'fail',evidence:['javascript.json','reference.png']},{id:'policy.missing',title:'/missing',suite:'audit',status:'not_run'}];
for(const [id,date,items] of [['older','2026-01-01', [{id:'policy.missing',title:'/missing',suite:'audit',status:'fail',reason:'302 != 404',evidence:['policy.json']}]],['latest','2026-02-01',rows]]){
  const dir=path.join(scratch,'runs',id);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({runId:id,name:config.name,baseURL:config.baseURL,environment:'production',configHash,startedAt:date,finishedAt:date,runStatus:'finished',rows:items,summary:{fail:1}}));
  fs.writeFileSync(path.join(dir,'javascript.json'),JSON.stringify({jsErrors:[{message:'jQuery is not defined',stack:'https://example.test/:12'}]}));
  fs.writeFileSync(path.join(dir,'policy.json'),JSON.stringify({path:'/missing',status:302,errors:['302 != 404']}));
  fs.writeFileSync(path.join(dir,'reference.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
}
const app=await startUI({configPaths:[file],port:0});
const browser=await chromium.launch();const page=await browser.newPage();
try{
  await page.goto(app.url);await expect(page.locator('#metadata')).toContainText('latest');
  await page.locator('#issue-report-panel summary').click();
  await page.locator('#issue-report-notes').fill('担当者確認：購入操作は未実施');
  await page.getByRole('button',{name:'報告書を生成',exact:true}).click();
  await expect(page.locator('#issue-report-status')).toContainText('不合格2ケース');
  const href=await page.locator('#issue-report-open').getAttribute('href');
  const response=await page.request.get(app.url+href);assert.equal(response.status(),200);
  assert.match(response.headers()['content-security-policy'],/sandbox/);
  const html=await response.text();assert.match(html,/【過去結果】/);assert.match(html,/担当者確認/);assert.match(html,/302/);assert.match(html,/再現手順・期待結果・実際の挙動/);assert.match(html,/Console/);
  const popupPromise=page.waitForEvent('popup');await page.locator('#issue-report-open').click();
  const popup=await popupPromise;await expect(popup.locator('h1')).toContainText('不具合報告書');
  await popup.locator('details').filter({has:popup.locator('img')}).first().locator('summary').first().click();
  await popup.locator('details').filter({has:popup.locator('img')}).first().getByText('問題箇所のスクリーンショット',{exact:true}).click();
  await expect(popup.locator('img')).toBeVisible();
  await expect.poll(()=>popup.locator('img').evaluate(img=>img.naturalWidth)).toBe(1);
  await popup.close();
  await page.locator('#issue-report-history').uncheck();await page.getByRole('button',{name:'報告書を生成',exact:true}).click();
  await expect(page.locator('#issue-report-status')).toContainText('不合格1ケース');
  await page.setViewportSize({width:390,height:844});
  assert(await page.locator('#issue-report-generate').isVisible());
  assert(await page.locator('#issue-report-panel').evaluate(el=>el.getBoundingClientRect().width>250),'report panel must not be squeezed inside the heading');
  await page.screenshot({path:path.join(scratch,'mobile.png'),fullPage:true});
  await page.locator('[data-run="older"]').click();await expect(page.locator('#metadata')).toContainText('older');
  await expect(page.locator('#issue-report-open')).toBeHidden();await expect(page.locator('#issue-report-notes')).toHaveValue('');
  const denied=await page.request.post(app.url+'/api/projects/invalid/runs/latest/issue-report',{data:{includeHistory:true}});assert.equal(denied.status(),403);
  console.log('Report UI, generation, history provenance, opening, mobile and auth checks passed');
}finally{await browser.close();await app.close();}
