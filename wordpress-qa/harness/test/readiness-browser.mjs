import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';

// Exercise the real UI with local API fixtures; never contact a live site.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const rows=Array.from({length:25},(_,i)=>({id:`coverage.pending-${i}`,title:`未定義の検査 ${i}`,suite:'audit',kind:'unconfigured',status:'not_run',selected:false,required:true,preparationRequired:true,reason:'期待値が未定義です',instructions:'設定画面で検査条件を登録してください。',evidence:[]}));
rows.push({id:'page.unselected',title:'未選択のページ',suite:'audit',status:'not_run',selected:false,required:true},
  {id:'page.ready',title:'検査済みページ',suite:'audit',status:'pass',selected:true,required:true},
  {id:'admin.auth',title:'管理認証',suite:'admin',status:'blocked',selected:true,required:true});
const report={runId:'fixture',rows,summary:{pass:1,fail:0,blocked:1,review:0,not_run:26},runStatus:'finished',gatePassed:false};
const project={id:'fixture',name:'Monalumina fixture',counts:{pages:2},planned:28,environment:'local'};
let issues=[],writes=[];
const server=createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url.startsWith('/api/')){
    res.setHeader('Content-Type','application/json');
    if(req.method!=='GET'){writes.push(req.url);res.statusCode=405;return res.end('{}');}
    if(req.url==='/api/bootstrap')return res.end(JSON.stringify({projects:[project],token:'fixture'}));
    if(req.url==='/api/projects/fixture')return res.end(JSON.stringify({project,runs:[{runId:'fixture',summary:report.summary}]}));
    if(req.url==='/api/projects/fixture/runs/fixture')return res.end(JSON.stringify({report,candidates:[],canApprove:true}));
    if(req.url.endsWith('/preflight'))return res.end(JSON.stringify({ready:!issues.length,issues,preparations:rows.slice(0,25).map(r=>({id:r.id,message:r.reason})),scope:'設定上の確認のみ'}));
    if(req.url.endsWith('/settings'))return res.end(JSON.stringify({config:{name:project.name,baseURL:'https://example.test',environment:'local',pages:[],admin:[]},managed:true}));
    return res.end('{}');
  }
  const name=req.url==='/'?'index.html':req.url.slice(1);
  if(!/^[a-z-]+\.(js|css|html)$/.test(name)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
  res.end(fs.readFileSync(path.join(root,'ui/public',name)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.locator('#metric-preparation')).toHaveText('25');
  await expect(page.locator('#metric-not_run')).toHaveText('1');
  await expect(page.locator('#metric-blocked')).toHaveText('1');
  await expect(page.locator('#run-badge')).not.toHaveText('必須条件充足');
  await expect(page.locator('#progress-label')).toHaveText('2 / 2 項目');
  await page.locator('[data-filter="preparation"]').click();
  await expect(page.locator('[data-group]')).toHaveCount(25);
  await expect(page.locator('.group-heading .pill').first()).toHaveText('準備待ち');
  await page.locator('[data-group="coverage.pending-0"]').click();
  await page.locator('[data-row="coverage.pending-0"]').click();
  await expect(page.locator('#detail')).toContainText('期待値が未定義です');
  await expect(page.locator('#detail')).toContainText('検査条件を登録');
  await expect(page.locator('#detail')).toContainText('必須条件');
  await expect(page.locator('#execute-case,#manual-review,#start-confirmation')).toHaveCount(0);
  await page.locator('#detail [data-open-settings]').click();
  await expect(page.locator('.settings-dialog').filter({has:page.locator('#site-editor')})).toBeVisible();
  await page.locator('#editor-close').click();
  await page.locator('[data-filter="not_run"]').click();
  await expect(page.locator('[data-group]')).toHaveCount(1);
  await page.locator('[data-group="page"]').click();
  await expect(page.locator('[data-row]')).toHaveCount(1);
  await page.locator('[data-row="page.unselected"]').click();
  await expect(page.locator('#execute-case')).toBeVisible();
  await page.locator('[data-filter="attention"]').click();
  await expect(page.locator('[data-group]')).toHaveCount(26);
  await page.locator('#preflight-button').click();
  await expect(page.locator('#preflight-result')).toContainText('準備待ち 25件');
  await expect(page.locator('#preflight-result')).toContainText('必須条件');
  await expect(page.locator('#preflight-result [data-open-settings]')).toBeVisible();
  await page.locator('#preflight-result [data-open-settings]').click();
  await expect(page.locator('#site-editor')).toBeVisible();
  await page.locator('#editor-close').click();
  issues=[{id:'auth',message:'認証情報が不足しています'}];
  await page.locator('#preflight-button').click();
  await expect(page.locator('#preflight-result')).toContainText('認証情報が不足しています');
  await expect(page.locator('#preflight-result')).toContainText('準備待ち 25件');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  report.runStatus='planned';
  await page.reload();
  await expect(page.locator('#metric-preparation')).toHaveText('25');
  await expect(page.locator('#run-subtitle')).toContainText('準備待ち 25件は実行対象外');
  await page.locator('[data-filter="preparation"]').click();
  await expect(page.locator('[data-group]')).toHaveCount(25);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  console.log('PASS: preparation counts/filter/detail/settings, ordinary unselected rerun, release pending, preflight issues separated, mobile, no writes');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
