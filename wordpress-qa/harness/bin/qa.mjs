#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadConfig,catalog } from '../lib/config.mjs';
import { writeReport } from '../lib/results.mjs';
import {selectSingleTest} from '../lib/confirmation.mjs';
import { discover } from '../lib/discovery.mjs';
import { envHeaders } from '../lib/mailpit.mjs';
import {cancellationRequested} from '../lib/cancellation.mjs';
import {acquireRunLock,projectIsAlive,runIsAlive} from '../lib/run-lock.mjs';
import {preparePublicGate} from '../lib/registration-gate.mjs';
import {isolatedAuthOnly} from '../lib/isolated-auth.mjs';

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
    console.log('qa validate --config site.json\nqa discover --config site.json --sitemap /wp-sitemap.xml --output inventory.json\nqa run --config site.json [--suite all|audit|journey|visual|admin|publishing|authz|cache|operations|scheduled|delivery|performance|compatibility|seo|accessibility|commerce|membership|multilingual]\nqa approve-baseline --config site.json --run <run-directory> --id snapshot.<id>\nqa recover --config site.json --run <run-directory>\nExit: 0=command succeeded / required checks satisfied; 1=test failure; 2=incomplete/configuration/environment issue.'); return;
  }
  if(!['validate','discover','run','approve-baseline','recover'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const opts=options(args),ctx=loadConfig(opts.config),c=ctx.config;
  const rows=catalog(c,opts.suite??'all');
  if(command==='run'&&opts.id){const operation=c.journeys.find(j=>j.explicitOnly&&'journey.'+j.id===opts.id);if(operation)ctx.operation={id:operation.id,mode:process.env.WPQA_OPERATION_MODE,handlesAuthentication:operation.handlesAuthentication===true};}
  if(command==='run'&&opts.id)selectSingleTest(rows,opts.id);
  if(command==='run'&&!isolatedAuthOnly({config:c,report:{rows}}))await preparePublicGate(c);
  if(command==='run')for(const j of c.journeys.filter(j=>j.explicitOnly&&rows.some(r=>r.id==='journey.'+j.id&&r.selected))){
    if(!(process.env.WPQA_OPERATION_ID===j.id||process.env.WPQA_OPERATION_ID==='suite'&&j.runWithSuite)||!['preview','submit'].includes(process.env.WPQA_OPERATION_MODE)||!c.allowTestWrites||!['local','staging'].includes(c.environment))throw Error('BLOCKED: configure operation test execution in the UI');
  }
  if(command==='run'&&process.env.WPQA_OPERATION_ID==='suite'){
    const selected=rows.filter(r=>r.selected),operations=c.journeys.filter(j=>j.runWithSuite&&selected.some(r=>r.id==='journey.'+j.id));
    ctx.operation={mode:process.env.WPQA_OPERATION_MODE,handlesAuthentication:selected.every(r=>operations.some(j=>'journey.'+j.id===r.id&&j.handlesAuthentication))};
    if(!ctx.operation.handlesAuthentication&&c.headersEnv&&!process.env[c.headersEnv]){
      const j=operations.find(j=>j.handlesAuthentication);
      if(j){const module=await import(pathToFileURL(path.resolve(ctx.configDir,j.module)));if(module.authenticate){const {request}=await import('@playwright/test');process.env[c.headersEnv]=JSON.stringify(await module.authenticate(c,{request}));}}
    }
  }
  if(command==='recover'){
    if(!opts.run)throw new Error('--run is required');
    const directory=fs.realpathSync(path.resolve(opts.run)),output=fs.realpathSync(path.resolve(ctx.configDir,c.outputDir??'runs'));
    const relative=path.relative(output,directory);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Recovery must target a run inside this project');
    if(projectIsAlive(output)||runIsAlive(directory))throw new Error('BLOCKED: a runner may still be alive; recovery refused');
    const report=JSON.parse(fs.readFileSync(path.join(directory,'results.json'),'utf8'));
    if(report.baseURL!==c.baseURL)throw new Error('Recovery site differs from the run');
    const recoveryOwnership=acquireRunLock(output,directory);
    try {
    const {request}=await import('@playwright/test'),{recover}=await import('../lib/recovery.mjs');
    const events=[];
    const result=await recover({runDir:directory,config:c,requestFactory:request,record:event=>events.push(event)});
    const recovery={...result,finishedAt:new Date().toISOString(),events};
    fs.writeFileSync(path.join(directory,'recovery-results.json'),JSON.stringify(recovery,null,2));
    report.recovery=recovery;writeReport(directory,report);
    console.log(JSON.stringify(recovery));process.exitCode=result.pending?2:0;return;
    } finally {recoveryOwnership.finish();}
  }
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
  const ownership=acquireRunLock(path.dirname(ctx.runDir),ctx.runDir);
  const packageJSON=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  ctx.report={name:c.name,baseURL:c.baseURL,environment:c.environment,runId,startedAt:new Date().toISOString(),configHash:ctx.configHash,revision:c.revision,
    runtime:`Node ${process.version}; ${os.platform()} ${os.release()}; Playwright ${packageJSON.dependencies['@playwright/test']}`,
    rows,errors:[],runStatus:'starting'};
  const contextFile=path.join(ctx.runDir,'context.json');fs.writeFileSync(contextFile,JSON.stringify(ctx,null,2));
  const requestCancel=()=>fs.writeFileSync(path.join(ctx.runDir,'cancel.request.json'),JSON.stringify({requestedAt:new Date().toISOString()}));
  process.on('message',message=>{if(message?.type==='cancel')requestCancel();});
  writeReport(ctx.runDir,ctx.report); // Preserve a truthful ledger even if the runner cannot start.
  if(process.send) process.send({type:'run-started',runId,runDir:ctx.runDir});
  if(!rows.some(r=>r.selected)) throw new Error(`No tests in selected suite; ledger: ${ctx.runDir}`);
  ownership.spawning();
  const child=spawn(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','--config',path.join(root,'playwright.config.mjs')],
    {cwd:root,env:{...process.env,WPQA_CONTEXT:contextFile},stdio:'inherit'});
  if(child.pid)ownership.worker(child.pid);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>ownership.finish());
  const report=JSON.parse(fs.readFileSync(path.join(ctx.runDir,'results.json'),'utf8'));
  if(code!==0 && !report.rows.some(r=>['fail','blocked'].includes(r.status))) {
    report.errors.push('Runner failed before checks completed');
    for(const row of report.rows) if(row.selected&&row.status==='not_run') {row.status='blocked';row.reason='Runner did not complete';}
  }
  report.runStatus=code===null||cancellationRequested(ctx.runDir)?'interrupted':'finished';report.finishedAt??=new Date().toISOString();
  if(cancellationRequested(ctx.runDir))report.errors.push('Operator requested cancellation. Completed checks are retained; remaining checks are not certified.');
  if(process.connected)process.disconnect();
  report.recovery=(await import('../lib/recovery.mjs')).summarizeRecovery(ctx.runDir);
  writeReport(ctx.runDir,report);console.log(`Report: ${path.join(ctx.runDir,'report.html')}`);
  process.exitCode=report.rows.some(r=>r.status==='fail')?1:report.gatePassed?0:2;
}
main().catch(error=>{console.error(error.message);process.exitCode=2;if(process.connected)process.disconnect();});
