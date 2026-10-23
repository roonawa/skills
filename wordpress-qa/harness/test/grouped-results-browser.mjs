import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';

// Local fixtures only: no requests or test writes to a production site.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const rows=Array.from({length:951},(_,i)=>({id:`page.a-${8233+i}`,title:`/archives/${8233+i}: HTTP / metadata`,suite:'audit',status:i===1?'fail':i===2?'not_run':'pass',required:true,selected:true,evidence:i===1?['audit.json']:[],reason:i===1?'canonical differs from expectation':'',durationMs:100}));
rows.push({id:'policy.hidden-env',title:'/.env',suite:'audit',status:'pass'},
  {id:'policy.hidden-git-head',title:'/.git/HEAD',suite:'audit',status:'blocked'},
  {id:'snapshot.home-mobile',title:'Home mobile',suite:'visual',status:'review'},
  {id:'manual.design',title:'デザイン判断',suite:'manual',status:'review'});
const report={runId:'fixture',rows,summary:{pass:949,fail:1,not_run:1,blocked:1,review:2},runStatus:'finished'};
const project={id:'fixture',name:'分類表示テスト',counts:{pages:951},planned:rows.length,environment:'local'};
const server=createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url.startsWith('/api/')){
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/bootstrap')return res.end(JSON.stringify({projects:[project],token:'fixture'}));
    if(req.url==='/api/projects/fixture')return res.end(JSON.stringify({project,runs:[{runId:'fixture',summary:report.summary}]}));
    if(req.url==='/api/projects/fixture/runs/fixture')return res.end(JSON.stringify({report,candidates:[],canApprove:false}));
    return res.end('{}');
  }
  const name=req.url==='/'?'index.html':req.url.slice(1);
  if(!/^[a-z-]+\.(js|css|html)$/.test(name)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
  res.end(fs.readFileSync(path.join(root,'ui/public',name)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.locator('[data-group]')).toHaveCount(4);
  await expect(page.locator('[data-row]')).toHaveCount(0);
  const group=page.locator('[data-group="page"]');
  await expect(group).toContainText('951');
  await expect(group).toContainText('不合格 1');
  await expect(group).toContainText('未実施 1');
  await group.click();
  await expect(page.locator('[data-row]')).toHaveCount(951);
  await page.locator('[data-row="page.a-8234"]').click();
  await expect(page.locator('#detail')).toContainText('canonical differs');
  await expect(page.locator('#detail a.evidence-link')).toHaveAttribute('href',/audit.json/);
  await page.locator('#search').fill('/archives/8233');
  await expect(page.locator('[data-row]')).toHaveCount(1);
  await expect(group).toContainText('絞り込み一致 1件');
  // Full-group status must still expose the failure hidden by URL search.
  await expect(page.locator('.group-heading .pill')).toHaveText('不合格');
  await page.locator('#search').fill('');
  await page.locator('[data-filter="attention"]').click();
  await expect(page.locator('[data-row]')).toHaveCount(1);
  await expect(page.locator('[data-group]')).toHaveCount(4);
  await group.click();
  await expect(page.locator('[data-row]')).toHaveCount(0);
  await group.focus();await page.keyboard.press('Enter');
  await expect(group).toHaveAttribute('aria-expanded','true');
  await page.locator('[data-filter="all"]').click();
  await page.locator('#search').fill('画像比較');
  await expect(page.locator('[data-group]')).toHaveCount(1);
  await page.locator('[data-group="snapshot"]').click();
  await expect(page.locator('[data-row="snapshot.home-mobile"]')).toBeVisible();
  await page.locator('#search').fill('no-match-test');
  await expect(page.locator('#empty-state')).toBeVisible();
  await page.locator('#search').fill('');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);
  console.log('PASS: collapsed groups, mixed status counts, URL detail/evidence, filters/search, keyboard toggle, mobile width');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
