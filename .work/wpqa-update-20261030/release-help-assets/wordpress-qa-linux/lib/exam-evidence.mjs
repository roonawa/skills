import {reproduction} from './issue-report.mjs';
import {createHash} from 'node:crypto';
// The caller resolves registered paths within the run and rejects symlinks.
export function collectExamEvidence(report,read){
 const copy=structuredClone(report),cache=new Map();let total=0;
 const get=file=>{if(cache.has(file))return cache.get(file);let item={available:false};try{const bytes=read(file);if(!Buffer.isBuffer(bytes)||bytes.length>8*1024*1024||total+bytes.length>64*1024*1024)throw Error();total+=bytes.length;item={available:true,digest:createHash('sha256').update(bytes).digest('hex'),bytes};}catch{}cache.set(file,item);return item;};
 let config={};try{const ctx=get('context.json');const parsed=JSON.parse(ctx.bytes.toString('utf8'));if(parsed.configHash===report.configHash){config=parsed.config??{};copy.examContextDigest=ctx.digest;}}catch{}
 for(const row of copy.rows){
  row.customerRepro={};
  for(const f of row.failures??[]){const kind=f.key.startsWith('axe:')?f.key.slice(4):f.key.startsWith('javascript:')?'javascript':row.id.split('.')[0];const r=reproduction({row:{...row,reason:''},run:report},kind,config);
   const safe=text=>String(text).replace(/https?:\/\/[^\s]+/g,url=>{try{const u=new URL(url);return u.origin+u.pathname;}catch{return '[URL]';}});
   row.customerRepro[f.key]={steps:[safe(r.condition),...r.steps.map(safe)],expected:safe(r.expected)};
  }
  row.evidenceState={};row.customerImages=[];
  for(const file of row.evidence??[]){const {bytes,...state}=get(file);row.evidenceState[file]=state;}
  for(const file of (row.evidence??[]).filter(f=>/marked-screenshots[^/]*\.json$/.test(f)).slice(0,4)){
   try{const data=JSON.parse(get(file).bytes.toString('utf8'));
    for(const shot of (data.shots??[]).slice(0,1000)){
     if(shot.status!=='captured'||!/^[-\w]{1,100}$/.test(shot.id??''))continue;
     const matches=(row.evidence??[]).filter(f=>{const n=f.split('/').at(-1);return n===shot.id+'.png'||n.startsWith(shot.id+'-')&&n.endsWith('.png');});
     if(matches.length!==1)continue;const asset=get(matches[0]);
     if(!asset.available||asset.bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')continue;
     if(!row.customerImages.some(i=>i.file===matches[0]))row.customerImages.push({file:matches[0],rule:shot.rule,caption:'検出した対象箇所を赤枠で表示（検査後の撮影）',capturedAt:typeof shot.capturedAt==='string'?shot.capturedAt:''});
    }
   }catch{}
  }
 }
 return {report:copy,image:file=>{const a=cache.get(file);return a?.available&&a.bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'data:image/png;base64,'+a.bytes.toString('base64'):null;}};
}
