// Black-box acceptance: actual CLI + Playwright against an isolated HTTP fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startDemo } from '../examples/demo-server.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=path.join(root,'.selftest',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(scratch,{recursive:true});
const server=await startDemo(0);
const config=JSON.parse(fs.readFileSync(path.join(root,'examples/site.demo.json'),'utf8'));
config.baseURL=server.url; config.pages.forEach(p=>p.canonical=new URL(p.path,server.url).href);
config.mailpit.url=server.url;
config.headersEnv='WPQA_SELFTEST_HEADERS';process.env.WPQA_SELFTEST_HEADERS=JSON.stringify({'X-QA-Fixture':'local-only'});
config.journeys[0].module=path.join(root,'examples/contact.mjs');
config.outputDir=path.join(scratch,'runs'); config.baselineDir=path.join(scratch,'baselines');
const file=path.join(scratch,'site.json');
const save=()=>fs.writeFileSync(file,JSON.stringify(config)); save();
async function cli(args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(root,'bin/qa.mjs'),...args],{cwd:root,stdio:['ignore','pipe','pipe']});
    let log=''; child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);child.on('error',reject);
    child.on('exit',code=>{fs.appendFileSync(path.join(scratch,'execution.log'),log);resolve({code,log});});
  });
}
async function run(suite='all') {
  const outcome=await cli(['run','--config',file,'--suite',suite]);
  const runs=fs.readdirSync(config.outputDir).sort();
  const dir=path.join(config.outputDir,runs.at(-1));
  const report=JSON.parse(fs.readFileSync(path.join(dir,'results.json'),'utf8'));
  console.log(`${suite}: exit=${outcome.code} ${JSON.stringify(report.summary)}`);
  return {...outcome,dir,report};
}
function status(run,id) {return run.report.rows.find(r=>r.id===id)?.status;}
try {
  const inventoryFile=path.join(scratch,'inventory.json');
  const discovered=await cli(['discover','--config',file,'--sitemap','/wp-sitemap.xml','--output',inventoryFile]);
  assert.equal(discovered.code,0,discovered.log);assert.equal(JSON.parse(fs.readFileSync(inventoryFile,'utf8')).urls.length,2);
  let r=await run();
  assert.equal(status(r,'snapshot.home-mobile'),'review',r.log);
  assert.equal(status(r,'journey.contact'),'pass',r.log);
  assert.equal(status(r,'layout.home-mobile'),'pass',r.log);
  assert.equal(status(r,'axe.home-mobile'),'pass',r.log);
  assert.equal(r.code,2);
  const approved=await cli(['approve-baseline','--config',file,'--run',r.dir,'--id','snapshot.home-mobile']);
  assert.equal(approved.code,0,approved.log);
  r=await run(); assert.equal(r.code,0,r.log); assert.equal(r.report.gatePassed,true);
  r=await run(); assert.equal(r.code,0,'repeat should be stable: '+r.log);
  r=await run('audit'); assert.equal(status(r,'journey.contact'),'not_run'); assert.equal(r.report.gatePassed,false);
  server.faults.add('noindex'); server.faults.add('canonical'); server.faults.add('mail'); server.faults.add('layout');
  r=await run();
  for(const id of ['page.home','journey.contact','layout.home-mobile','snapshot.home-mobile']) assert.equal(status(r,id),'fail',`${id}: ${r.log}`);
  assert.equal(r.code,1);
  server.faults.clear(); server.faults.add('leak'); server.faults.add('link');
  r=await run('audit'); assert.equal(status(r,'policy.config-source'),'fail'); assert.equal(status(r,'links.home'),'fail');
  server.faults.clear(); config.mailpit.url='http://127.0.0.1:1'; save();
  r=await run('journey'); assert.equal(status(r,'journey.contact'),'blocked');assert.equal(r.code,2);
  config.mailpit.url=server.url;config.headersEnv='WPQA_SELFTEST_MISSING_HEADERS';save();
  r=await run('audit');assert.equal(r.code,2);assert.equal(r.report.gatePassed,false);assert.ok(r.report.rows.some(x=>x.status==='blocked'));
  console.log(`Acceptance checks passed. Evidence: ${scratch}`);
} finally { await server.close(); }
