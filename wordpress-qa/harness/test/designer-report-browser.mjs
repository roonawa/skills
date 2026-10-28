import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
import {loadConfig} from '../lib/config.mjs';
const scratch=path.resolve('.selftest',`designer-report-${Date.now()}`);fs.mkdirSync(scratch,{recursive:true});
const config={name:'デザイナー報告書テスト',baseURL:'https://example.test',environment:'staging',outputDir:'runs',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:false}],visuals:[{id:'home-pc',pageId:'home',width:1280,height:900,ready:'body'}],journeys:[]};
const configFile=path.join(scratch,'site.json');fs.writeFileSync(configFile,JSON.stringify(config));const {configHash}=loadConfig(configFile);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const runs={older:[{id:'policy.missing',suite:'audit',status:'fail',title:'/missing',reason:'HTTP 302 != 404',evidence:['policy.json']}],latest:[{id:'axe.home-pc',suite:'visual',status:'fail',title:'Home 1280px accessibility',evidence:['axe.json','marked-screenshots.json','marked-001.png']},{id:'snapshot.home-pc',suite:'visual',status:'review',title:'画像基準待ち',reason:'基準未承認'},{id:'layout.home-pc',suite:'visual',status:'pass',title:'Layout'},{id:'policy.missing',suite:'audit',status:'not_run',title:'/missing'}]};
for(const [id,rows] of Object.entries(runs)){
 const dir=path.join(scratch,'runs',id);fs.mkdirSync(dir,{recursive:true});const date=id==='latest'?'2026-10-26T00:00:00Z':'2026-10-25T00:00:00Z';
 fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({runId:id,name:config.name,baseURL:config.baseURL,environment:config.environment,configHash,startedAt:date,finishedAt:date,runStatus:'finished',rows,summary:{fail:1}}));
 fs.writeFileSync(path.join(dir,'context.json'),JSON.stringify({configHash,config}));
 fs.writeFileSync(path.join(dir,'axe.json'),JSON.stringify({url:config.baseURL+'/',timestamp:date,testEnvironment:{windowWidth:1280,windowHeight:900},violations:[{id:'color-contrast',impact:'serious',help:'Contrast',nodes:[{target:['.footer'],html:'<p class="footer">Footer</p>',failureSummary:'contrast 2.07 < 4.5',any:[{data:{fgColor:'#fff',bgColor:'#c9b276',contrastRatio:2.07,expectedContrastRatio:'4.5:1'}}]}]}]}));
 fs.writeFileSync(path.join(dir,'marked-screenshots.json'),JSON.stringify({shots:[{id:'marked-001',rule:'color-contrast',number:1,target:['.footer'],status:'captured',url:config.baseURL+'/',capturedAt:date,viewport:{width:1280,height:900}}]}));
 fs.writeFileSync(path.join(dir,'marked-001.png'),png);fs.writeFileSync(path.join(dir,'policy.json'),JSON.stringify({path:'/missing',status:302,errors:['302 != 404']}));
}
const app=await startUI({configPaths:[configFile],port:0});let browser;
try{
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.url);await expect(page.locator('#metadata')).toContainText('latest');
 const beforeResults=fs.readFileSync(path.join(scratch,'runs/latest/results.json'),'utf8');
 await page.locator('#designer-report-panel summary').click();await page.locator('#designer-report-notes').fill('担当デザイナーへ：ブランド色の確認 <script>unsafe()</script>');
 await page.locator('#designer-report-generate').click();await expect(page.locator('#designer-report-status')).toContainText('不合格2ケース');
 const href=await page.locator('#designer-report-open').getAttribute('href');
 const response=await page.request.get(app.url+href);assert.equal(response.status(),200);const html=await response.text();assert.match(html,/デザイナー/);assert.match(html,/data:image\/png;base64/);assert.match(html,/older/);assert.match(html,/&lt;script&gt;/);assert(!html.includes('<script>unsafe()'));
 const popupEvent=page.waitForEvent('popup');await page.locator('#designer-report-open').click();const popup=await popupEvent;await expect(popup.locator('h1')).toContainText('デザイナー');await popup.close();
 const downloadEvent=page.waitForEvent('download');await page.locator('#designer-report-download').click();const download=await downloadEvent;
 assert.match(download.suggestedFilename(),/^designer-report-latest\.html$/);assert.equal(fs.readFileSync(await download.path(),'utf8'),html);
 const dresp=await page.request.get(app.url+href+'&download=1');assert.match(dresp.headers()['content-disposition'],/^attachment;/);assert.match(dresp.headers()['content-security-policy'],/sandbox/);
 assert.equal(fs.readFileSync(path.join(scratch,'runs/latest/results.json'),'utf8'),beforeResults,'report generation must not change test outcomes');
 await page.reload();await expect(page.locator('#metadata')).toContainText('latest');await page.locator('#designer-report-panel summary').click();await expect(page.locator('#designer-report-download')).toBeVisible();
 await page.locator('#designer-report-history').uncheck();await page.locator('#designer-report-generate').click();await expect(page.locator('#designer-report-status')).toContainText('不合格1ケース');
 await page.setViewportSize({width:390,height:844});assert(await page.locator('#designer-report-generate').isVisible());assert(await page.locator('#designer-report-panel').evaluate(e=>e.getBoundingClientRect().width>250));await page.screenshot({path:path.join(scratch,'designer-report-mobile.png'),fullPage:true});
 await page.locator('[data-run="older"]').click();await expect(page.locator('#metadata')).toContainText('older');await expect(page.locator('#designer-report-open')).toBeHidden();await expect(page.locator('#designer-report-download')).toBeHidden();await expect(page.locator('#designer-report-notes')).toHaveValue('');
 const boot=await(await fetch(app.url+'/api/bootstrap')).json(),id=boot.projects[0].id,api=app.url+`/api/projects/${id}/runs/latest/designer-report`;
 assert.equal((await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 const headers={'Content-Type':'application/json',Origin:app.url,'X-QA-Token':boot.token};assert.equal((await fetch(api,{method:'POST',headers,body:JSON.stringify({includeHistory:'yes'})})).status,400);
 const resultPath=path.join(scratch,'runs/latest/results.json'),original=fs.readFileSync(resultPath,'utf8'),running=JSON.parse(original);running.runStatus='running';fs.writeFileSync(resultPath,JSON.stringify(running));
 assert.equal((await fetch(api,{method:'POST',headers,body:JSON.stringify({includeHistory:false})})).status,409);fs.writeFileSync(resultPath,original);
 assert.deepEqual(errors,[]);console.log('Designer report UI: generate, embedded image, history, open, actual download, reload, mobile, selection reset and API guards passed. '+scratch);
}finally{await browser?.close();await app.close();}

