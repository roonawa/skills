import fs from 'node:fs';
import path from 'node:path';
export const cancellationRequested=runDir=>fs.existsSync(path.join(runDir,'cancel.request.json'));
export function checkCancellation(runDir){if(cancellationRequested(runDir))throw new Error('BLOCKED: execution cancelled by operator');}
export function cancellationSignal(runDir){
 const controller=new AbortController();
 const check=()=>{if(cancellationRequested(runDir)&&!controller.signal.aborted)controller.abort(new Error('BLOCKED: execution cancelled by operator'));};
 check();const timer=setInterval(check,150);timer.unref();
 return {signal:controller.signal,dispose:()=>clearInterval(timer)};
}
