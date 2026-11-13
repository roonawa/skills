#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { listSkills, loadSkill } from './registry.js';
import { initialize, readConfig, addSkill, verify } from './project.js';
import { checkProject, parseTemplate } from './adapter.js';
import { readWorkflowStatus, runWorkflow } from './workflow.js';
import { evaluate } from './evaluator.js';
import { readReview } from './review.js';

async function run(args: string[]) {
  const root = realpathSync(process.cwd());
  const dryRun = args.at(-1) === '--dry-run';
  const words = dryRun ? args.slice(0,-1) : args;
  const [command, action, name] = words;
  if (command === 'init' && (words.length === 2 ||
      (words.length === 4 && name === '--template'))) {
    return {pending:initialize(root,action,dryRun,parseTemplate(words[3] ?? 'core')),dryRun};
  }
  if (command === 'skill' && action === 'add' && words.length === 3) return {pending:addSkill(root,name,dryRun),dryRun};
  if (!dryRun) {
    if (command === 'skill' && action === 'eval' && (words.length === 3 ||
        (words.length === 5 && words[3] === '--observations'))) {
      const report = evaluate(root,name,words[4]);
      process.exitCode = report.ok ? 0 : 1;
      return report;
    }
    if (command === 'workflow' && action === 'check' && words.length === 3) {
      throw new Error('workflow check には --review FILE（security と spec のレビュー結果）が必要です。');
    }
    if (command === 'workflow' && ((action === 'check' && words.length === 5 && words[3] === '--review') ||
        (action === 'status' && words.length === 3))) {
      // Read the review before reserving an attempt, so invalid input does not use up a repair.
      const {exitCode,...report} = action === 'check' ? await runWorkflow(root,name,undefined,readReview(root,words[4])) :
        await readWorkflowStatus(root,name);
      process.exitCode = exitCode;
      return {ok:exitCode === 0,...report};
    }
    if (command === 'skill' && action === 'list' && words.length === 2) return {skills:listSkills()};
    if (command === 'skill' && action === 'validate' && words.length === 3) return {skill:loadSkill(name).info};
    if (command === 'verify' && words.length === 1) return {skills:verify(root)};
    if (command === 'check' && words.length === 1) {
      const {template,checks,exitCode} = await checkProject(readConfig(root).template,root);
      process.exitCode = exitCode;
      return {ok:exitCode === 0,template,checks};
    }
    if (command === 'doctor' && words.length === 1) {
      const config = readConfig(root);
      if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 以上が必要です。');
      return {node:process.versions.node,platform:process.platform,registryCount:listSkills().length,...config};
    }
  }
  throw new Error('使用法: aidev init NAME [--template core|react|unity] | skill list | skill add NAME | skill validate NAME | skill eval NAME [--observations FILE] | doctor | verify | check | workflow check TASK --review FILE | workflow status TASK。init/add は末尾に --dry-run を指定できます。');
}
try {
  console.log(JSON.stringify({ok:true,...await run(process.argv.slice(2))}));
} catch (error) {
  const code = (error as NodeJS.ErrnoException)?.code;
  const message = code ? 'ファイル操作に失敗しました ('+code+')' : error instanceof Error ? error.message : '実行に失敗しました。';
  console.log(JSON.stringify({ok:false,error:message}));
  process.exitCode = 1;
}
