#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadConfig,catalog } from '../lib/config.mjs';
import { writeReport } from '../lib/results.mjs';
import { discover } from '../lib/discovery.mjs';
import { envHeaders } from '../lib/mailpit.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function options(args) {
  const out={};
  for(let i=0;i<args.length;i+=2) {
    if(!['--config','--suite','--run','--id','--sitemap','--output'].includes(args[i]) || !args[i+1] || args[i+1].startsWith('--')) throw new Error(`Invalid option: ${args[i]}`);
    if(out[args[i].slice(2)]!==undefined) throw new Error(`Duplicate option ${args[i]}`);
    out[args[i].slice(2)]=args[i+1];
  }
  if(!out.config) throw new Error('--config <site.json> required');
  return out;
}
async function main() {
  const [command,...args]=process.argv.slice(2);
  if(!command || command==='help' || command==='--help') {
    console.log('qa validate --config site.json\nqa discover --config site.json --sitemap /wp-sitemap.xml --output inventory.json\nqa run --config site.json [--suite all|audit|journey|visual]\nqa approve-baseline --config site.json --run <run-directory> --id snapshot.<id>\nExit: 0=command succeeded / required checks satisfied; 1=test failure; 2=incomplete/configuration/environment issue.'); return;
  }
  if(!['validate','discover','run','approve-baseline'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const opts=options(args),ctx=loadConfig(opts.config),c=ctx.config;
  const rows=catalog(c,opts.suite??'all');
  if(command==='discover') {
    if(!opts.sitemap||!opts.output) throw new Error('--sitemap and --output required');
    const {request}=await import('@playwright/test');
    const client=await request.newContext({extraHTTPHeaders:envHeaders(c.headersEnv)});
    try { const inventory=await discover(client,c.baseURL,opts.sitemap,c.timeoutMs);fs.writeFileSync(path.resolve(opts.output),JSON.stringify(inventory,null,2),{flag:'wx'});console.log(`Inventory: ${inventory.urls.length} URLs. Not a QA pass.`); }
    finally {await client.dispose();} return;
  }
  ctx.baselineDir=path.resolve(ctx.configDir,c.baselineDir??'baselines');
  if(command==='validate') {
    for(const j of c.journeys) if(!fs.existsSync(path.resolve(ctx.configDir,j.module))) throw new Error(`Journey module not found: ${j.module}`);
    console.log(`Valid: ${c.name}; ${rows.length} checks; SHA256 ${ctx.configHash}`);return;
  }
  if(command==='approve-baseline') {
    if(!opts.run||!opts.id||!/^snapshot\.[a-z][a-z0-9-]{0,63}$/.test(opts.id)) throw new Error('--run and valid --id required');
    const run=path.resolve(opts.run),report=JSON.parse(fs.readFileSync(path.join(run,'results.json'),'utf8'));
    if(report.configHash!==ctx.configHash) throw new Error('Configuration changed since candidate capture; run again');
    const row=report.rows.find(r=>r.id===opts.id);
    if(!row || !['review','fail','pass'].includes(row.status)) throw new Error('No reviewable screenshot result');
    const meta=JSON.parse(fs.readFileSync(path.join(run,'candidates',`${opts.id}.json`),'utf8'));
    if(meta.id!==opts.id || meta.configHash!==ctx.configHash) throw new Error('Candidate does not match config/id');
    fs.mkdirSync(ctx.baselineDir,{recursive:true});
    fs.copyFileSync(path.join(run,'candidates',`${opts.id}.png`),path.join(ctx.baselineDir,`${opts.id.replace('.', '-')}.png`));
    fs.writeFileSync(path.join(ctx.baselineDir,`${opts.id}.json`),JSON.stringify({...meta,approvedAt:new Date().toISOString(),sourceRun:report.runId},null,2));
    console.log(`Approved ${opts.id}. Run visual tests again; the previous report remains unchanged.`);return;
  }
  const runId=`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
  ctx.runDir=path.join(path.resolve(ctx.configDir,c.outputDir??'runs'),runId);fs.mkdirSync(ctx.runDir,{recursive:true});
  const packageJSON=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  ctx.report={name:c.name,baseURL:c.baseURL,environment:c.environment,runId,startedAt:new Date().toISOString(),configHash:ctx.configHash,revision:c.revision,
    runtime:`Node ${process.version}; ${os.platform()} ${os.release()}; Playwright ${packageJSON.dependencies['@playwright/test']}`,
    rows,errors:[],runStatus:'starting'};
  const contextFile=path.join(ctx.runDir,'context.json');fs.writeFileSync(contextFile,JSON.stringify(ctx,null,2));
  writeReport(ctx.runDir,ctx.report); // Preserve a truthful ledger even if the runner cannot start.
  if(process.send) process.send({type:'run-started',runId,runDir:ctx.runDir});
  if(!rows.some(r=>r.selected)) throw new Error(`No tests in selected suite; ledger: ${ctx.runDir}`);
  const child=spawn(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','--config',path.join(root,'playwright.config.mjs')],
    {cwd:root,env:{...process.env,WPQA_CONTEXT:contextFile},stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  const report=JSON.parse(fs.readFileSync(path.join(ctx.runDir,'results.json'),'utf8'));
  if(code!==0 && !report.rows.some(r=>['fail','blocked'].includes(r.status))) {
    report.errors.push('Runner failed before checks completed');
    for(const row of report.rows) if(row.selected&&row.status==='not_run') {row.status='blocked';row.reason='Runner did not complete';}
  }
  report.runStatus=code===null?'interrupted':'finished';report.finishedAt??=new Date().toISOString();
  writeReport(ctx.runDir,report);console.log(`Report: ${path.join(ctx.runDir,'report.html')}`);
  process.exitCode=report.rows.some(r=>r.status==='fail')?1:report.gatePassed?0:2;
}
main().catch(error=>{console.error(error.message);process.exitCode=2;});
