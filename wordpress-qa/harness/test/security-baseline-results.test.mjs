import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeReport,releaseGate,displayStatus} from '../lib/results.mjs';
import {catalog} from '../lib/config.mjs';
import {explainFailure,enrichFailures} from '../lib/failure-explanations.mjs';
import {buildIssueReport} from '../lib/issue-report.mjs';
import {examGroups} from '../lib/site-exam.mjs';
import {RULES} from '../lib/security-baseline-rules.mjs';
const caution=(id,status='fail')=>({id,title:id,required:false,level:'caution',status,reason:'x'});
test('caution rows are counted separately',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sb-'));
  const report={name:'n',rows:[{id:'a',title:'a',required:true,status:'fail'},caution('b'),caution('c')],errors:[],runStatus:'finished'};
  writeReport(dir,report);
  assert.equal(report.summary.fail,3);assert.equal(report.summary.caution,2);
  assert.equal(fs.readFileSync(path.join(dir,'report.html'),'utf8').match(/<td class="caution">注意<\/td>/g).length,2);
  assert.equal(displayStatus(caution('x','pass')),'pass');assert.equal(displayStatus(caution('x')),'caution');
});
test('releaseGate ignores caution rows',()=>assert.equal(releaseGate([{id:'a',required:true,status:'pass'},caution('b')]),true));
test('caution only for security-baseline',()=>{
  const base={id:'x',title:'t',suite:'authz',required:false,options:{area:'headers'}};
  const rows=catalog({baseURL:'https://example.test',pages:[],policies:[],journeys:[],visuals:[],manual:[],checks:[{...base,kind:'security-baseline'},{...base,id:'y',suite:'audit',kind:'standard-public',options:{}},{...base,id:'z',kind:'security-baseline',required:true}]});
  const by=Object.fromEntries(rows.map(r=>[r.id,r]));
  assert.equal(by['check.x'].level,'caution');assert.equal(by['check.y'].level,undefined);assert.equal(by['check.z'].level,undefined);
});
test('baseline findings become explained failures',()=>{
  const ev={schema:'security-baseline-v1',findings:[{rule:'git-head',level:'problem',path:'/.git/HEAD',observation:'200'},{rule:'git-config',level:'problem',path:'/.git/config',observation:'200'}]};
  const out=explainFailure({id:'check.x',status:'fail'},[ev]);
  assert.equal(out.length,2);
  for(const [i,rule] of ['git-head','git-config'].entries()){const f=out[i],r=RULES[rule];
    assert.equal(f.key,`baseline:${rule}:${ev.findings[i].path}`);assert.equal(f.title,r.title);assert.equal(f.impact,r.impact);assert.equal(f.admin,r.admin);assert.equal(f.code,r.code);assert.equal(f.verify,r.verify);assert.equal(f.actual,ev.findings[i].observation);}
  const enriched=enrichFailures({rows:[{id:'check.x',status:'fail',evidence:['a/security-baseline.json']}]},()=>ev);
  assert.equal(enriched.rows[0].failures[0].key,'baseline:git-head:/.git/HEAD');
});
test('issue report labels caution',()=>{
  const current={runId:'r',startedAt:'2026-01-01',finishedAt:'2026-01-01',runStatus:'finished',configHash:'h',baseURL:'https://example.test',environment:'production',name:'QA',rows:[{id:'check.x',title:'基礎診断',required:false,level:'caution',status:'fail',evidence:[]}]};
  const html=buildIssueReport({current,readEvidence:()=>({})}).html;
  assert.match(html,/基礎診断 — check\.x（注意）/);
});
test('exam groups mark caution rows',()=>{
  const g=examGroups({rows:[{id:'check.x',title:'t',level:'caution',status:'fail',failures:[{key:'baseline:hsts:/',title:'HSTS',impact:'i',admin:'a'}]}]});
  assert.equal(g[0].level,'caution');assert.match(g[0].title,/^注意：/);
});
