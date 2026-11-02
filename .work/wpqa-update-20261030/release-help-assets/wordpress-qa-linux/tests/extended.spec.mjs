import {test,request as requestFactory} from '@playwright/test';
import fs from 'node:fs';
import {runCheck} from '../lib/checks/index.mjs';
import {createEvidence} from '../lib/evidence.mjs';
import {checkCancellation,cancellationSignal} from '../lib/cancellation.mjs';
const ctx=JSON.parse(fs.readFileSync(process.env.WPQA_CONTEXT,'utf8'));
test.use({trace:'off',screenshot:'off',video:'off'});
for(const check of ctx.config.checks??[]){
 const row=ctx.report.rows.find(r=>r.id==='check.'+check.id);
 if(!row?.selected)continue;
 test(row.id+' | '+row.title,async({browser},info)=>{
  test.setTimeout(check.timeoutMs??Math.min(900000,Math.max(ctx.config.timeoutMs*8,(check.options.maxWaitMs??(check.kind==='wp-scheduled'?(check.options.scheduleDelayMs??120000)+30000:0))+ctx.config.timeoutMs*6,120000)));
  if(check.kind==='human-review'){info.annotations.push({type:'qa-review',description:check.options.instructions});test.skip();}
  const attach=async(name,data)=>{
   const safe=String(name).replace(/[^a-zA-Z0-9-]/g,'-').slice(0,64)||'evidence';
   if(data?.body!==undefined&&data?.contentType){const file=info.outputPath(safe+(data.contentType==='image/png'?'.png':'.txt'));fs.writeFileSync(file,data.body);await info.attach(name,{path:file,contentType:data.contentType});return;}
   const file=info.outputPath(safe+'.json');fs.writeFileSync(file,JSON.stringify(data,null,2));await info.attach(safe,{path:file,contentType:'application/json'});
  };
  const journal=createEvidence({runDir:ctx.runDir,check,config:ctx.config});
  const cancellation=cancellationSignal(ctx.runDir);
  try{
   checkCancellation(ctx.runDir);
   const evidence=await runCheck({check,config:ctx.config,requestFactory,browser,token:'qa-'+ctx.report.runId+'-'+check.id,configDir:ctx.configDir,runDir:ctx.runDir,attach,record:journal.record,signal:cancellation.signal});
   journal.record({phase:'complete',passed:true});
   await attach('extended-result',journal.clean(evidence));
  }catch(error){
   journal.record({phase:'failure',passed:false,error});
   error.message=journal.clean(error.message);
   if(error.stack)error.stack=journal.clean(error.stack);
   for(const field of ['actual','expected','cause','qaEvidence'])if(error[field]!==undefined)error[field]=journal.clean(error[field]);
   throw error;
  }finally{
   cancellation.dispose();
   await attach('extended-evidence',journal.summary());
   await info.attach('step-journal',{path:journal.file,contentType:'application/x-ndjson'});
  }
 });
}
