#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { listSkills, loadSkill } from './registry.js';
import { initialize, readConfig, addSkill, updateSkill, verify } from './project.js';
import { checkProject, parseTemplate } from './adapter.js';
import { readWorkflowStatus, runWorkflow } from './workflow.js';
import { evaluate } from './evaluator.js';
import { readReview } from './review.js';
import { claudeRunner, runLoop, type ClaudeOptions } from './loop.js';
import { checkSpec } from './spec.js';
import { checkProfile } from './qa-profile.js';
import { compareReport } from './qa-compare.js';
import { createIssueFromRun } from './qa-issue.js';

/** Session limits for `workflow run`, from the environment. Invalid values stop before any session starts. */
function sessionOptions(env: NodeJS.ProcessEnv): ClaudeOptions {
  const number = (name: string, max: number) => {
    const value = env[name];
    if (value === undefined || value === '') return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) throw new Error(name + ' には 0 より大きく ' + max + ' 以下の数を指定してください。');
    return parsed;
  };
  const minutes = number('AIDEV_SESSION_TIMEOUT_MIN', 180);
  return {command:env.AIDEV_CLAUDE || undefined, budgetUsd:number('AIDEV_SESSION_BUDGET_USD', 100),
    timeoutMs:minutes === undefined ? undefined : minutes * 60_000, model:env.AIDEV_MODEL || undefined};
}

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
  if (command === 'skill' && action === 'update' && words.length === 3) return {...updateSkill(root,name,dryRun),dryRun};
  if (command === 'spec' && action === 'check' && words.length === 3 && !dryRun) {
    const report = checkSpec(root,name);
    process.exitCode = report.errors.length ? 1 : 0;
    return {ok:!report.errors.length,...report};
  }
  if (command === 'qa' && action === 'profile' && name === 'check' && !dryRun &&
      (words.length === 4 || (words.length === 6 && words[4] === '--skill'))) {
    const report = checkProfile(root,words[3],words[5]);
    process.exitCode = report.errors.length ? 1 : 0;
    return {ok:!report.errors.length,...report};
  }
  if (command === 'qa' && action === 'compare-report' && !dryRun &&
      (words.length === 4 || (words.length === 5 && words[4] === '--link'))) {
    return compareReport(root,words[2],words[3],words.length === 5);
  }
  if (command === 'qa' && action === 'issue' && name === 'create' && words.length === 9) {
    const flags = new Map<string, string>();
    for (let i = 3; i < words.length; i += 2) if (!flags.has(words[i])) flags.set(words[i], words[i + 1]);
    const [profile, run, tc] = ['--profile', '--run', '--tc'].map(flag => flags.get(flag));
    if (profile !== undefined && run !== undefined && tc !== undefined) {
      // GITEA_TOKEN is read here only and is never part of the output.
      return createIssueFromRun({root, profile, run, tc, dryRun, token: dryRun ? undefined : process.env.GITEA_TOKEN});
    }
  }
  if (!dryRun) {
    if (command === 'skill' && action === 'eval' && (words.length === 3 ||
        (words.length === 5 && words[3] === '--observations'))) {
      const report = evaluate(root,name,words[4]);
      process.exitCode = report.ok ? 0 : 1;
      return report;
    }
    if (command === 'workflow' && action === 'run' && words.length === 5 && words[3] === '--spec') {
      const {exitCode,...report} = await runLoop(root,name,words[4],{runner:claudeRunner(sessionOptions(process.env))});
      process.exitCode = exitCode;
      return {ok:exitCode === 0,...report};
    }
    if (command === 'workflow' && action === 'check' && words.length === 3) {
      throw new Error('workflow check には --review FILE（security と spec のレビュー結果）が必要です。');
    }
    if (command === 'workflow' && ((action === 'check' && words.length === 5 && words[3] === '--review') ||
        (action === 'status' && words.length === 3))) {
      // Read the review before reserving an attempt, so invalid input does not use up a repair.
      const review = action === 'check' ? readReview(root,words[4]) : undefined;
      const {exitCode,...report} = review ? await runWorkflow(root,name,undefined,review.checks,review.notes) :
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
  throw new Error('使用法: aidev init NAME [--template core|react|unity|qa] | skill list | skill add NAME | skill update NAME | skill validate NAME | skill eval NAME [--observations FILE] | doctor | verify | check | spec check FILE | qa profile check FILE [--skill NAME] | qa compare-report MANIFEST OUT [--link] | qa issue create --profile FILE --run RUNDIR --tc TC-ID [--dry-run] | workflow check TASK --review FILE | workflow run TASK --spec FILE | workflow status TASK。init/add/update/qa issue create は末尾に --dry-run を指定できます。');
}
try {
  console.log(JSON.stringify({ok:true,...await run(process.argv.slice(2))}));
} catch (error) {
  const code = (error as NodeJS.ErrnoException)?.code;
  const message = code ? 'ファイル操作に失敗しました ('+code+')' : error instanceof Error ? error.message : '実行に失敗しました。';
  console.log(JSON.stringify({ok:false,error:message}));
  process.exitCode = 1;
}
