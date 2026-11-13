import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checked, content, install } from './files.js';
import { initialize, addSkill, verify } from './project.js';
import { loadSkill } from './registry.js';
import { scenariosFor } from './scenarios.js';
import { scoreObservations } from './eval-metrics.js';

function checkDelivery(name:string, source:string) {
  const scratch=mkdtempSync(join(tmpdir(),'aidev-eval-'));
  const checks:{id:string;passed:boolean}[]=[];
  try {
    initialize(scratch,'fixture',false);
    const project=join(scratch,'fixture');
    addSkill(project,name,false);
    for (const host of ['.claude','.agents']) {
      const copy=checked(project,host+'/skills/'+name+'/SKILL.md');
      checks.push({id:host+'-copy',passed:readFileSync(copy,'utf8')===source});
    }
    checks.push({id:'verify-install',passed:verify(project).includes(name)});
    writeFileSync(checked(project,'.agents/skills/'+name+'/SKILL.md'),source+'\nfixture drift\n');
    let detected=false;
    try { verify(project); } catch (error) {
      detected=error instanceof Error && error.message.includes('既存ファイルと競合');
    }
    checks.push({id:'detect-drift',passed:detected});
  } catch {
    checks.push({id:'fixture-execution',passed:false});
  } finally {
    rmSync(scratch,{recursive:true,force:true});
  }
  return checks;
}
export function evaluate(root:string,name:string,observationFile?:string) {
  const {source,info}=loadSkill(name);
  const cases=scenariosFor(name);
  const fixture=createHash('sha256').update(JSON.stringify([1,source,cases])).digest('hex');
  let comparison=null;
  if (observationFile !== undefined) {
    const value=content(checked(root,observationFile));
    if (!value) throw new Error('観測ファイルがありません。');
    let input:unknown;
    try {input=JSON.parse(value);} catch {throw new Error('観測 JSON が不正です。');}
    comparison=scoreObservations(input,fixture,name,cases);
  }
  const checks=checkDelivery(name,source);
  const ok=checks.every(item=>item.passed) && (!comparison || comparison.results.every(result=>result.passed.withSkill));
  const folder='.aidev/evals/'+name+'/'+randomUUID();
  const report={schemaVersion:1,createdAt:new Date().toISOString(),fixture,skill:info,local:checks,
    behaviorStatus:comparison ? 'scored' : 'not-run',cases,comparison};
  const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
  const blank={decision:null,rubricMet:null,taskSucceeded:null,testsPassed:null,testsTotal:null,reviewFindings:null,
    elapsedMs:null,retries:null,costUsd:null,selectedSkills:null,reused:null,reuseOpportunities:null};
  install(root,{
    [folder+'/prompts.json']:json(cases.map(({id,prompt})=>({id,prompt}))),
    [folder+'/observations-template.json']:json({schemaVersion:1,fixture,host:null,model:null,budget:null,
      cases:cases.map(({id})=>({id,withSkill:blank,withoutSkill:blank}))}),
    [folder+'/report.json']:json(report)
  },false);
  return {ok,report:folder+'/report.json',fixture,local:checks,behaviorStatus:report.behaviorStatus,
    caseCount:cases.length,decisionPassCountDelta:comparison?.decisionPassCountDelta ?? null};
}
