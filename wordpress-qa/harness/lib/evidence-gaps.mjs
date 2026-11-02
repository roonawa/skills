// AI may describe missing evidence, but cannot create observations or scores.
export const gapVersion=2;
const axes=['impact','conditions','scope'];
const kinds=['accessibility','javascript','metadata','other'];
const categories=['evidence-insufficient','evidence-missing','evidence-limit','rule-unsupported'];
export function evidenceGapInput(exam,config){
 const pending=exam.issues.filter(i=>i.certainty==='pending');
 return pending.map((i,index)=>({
  index,kind:kinds.includes(i.kind)?i.kind:'other',category:categories.includes(i.pendingCategory)?i.pendingCategory:'evidence-insufficient',
  cases:i.cases.map((c,n)=>{
   const check=(config.checks??[]).find(x=>'check.'+x.id===c.id);
   const rerunPermitted=(c.id.startsWith('axe.')&&(config.visuals??[]).some(v=>'axe.'+v.id===c.id))||!!(check&&['metadata','navigation'].includes(check.kind));
   return {ref:n,rerunPermitted,evidenceCount:Object.values(c.evidenceState??{}).filter(v=>v.available).length,missingCount:Object.values(c.evidenceState??{}).filter(v=>!v.available).length,
    observations:(c.observations??[]).filter(o=>o.key===i.key&&c.evidenceState?.[o.file]?.available).map(o=>({type:['measured-impact','metadata','accessibility','contact-retry-blocked','contact-feedback'].includes(o.category)?o.category:'other',...(Number.isSafeInteger(o.nodes)?{nodes:o.nodes}:{})}))};
  })
 }));
}
export function validateGapPlans(raw,input,issues){
 if(!raw||Object.keys(raw).join(',')!=='plans'||!Array.isArray(raw.plans)||raw.plans.length!==input.length)throw Error('不足証拠の全項目に回答が必要です');
 const seen=new Set();return raw.plans.map(p=>{
  const allowed=['index','missingAxes','reason','verification','caseRefs'];
  const entry=input.find(x=>x.index===p?.index);
  if(!entry||seen.has(p.index)||Object.keys(p).some(k=>!allowed.includes(k))||allowed.some(k=>!(k in p)))throw Error('不足証拠の参照が不正です');
  seen.add(p.index);
  if(!Array.isArray(p.missingAxes)||!p.missingAxes.length||new Set(p.missingAxes).size!==p.missingAxes.length||p.missingAxes.some(a=>!axes.includes(a))||[p.reason,p.verification].some(s=>typeof s!=='string'||s.trim().length<10||s.length>2000))throw Error('不足証拠の説明が不正です');
  if(!Array.isArray(p.caseRefs)||new Set(p.caseRefs).size!==p.caseRefs.length||p.caseRefs.some(ref=>!Number.isInteger(ref)||!entry.cases.some(c=>c.ref===ref&&c.rerunPermitted)))throw Error('許可されていない追加検査です');
  const issue=issues[p.index];if(!issue)throw Error('課題が存在しません');
  return {issueId:issue.id,missingAxes:p.missingAxes,reason:p.reason,verification:p.verification,caseIds:p.caseRefs.map(ref=>issue.cases[ref].id),status:p.caseRefs.length?'recheck-available':'review-required',source:'claude',observed:false};
 });
}
export const gapSchema={type:'object',additionalProperties:false,required:['plans'],properties:{plans:{type:'array',items:{type:'object',additionalProperties:false,required:['index','missingAxes','reason','verification','caseRefs'],properties:{index:{type:'integer'},missingAxes:{type:'array',items:{type:'string',enum:axes}},reason:{type:'string'},verification:{type:'string'},caseRefs:{type:'array',items:{type:'integer'}}}}}}};
export function attachGapPlans(exam,record){
 if(record?.fingerprint!==exam.fingerprint||record?.version!==gapVersion||record.examVersion!==(exam.version??null))return exam;
 return {...exam,evidenceCompletion:record,issues:exam.issues.map(i=>({...i,evidenceGap:i.certainty==='pending'?record.plans?.find(p=>p.issueId===i.id):undefined}))};
}
