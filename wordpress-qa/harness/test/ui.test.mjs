import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startUI } from '../ui/server.mjs';

test('local UI exposes registered projects/history, restricts files and cross-origin mutations',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-ui-'));
  const configFile=path.join(dir,'site.json'),runDir=path.join(dir,'runs','test-run');
  fs.mkdirSync(runDir,{recursive:true});
  fs.writeFileSync(configFile,JSON.stringify({name:'UI Site',baseURL:'http://127.0.0.1:4300',environment:'local',pages:[{id:'home',path:'/',canonical:'http://127.0.0.1:4300/',indexable:true}],journeys:[],visuals:[]}));
  fs.mkdirSync(path.join(runDir,'artifacts'),{recursive:true});fs.writeFileSync(path.join(runDir,'artifacts','audit.json'),'{}');
  fs.writeFileSync(path.join(runDir,'results.json'),JSON.stringify({runId:'test-run',name:'UI Site',startedAt:'2026-10-19T00:00:00Z',rows:[{id:'page.home',status:'pass',selected:true,required:true,evidence:['proof.json','artifacts/audit.json']}],summary:{pass:1},gatePassed:true}));
  fs.writeFileSync(path.join(runDir,'proof.json'),'{"checked":true}');
  fs.writeFileSync(path.join(runDir,'context.json'),'DO-NOT-SERVE');
  const app=await startUI({configPaths:[configFile],port:0});
  try {
    const boot=await (await fetch(`${app.url}/api/bootstrap`)).json();
    assert.equal(boot.projects.length,1);assert.equal(boot.projects[0].name,'UI Site');
    const id=boot.projects[0].id;
    const state=await (await fetch(`${app.url}/api/projects/${id}`)).json();
    assert.equal(state.runs[0].runId,'test-run');
    const report=await (await fetch(`${app.url}/api/projects/${id}/runs/test-run`)).json();
    assert.equal(report.report.rows[0].status,'pass');
    assert.equal((await fetch(`${app.url}/api/projects/${id}/runs/test-run/files?path=proof.json`)).status,200);
    assert.equal((await fetch(`${app.url}/api/projects/${id}/runs/test-run/artifacts/audit.json`)).status,200,'relative links from HTML report must open evidence');
    for(const file of ['context.json','../../site.json']) assert.equal((await fetch(`${app.url}/api/projects/${id}/runs/test-run/files?path=${encodeURIComponent(file)}`)).status,403);
    for(const headers of [{},{Origin:'http://evil.test','X-QA-Token':boot.token}]) {
      assert.equal((await fetch(`${app.url}/api/projects/${id}/runs`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{"suite":"audit"}'})).status,403);
    }
    assert.equal((await fetch(`${app.url}/api/projects/${id}/runs`,{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:'{"suite":"invalid"}'})).status,400);
    assert.equal((await fetch(`${app.url}/api/projects/unknown`)).status,404);
    assert.equal((await fetch(app.url)).status,200);
  } finally {await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
