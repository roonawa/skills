import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
const ID=/^h-[a-z0-9]+-[a-f0-9]{8}$/,KEEP=20;
const isLink=p=>{try{return fs.lstatSync(p).isSymbolicLink();}catch{return false;}};
const readRec=file=>{try{const r=JSON.parse(fs.readFileSync(file,'utf8'));return r&&typeof r.handoffId==='string'&&Number.isFinite(Date.parse(r.createdAt))?r:null;}catch{return null;}};
const files=dir=>{try{return fs.readdirSync(dir).filter(f=>ID.test(f.replace(/\.json$/,''))&&f.endsWith('.json'));}catch{return [];}};
export const handoffDir=outputDir=>path.join(path.dirname(outputDir),'handoffs');
export const newHandoffId=()=>'h-'+Date.now().toString(36)+'-'+randomBytes(4).toString('hex');
export function saveHandoff(dir,record) {
  if(!ID.test(String(record?.handoffId)))throw new Error('引き継ぎIDの形式が正しくありません。');
  if(isLink(dir))throw new Error('引き継ぎ記録の保存先がシンボリックリンクのため保存しません。');
  fs.mkdirSync(dir,{recursive:true});
  const target=path.join(dir,`${record.handoffId}.json`);
  if(isLink(target))throw new Error('引き継ぎ記録のファイルがシンボリックリンクのため保存しません。');
  const pending=path.join(dir,`${record.handoffId}.${process.pid}.tmp`);
  fs.writeFileSync(pending,JSON.stringify(record,null,2));
  for(let attempt=0;;attempt++) {
    try{fs.renameSync(pending,target);break;}
    catch(error){
      if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=9){fs.rmSync(pending,{force:true});throw error;}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);
    }
  }
  const all=files(dir).map(f=>({f,t:Date.parse(readRec(path.join(dir,f))?.createdAt)||0})).sort((a,b)=>b.t-a.t||(a.f<b.f?1:-1));
  for(const {f} of all.slice(KEEP))if(!isLink(path.join(dir,f)))fs.rmSync(path.join(dir,f),{force:true});
}
export function latestHandoff(dir) {
  if(isLink(dir))return null;
  let best=null;
  for(const f of files(dir)){const p=path.join(dir,f);if(isLink(p))continue;const r=readRec(p);if(r&&(!best||Date.parse(r.createdAt)>Date.parse(best.createdAt)))best=r;}
  return best;
}
