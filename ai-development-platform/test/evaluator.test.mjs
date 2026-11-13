import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {listSkills} from '../dist/registry.js';
import {scenariosFor} from '../dist/scenarios.js';
import {scoreObservations} from '../dist/eval-metrics.js';

const cli=fileURLToPath(new URL('../dist/cli.js',import.meta.url));
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const skill='aidev-debugging';
function record(decision) {
  return {decision,rubricMet:true,taskSucceeded:true,testsPassed:1,testsTotal:2,reviewFindings:0,
    elapsedMs:1500,retries:1,costUsd:null,selectedSkills:[],reused:0,reuseOpportunities:0};
}
function observed(cases,fixture) {
  return {schemaVersion:1,fixture,host:'fixture-host',model:'fixture-model',budget:'1000-tokens',
    cases:cases.map(s=>({id:s.id,withSkill:record(s.expected),withoutSkill:record('unknown')}))};
}
test('each bundled skill has all five distinct decision cases',()=>{
  for (const {name} of listSkills()) {
    const cases=scenariosFor(name);
    assert.deepEqual(cases.map(s=>s.id),['normal','ambiguous','conflict','test-failure','out-of-scope']);
    assert.equal(new Set(cases.map(s=>s.prompt)).size,5);
  }
});
test('CLI saves isolated delivery checks, blind prompts, and paired scores',t=>{
  const root=mkdtempSync(join(tmpdir(),'aidev-eval-test-'));
  t.after(()=>rmSync(root,{force:true,recursive:true}));
  function invoke(args,code=0) {
    const proc=spawnSync(process.execPath,[cli,'skill','eval',skill,...args],{cwd:root,encoding:'utf8'});
    assert.equal(proc.status,code,proc.stderr+proc.stdout);
    return JSON.parse(proc.stdout);
  }
  const first=invoke([]);
  const report=read(join(root,first.report));
  assert.equal(report.behaviorStatus,'not-run');
  assert.equal(report.comparison,null);
  assert.equal(report.local.length,4);
  assert.ok(report.local.every(c=>c.passed));
  assert.equal(existsSync(join(root,'.claude')),false);
  const prompts=read(join(root,dirname(first.report),'prompts.json'));
  assert.deepEqual(Object.keys(prompts[0]),['id','prompt']);
  const data=observed(report.cases,report.fixture);
  writeFileSync(join(root,'paired.json'),JSON.stringify(data));
  const result=invoke(['--observations','paired.json']);
  assert.notEqual(result.report,first.report);
  const scored=read(join(root,result.report)).comparison;
  assert.equal(scored.decisionPassCountDelta,5);
  assert.equal(scored.withSkill.tests.rate,0.5);
  assert.equal(scored.withSkill.costUsd,null);
  assert.equal(scored.withSkill.reuse.rate,null);
  data.cases[0].withSkill.rubricMet=false;
  writeFileSync(join(root,'paired.json'),JSON.stringify(data));
  const failed=read(join(root,invoke(['--observations','paired.json'],1).report));
  assert.equal(failed.comparison.improvementCandidates[0].id,'normal');
  invoke(['--observations','../paired.json'],1);
});
test('reject incomplete, mismatched, impossible or contaminated observations',()=>{
  const cases=scenariosFor(skill);
  for (const change of [
    v=>{v.fixture='wrong';},v=>{v.cases.pop();},v=>{v.cases[0].id=v.cases[1].id;},
    v=>{v.cases[0].withSkill.testsPassed=3;},v=>{v.cases[0].withSkill.elapsedMs=-1;},
    v=>{v.cases[0].withoutSkill.selectedSkills=[skill];},v=>{v.cases[0].withSkill.rubricMet=null;}
  ]) {
    const data=observed(cases,'fixture');
    change(data);
    assert.throws(()=>scoreObservations(data,'fixture',skill,cases));
  }
});
