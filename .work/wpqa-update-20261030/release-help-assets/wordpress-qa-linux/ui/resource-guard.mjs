import fs from 'node:fs';
import path from 'node:path';
export function checkStorage(directory,maxMB=8192){
  if(!fs.existsSync(directory))return;
  const s=fs.statfsSync(directory);if(s.bavail*s.bsize<512*1024*1024)throw Object.assign(Error('保存先の空き容量が不足しています。管理者に履歴の整理を依頼してください'),{status:507});
  let bytes=0,count=0;const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(++count>100000)throw Error('保存ファイル数の上限に達しました');if(e.isSymbolicLink())continue;const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else bytes+=fs.statSync(file).size;if(bytes>maxMB*1024*1024)throw Object.assign(Error('保存容量の上限に達しました。管理者に履歴の整理を依頼してください'),{status:507});}};walk(directory);
}
export function auditAppend(file,event){
  if(fs.existsSync(file)&&fs.statSync(file).size>10*1024*1024){if(fs.existsSync(file+'.3'))fs.unlinkSync(file+'.3');for(let i=2;i>=1;i--)if(fs.existsSync(file+'.'+i))fs.renameSync(file+'.'+i,file+'.'+(i+1));fs.renameSync(file,file+'.1');}
  fs.appendFileSync(file,JSON.stringify(event)+'\n',{mode:0o600});
}
