import fs from 'node:fs';
import path from 'node:path';
import {buildIssueReport} from './issue-report.mjs';

const JSON_LIMIT=16*1024*1024;
const IMAGE_LIMIT=12*1024*1024;
const TOTAL_LIMIT=64*1024*1024;

// Offline only: results are authoritative; context supplies reproduction settings.
// Missing optional evidence is handled by the builder, unsafe paths are fatal.
export function autoReport(runDir){
  const root=fs.realpathSync(runDir);
  let bytesRead=0;
  const boundedPath=file=>{
    if(typeof file!=='string'||!file||/[\\:\0]/.test(file)||path.posix.isAbsolute(file)||file.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Unsafe report path');
    let target=root;
    for(const part of file.split('/')){
      target=path.join(target,part);
      try{if(fs.lstatSync(target).isSymbolicLink())throw new Error('Unsafe report path: symbolic link');}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    return target;
  };
  const read=(file,limit)=>{
    const fd=fs.openSync(boundedPath(file),'r');
    try{
      const stat=fs.fstatSync(fd);
      if(!stat.isFile())throw new Error('Report input is not a file');
      if(stat.size>limit)throw new Error('Report input too large');
      if(bytesRead+stat.size>TOTAL_LIMIT)throw new Error('Report inputs too large');
      // A bounded read also protects against files growing after stat.
      const buffer=Buffer.alloc(Math.min(limit,TOTAL_LIMIT-bytesRead)+1);
      let length=0,n;
      while(length<buffer.length&&(n=fs.readSync(fd,buffer,length,buffer.length-length,null))>0)length+=n;
      bytesRead+=length;
      if(length>limit||bytesRead>TOTAL_LIMIT)throw new Error('Report input too large');
      return buffer.subarray(0,length);
    }finally{fs.closeSync(fd);}
  };
  const readJSON=file=>JSON.parse(read(file,JSON_LIMIT).toString('utf8'));
  const current=readJSON('results.json');
  if(current.runStatus!=='finished'||!current.finishedAt||current.rows?.some(row=>row.active))throw new Error('Run must be finished before generating a report');
  if(typeof current.runId!=='string'||!current.runId||!Array.isArray(current.rows))throw new Error('Invalid report results');
  const context=readJSON('context.json');
  if(!current.configHash||context.configHash!==current.configHash||!context.config)throw new Error('Config mismatch');
  const registered=new Set();
  for(const row of current.rows){
    if(row.evidence!==undefined&&!Array.isArray(row.evidence))throw new Error('Invalid row evidence');
    for(const file of row.evidence??[]){boundedPath(file);registered.add(file);}
  }
  const checkRun=runId=>{if(runId!==current.runId)throw new Error('Unregistered run');};
  const checkEvidence=(runId,file)=>{
    checkRun(runId);
    if(!registered.has(file))throw new Error('Unregistered evidence');
  };
  const output=boundedPath('issue-report.html');
  const generated=buildIssueReport({
    current,previous:[],includeHistory:false,
    readEvidence:(runId,file)=>{checkEvidence(runId,file);return readJSON(file);},
    readImage:(runId,file)=>{
      checkEvidence(runId,file);
      if(!file.endsWith('.png'))throw new Error('Invalid PNG path');
      const buffer=read(file,IMAGE_LIMIT);
      if(buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Invalid PNG');
      return `data:image/png;base64,${buffer.toString('base64')}`;
    },
    readConfig:runId=>{
      checkRun(runId);
      const {pages,visuals,policies}=context.config;
      return {pages,visuals,policies};
    }
  });
  if(Buffer.byteLength(generated.html)>TOTAL_LIMIT)throw new Error('Report output too large');
  // Recheck the destination before replacing an existing report.
  boundedPath('issue-report.html');
  fs.writeFileSync(output,generated.html,'utf8');
  const {html,...summary}=generated;
  return {file:'issue-report.html',...summary};
}
