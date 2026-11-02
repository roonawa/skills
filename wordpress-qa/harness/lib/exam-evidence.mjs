import {configuredLocation,elementLocation} from './problem-locations.mjs';
import {evidenceObservations} from './automatic-assessment.mjs';
import {reproduction} from './issue-report.mjs';
import {createHash} from 'node:crypto';
// The caller resolves registered paths within the run and rejects symlinks.
export function collectExamEvidence(report,read){
 const copy=structuredClone(report),cache=new Map();let total=0;
 const get=file=>{if(cache.has(file))return cache.get(file);let item={available:false,reason:'unreadable'};try{const bytes=read(file);if(!Buffer.isBuffer(bytes))throw Error();if(bytes.length>8*1024*1024){item.reason='file-limit';throw Error();}if(total+bytes.length>64*1024*1024){item.reason='budget-limit';throw Error();}total+=bytes.length;item={available:true,digest:createHash('sha256').update(bytes).digest('hex'),bytes};}catch{}cache.set(file,item);return item;};
 let config={};try{const ctx=get('context.json');const parsed=JSON.parse(ctx.bytes.toString('utf8'));if(parsed.configHash===report.configHash){config=parsed.config??{};copy.examContextDigest=ctx.digest;}}catch{}
 // Reserve the evidence budget for structured observations before images/traces.
 for(const row of copy.rows)for(const file of row.evidence??[])if(/\.(json|jsonl|txt)$/.test(file))get(file);
 for(const row of copy.rows){
  row.customerRepro={};row.customerLocations={};const fallback=configuredLocation(row,config,report.baseURL);
  for(const failure of row.failures??[])row.customerLocations[failure.key]=[{...fallback,element:failure.key.startsWith('javascript:')?'JavaScript例外（画面内の原因要素は未特定）':'画面内の箇所は未特定'}];
  for(const f of row.failures??[]){const kind=f.key.startsWith('axe:')?f.key.slice(4):f.key.startsWith('javascript:')?'javascript':row.id.split('.')[0];const r=reproduction({row:{...row,reason:''},run:report},kind,config);
   const safe=text=>String(text).replace(/https?:\/\/[^\s]+/g,url=>{try{const u=new URL(url);return u.origin+u.pathname;}catch{return '[URL]';}});
   row.customerRepro[f.key]={steps:[safe(r.condition),...r.steps.map(safe)],expected:safe(r.expected)};
  }
  row.evidenceState={};row.customerImages=[];row.assessmentObservations=[];
  for(const file of row.evidence??[]){const {bytes,...state}=get(file);row.evidenceState[file]=state;if(state.available&&/(?:^|\/)(?:impact|audit|axe|.*discovered-json|.*discovered)(?:-[^/]*)?\.(?:json|txt)$/.test(file))try{row.assessmentObservations.push(...evidenceObservations(JSON.parse(bytes.toString('utf8')),file));}catch{}}
  for(const file of row.evidence??[])if(/(?:^|\/)axe(?:-[^/]*)?\.json$/.test(file))try{const data=JSON.parse(get(file).bytes.toString('utf8'));for(const v of data.violations??[]){const key='axe:'+v.id;if(!row.customerLocations[key])continue;row.customerLocations[key]=(v.nodes??[]).slice(0,100).map(node=>elementLocation({rule:v.id,html:node.html,url:data.url,target:node.target},report.baseURL,fallback));}}catch{}
  for(const file of (row.evidence??[]).filter(f=>/marked-screenshots[^/]*\.json$/.test(f)).slice(0,4)){
   try{const data=JSON.parse(get(file).bytes.toString('utf8'));
    for(const shot of (data.shots??[]).slice(0,1000)){
     if(shot.status!=='captured'||!/^[-\w]{1,100}$/.test(shot.id??''))continue;
     const matches=(row.evidence??[]).filter(f=>{const n=f.split('/').at(-1);return n===shot.id+'.png'||n.startsWith(shot.id+'-')&&n.endsWith('.png');});
     if(matches.length!==1)continue;const asset=get(matches[0]);
     if(!asset.available||asset.bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')continue;
     const key='axe:'+shot.rule;if((row.failures??[]).some(f=>f.key===key)){const location=elementLocation(shot,report.baseURL,fallback),list=row.customerLocations[key];const index=list.findIndex(l=>location.ref&&l.ref===location.ref);if(index>=0)list.splice(index,1);else if(list.length===1&&!list[0].finding)list.length=0;list.push({...location,imageFile:matches[0]});}
     if(!row.customerImages.some(i=>i.file===matches[0]))row.customerImages.push({file:matches[0],rule:shot.rule,caption:'検出した対象箇所を赤枠で表示（検査後の撮影）',capturedAt:typeof shot.capturedAt==='string'?shot.capturedAt:''});
    }
   }catch{}
  }
 }
 return {report:copy,image:file=>{const a=cache.get(file);return a?.available&&a.bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'data:image/png;base64,'+a.bytes.toString('base64'):null;}};
}
