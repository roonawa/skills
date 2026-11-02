import fs from 'node:fs';
import path from 'node:path';
const lockName='.qa-active-run.json';
export function processAlive(pid) {
  if(!Number.isInteger(pid)||pid<=0)return false;
  try {process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}
}
export function ownershipAlive(owner) {
  if(owner?.ended)return false;
  return processAlive(owner?.parentPid)||processAlive(owner?.workerPid)||(owner?.phase==='spawning'&&!owner?.workerPid);
}
function read(file) {try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;return {phase:'spawning'};}}
export function runIsAlive(runDir) {return ownershipAlive(read(path.join(runDir,'run-owner.json')));}
export function projectIsAlive(outputDir) {
  if(ownershipAlive(read(path.join(outputDir,lockName))))return true;
  if(!fs.existsSync(outputDir))return false;
  return fs.readdirSync(outputDir,{withFileTypes:true}).some(entry=>entry.isDirectory()&&runIsAlive(path.join(outputDir,entry.name)));
}
export function acquireRunLock(outputDir,runDir) {
  fs.mkdirSync(outputDir,{recursive:true});
  const lock=path.join(outputDir,lockName),ownerFile=path.join(runDir,'run-owner.json');
  // Serialize stale-lock replacement too; two contenders must never both unlink
  // an old lock and accidentally overwrite the other's fresh ownership.
  const claim=path.join(outputDir,'.qa-run-claim');
  try {fs.writeFileSync(claim,String(process.pid),{flag:'wx'});}catch{throw new Error('BLOCKED: runner ownership is being acquired; retry after it finishes');}
  let owner;
  try {
  if(projectIsAlive(outputDir))throw new Error('BLOCKED: another runner may still be alive; wait for it to finish');
  const old=read(lock);
  if(old)fs.unlinkSync(lock);
  owner={parentPid:process.pid,workerPid:null,runDir,phase:'starting',createdAt:new Date().toISOString()};
  fs.writeFileSync(lock,JSON.stringify(owner),{flag:'wx'});
  fs.writeFileSync(ownerFile,JSON.stringify(owner));
  }finally{fs.unlinkSync(claim);}
  const save=()=>{fs.writeFileSync(lock,JSON.stringify(owner));fs.writeFileSync(ownerFile,JSON.stringify(owner));};
  return {
    spawning(){owner.phase='spawning';save();},
    worker(pid){owner.workerPid=pid;owner.phase='running';save();},
    finish(){owner.ended=true;owner.phase='ended';save();},
  };
}
