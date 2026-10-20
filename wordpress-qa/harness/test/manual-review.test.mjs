import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startUI} from '../ui/server.mjs';
import {loadConfig} from '../lib/config.mjs';
import {writeReport} from '../lib/results.mjs';

test('manual reviews retain audit history, enforce scope and recalculate gate',async()=> {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-review-')),runDir=path.join(dir,'runs','review-run');fs.mkdirSync(runDir,{recursive:true});
  const configFile=path.join(dir,'site.json');
  fs.writeFileSync(configFile,JSON.stringify({name:'Review',baseURL:'http://127.0.0.1:4300',environment:'local',pages:[{id:'home',path:'/',canonical:'http://127.0.0.1:4300/',indexable:true}],journeys:[],visuals:[]}));
  const report={runId:'review-run',name:'Review',runStatus:'finished',startedAt:'2026-01-01',finishedAt:'2026-01-01',configHash:loadConfig(configFile).configHash,rows:[{id:'manual.device',title:'Device',required:true,manualReview:true,status:'review',evidence:[]},{id:'auto.test',status:'pass',required:true}]};
  writeReport(runDir,report);
  const app=await startUI({configPaths:[configFile],port:0});
  try {
    const boot=await(await fetch(app.url+'/api/bootstrap')).json(),id=boot.projects[0].id;
    const endpoint=`${app.url}/api/projects/${id}/runs/review-run/review`;
    const headers={'Content-Type':'application/json',Origin:app.url,'X-QA-Token':boot.token};
    const data={rowId:'manual.device',outcome:'pass',reviewer:'Tester <script>',notes:'Checked <script>alert(1)</script>',evidence:['https://example.test/proof']};
    const post=(value=data,h=headers)=>fetch(endpoint,{method:'POST',headers:h,body:JSON.stringify(value)});
    assert.equal((await post(data,{'Content-Type':'application/json'})).status,403);
    assert.equal((await post({...data,rowId:'auto.test'})).status,400);
    assert.equal((await post({...data,evidence:[]})).status,400);
    report.runStatus='running';writeReport(runDir,report);assert.equal((await post()).status,409);
    report.runStatus='finished';report.configHash='stale';writeReport(runDir,report);assert.equal((await post()).status,409);
    report.configHash=loadConfig(configFile).configHash;writeReport(runDir,report);
    const first=await post();assert.equal(first.status,200);assert.equal((await first.json()).report.gatePassed,true);
    const original=JSON.parse(fs.readFileSync(path.join(runDir,'automated-results.json')));assert.equal(original.rows[0].status,'review');
    const second=await post({...data,outcome:'fail'});assert.equal(second.status,200);assert.equal((await second.json()).report.gatePassed,false);
    const files=fs.readdirSync(path.join(runDir,'manual-reviews'));assert.equal(files.length,2);
    const audits=files.map(f=>JSON.parse(fs.readFileSync(path.join(runDir,'manual-reviews',f))));
    assert.deepEqual(audits.map(a=>a.previousStatus).sort(),['pass','review']);
    assert.ok(audits.every(a=>a.runId==='review-run'&&a.configHash===report.configHash&&a.timestamp));
    const html=fs.readFileSync(path.join(runDir,'report.html'),'utf8');assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(runDir,'automated-results.json'))).rows[0].status,'review');
  } finally {await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
