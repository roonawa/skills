import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {chromium,expect} from '@playwright/test';
import {countResults} from '../ui/public/result-summary.js';
import {groupRows} from '../lib/editor-report/causes.mjs';

const findings=Array.from({length:8},(_,i)=>({key:`baseline:version:${i===0?'/':i===1?'/feed/':'/page-'+i}`,title:'WordPress の版番号が外部から分かる',actual:'版番号を確認',admin:'設定を確認'}));
const rows=[{id:'check.a',title:'情報公開の確認',status:'fail',level:'caution',selected:true,failures:findings.slice(0,4)},
 {id:'check.b',title:'ヘッダーの確認',status:'fail',level:'caution',selected:true,failures:findings.slice(4)},
 {id:'manual.a',status:'review',preparationRequired:true},{id:'manual.b',status:'review'},
 {id:'check.c',status:'blocked'},{id:'check.d',status:'not_run'}];
const report={runId:'full',rows,summary:{fail:2,caution:2,review:2,blocked:1,not_run:1},runStatus:'finished'};
const project={id:'fixture',name:'結果集計テスト',counts:{pages:1},planned:rows.length};
const server=createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.url.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/bootstrap')return res.end(JSON.stringify({projects:[project],token:'fixture'}));
  if(req.url==='/api/projects/fixture')return res.end(JSON.stringify({project,runs:[{runId:'full',summary:report.summary}]}));
  if(req.url==='/api/projects/fixture/runs/full')return res.end(JSON.stringify({report,canApprove:false}));
  return res.end('{}');
 }
 const name=req.url==='/'?'index.html':req.url.slice(1);
 if(!/^[a-z-]+\.(js|css|html)$/.test(name)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
 res.end(fs.readFileSync(new URL('../ui/public/'+name,import.meta.url)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await expect(page.locator('#metric-caution')).toHaveText('2');
 await expect(page.locator('.findings-caution h3')).toHaveText('注意の検査 2項目 ／ 表示中の指摘 8件');
 const count=countResults(rows).unverified;assert.equal(groupRows(report).counts.unverified,count);
 await expect(page.locator('#metric-unconfirmed')).toHaveText(String(count));
 await expect(page.locator('#metric-review')).toHaveText('1');
 const details=page.locator('.findings-caution>details').first();await details.locator('summary').click();
 await expect(page.locator('.findings-caution>details').nth(1).locator('summary')).toContainText('/feed/');
 await details.locator('[data-row]').click();
 await expect(details).toHaveAttribute('open','');
 await expect(page.locator('#detail')).toContainText('期待と実際');
 await expect(page.locator('#findings')).toBeVisible();
 const list=await page.locator('#findings').boundingBox(),detail=await page.locator('.detail-panel').boundingBox();
 assert(detail.x>=list.x+list.width,'detail must be beside findings');
 await page.locator('#back-to-findings').click();await expect(details.locator('[data-row]')).toBeFocused();
 fs.mkdirSync('.selftest/feedback-phase2',{recursive:true});await page.screenshot({path:path.resolve('.selftest/feedback-phase2/desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await details.locator('[data-row]').click();await expect(page.locator('#detail')).toBeFocused();
 await page.locator('#back-to-findings').click();await expect(details.locator('[data-row]')).toBeFocused();
 assert.deepEqual(errors,[]);
 console.log('PASS: row/finding counts, report parity, page labels, retained list/detail, mobile return');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
