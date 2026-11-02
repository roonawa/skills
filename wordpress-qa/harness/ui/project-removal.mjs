import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Only UI-managed, site-owned paths are eligible. Never use client-supplied paths.
export function deletionPlan(store,id){
 const root=fs.realpathSync(store.directory),record=store.file(id),directory=path.join(root,id);
 if(path.dirname(record)!==path.resolve(store.directory))throw Error('削除先が保存先の範囲外です');
 const targets=[record,record+'.tmp',directory],entries=[];let bytes=0,files=0,runs=0;
 const visit=p=>{
  if(!fs.existsSync(p))return;
  const stat=fs.lstatSync(p);
  if(stat.isSymbolicLink())throw Error('リンクを含む保存先は完全削除できません。管理担当者に確認してください');
  const real=fs.realpathSync(p);if(!real.startsWith(root+path.sep))throw Error('削除先が保存先の範囲外です');
  entries.push([path.relative(root,p),stat.size,stat.mtimeMs,stat.isDirectory()]);
  if(stat.isDirectory()){for(const name of fs.readdirSync(p).sort())visit(path.join(p,name));}
  else {files++;bytes+=stat.size;if(path.basename(p)==='results.json'&&path.basename(path.dirname(path.dirname(p)))==='runs')runs++;}
 };
 for(const target of targets)visit(target);
 const r=store.record(id);
 const owned=path.resolve(store.directory,id);
 if(path.resolve(r.config.outputDir)!==path.join(owned,'runs')||path.resolve(r.config.baselineDir)!==path.join(owned,'baselines'))throw Error('保存先がサイト専用フォルダーと一致しないため完全削除できません');
 return {interrupted:fs.existsSync(path.join(root,'.deletion-'+id+'.json')),name:r.config.name,baseURL:r.config.baseURL,files,bytes,runs,hash:createHash('sha256').update(JSON.stringify(entries)).digest('hex'),targets};
}
export function deleteSiteData(store,id,{name,hash}){
 const plan=deletionPlan(store,id);
 if(name!==plan.name||hash!==plan.hash)throw Error('サイト名が一致しないか、削除対象が変わりました。削除内容を再確認してください');
 const marker=path.join(fs.realpathSync(store.directory),'.deletion-'+id+'.json');
 if(fs.existsSync(marker)&&fs.lstatSync(marker).isSymbolicLink())throw Error('削除履歴の保存先が不正です');
 fs.writeFileSync(marker,JSON.stringify({id,startedAt:new Date().toISOString(),state:'in-progress'}),{mode:0o600});
 // The exact absolute paths above have been checked against the managed root.
 // Remove the record last so a failed cleanup remains available for retry.
 for(const target of [...plan.targets].reverse())fs.rmSync(target,{recursive:target===plan.targets[2],force:true});
 fs.unlinkSync(marker);
}
