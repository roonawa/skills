import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { startDemo } from '../examples/demo-server.mjs';
import { startUI } from '../ui/server.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=path.join(root,'.selftest',`ui-${Date.now()}`);fs.mkdirSync(scratch,{recursive:true});
const demo=await startDemo(0);
const config=JSON.parse(fs.readFileSync(path.join(root,'examples/site.demo.json'),'utf8'));
config.admin=JSON.parse(fs.readFileSync(path.join(root,'examples/admin.demo.json'),'utf8'));
config.baseURL=demo.url;config.mailpit.url=demo.url;config.pages.forEach(p=>p.canonical=new URL(p.path,demo.url).href);
config.outputDir=path.join(scratch,'runs');config.baselineDir=path.join(scratch,'baselines');config.journeys[0].module=path.join(root,'examples/contact.mjs');
const file=path.join(scratch,'site.json');fs.writeFileSync(file,JSON.stringify(config));
const app=await startUI({configPaths:[file],port:0});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(app.url);
  await page.getByText('まだ実行履歴がありません',{exact:true}).waitFor();
  await page.getByRole('button',{name:'検査を実行',exact:true}).click();
  await page.getByText('実行中',{exact:true}).first().waitFor();
  await page.getByText('実行が完了しました',{exact:true}).waitFor({timeout:90000});
  await expect(page.locator('#cinema-verdict')).toContainText('ACCESS PENDING');
  await page.locator('#cinema-verdict button').click();
  await page.getByRole('button',{name:'snapshot.home-mobile',exact:false}).click();
  await page.getByLabel('候補画像を確認し、意図した表示であることを確認しました').check();
  await page.getByRole('button',{name:'この画像を基準として承認',exact:true}).click();
  await page.getByText('基準画像を承認しました。再実行して比較してください。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'検査を実行',exact:true}).click();
  await page.getByText('実行中',{exact:true}).first().waitFor();
  await page.getByText('必須条件を満たしています',{exact:true}).waitFor({timeout:90000});
  await expect(page.locator('#cinema-verdict')).toContainText('ACCESS GRANTED');
  await page.screenshot({path:path.join(scratch,'access-granted.png'),fullPage:false});
  await page.locator('#cinema-verdict button').click();
  await page.screenshot({path:path.join(scratch,'dashboard.png'),fullPage:true});
  const runIds=await page.locator('[data-run]').evaluateAll(items=>items.map(x=>x.dataset.run));
  await page.locator(`[data-run="${runIds[1]}"]`).click();
  await expect(page.locator('#metadata')).toContainText(runIds[1]);
  await page.getByRole('button',{name:'snapshot.home-mobile',exact:false}).click();
  await page.getByLabel('候補画像を確認し、意図した表示であることを確認しました').check();
  let releaseLatest;
  const holdLatest=new Promise(r=>releaseLatest=r);
  await page.route(`**/api/projects/*/runs/${runIds[0]}`,async route=>{await holdLatest;await route.continue();});
  await page.locator(`[data-run="${runIds[0]}"]`).click();
  try {assert.equal(await page.locator('#approve-button').count(),0,'selection change must remove the previous approval control immediately');}
  finally{releaseLatest();}
  await expect(page.locator('#metadata')).toContainText(runIds[0]);
  await page.unroute(`**/api/projects/*/runs/${runIds[0]}`);
  demo.faults.add('canonical');
  await page.getByRole('button',{name:'検査を実行',exact:true}).click();
  await page.getByText('実行中',{exact:true}).first().waitFor();
  await page.getByText('実行が完了しました',{exact:true}).waitFor({timeout:90000});
  await expect(page.locator('#cinema-verdict')).toContainText('ACCESS DENIED');
  await page.screenshot({path:path.join(scratch,'access-denied.png'),fullPage:false});
  await page.locator('#cinema-verdict button').click();
  await page.getByRole('button',{name:'page.home',exact:false}).click();
  await page.getByText('canonical differs from expectation',{exact:false}).first().waitFor();
  await page.screenshot({path:path.join(scratch,'failure.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(scratch,'mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#suite-select').selectOption('admin');
  demo.faults.add('admin-value');
  await page.getByRole('button',{name:'検査を実行',exact:true}).click();
  await page.getByText('実行中',{exact:true}).first().waitFor();
  await page.getByText('実行が完了しました',{exact:true}).waitFor({timeout:90000});
  await page.getByRole('button',{name:'admin.timezone',exact:false}).click();
  await expect(page.locator('#detail')).toContainText('Asia/Tokyo');
  await expect(page.locator('#detail')).toContainText('UTC');
  await expect(page.locator('#metric-fail')).toHaveText('2');
  await page.screenshot({path:path.join(scratch,'admin-settings.png'),fullPage:true});
  demo.faults.add('admin-auth');
  await page.getByRole('button',{name:'検査を実行',exact:true}).click();
  await page.getByText('実行中',{exact:true}).first().waitFor();
  await page.getByText('実行が完了しました',{exact:true}).waitFor({timeout:90000});
  await expect(page.locator('#metric-blocked')).toHaveText('2');
  config.baseURL='https://changed.example.test';config.environment='staging';fs.writeFileSync(file,JSON.stringify(config));
  await expect(page.locator('#environment')).toHaveText('検証環境');
  await expect(page.locator('#metadata')).toContainText(demo.url);
  const latest=fs.readdirSync(config.outputDir).sort().at(-1);
  const artifacts=path.join(config.outputDir,latest,'artifacts');
  if(fs.existsSync(artifacts))for(const relative of fs.readdirSync(artifacts,{recursive:true})) {
    assert.ok(!/trace\.zip$|\.png$/.test(relative),'admin failures must not capture traces/screenshots');
  }
  for(const run of fs.readdirSync(config.outputDir)) {
    const results=fs.readFileSync(path.join(config.outputDir,run,'results.json'),'utf8');
    assert.ok(!results.includes('fixture-secret-never-save'));
  }
  assert.deepEqual(errors,[]);
  console.log(`UI browser acceptance passed: ${scratch}`);
} finally {await browser.close();await app.close();await demo.close();}
