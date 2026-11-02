import {displayStatus} from './results.mjs';
// A read-only index. Evidence and assessments remain in their original runs.
export function latestResults(planned,configHash,reports){
 const selected=new Map(),eligible=reports.filter(r=>r.configHash===configHash&&r.runStatus==='finished'&&r.finishedAt&&!r.sourceRuns);
 eligible.sort((a,b)=>String(b.startedAt??b.finishedAt).localeCompare(String(a.startedAt??a.finishedAt))||String(b.runId).localeCompare(String(a.runId)));
 for(const report of eligible)for(const row of report.rows??[]){
  if(selected.has(row.id)||row.sourceRunId||!['pass','fail','blocked','review','not_applicable'].includes(row.status))continue;
  // Not selected automated rows are catalogue placeholders, not new observations.
  if(row.selected===false&&!row.manualReview)continue;
  selected.set(row.id,{id:row.id,status:row.status,...(row.level?{level:row.level}:{}),sourceRunId:report.runId,checkedAt:report.finishedAt});
 }
 const rows=planned.map(row=>({id:row.id,title:row.title,suite:row.suite,status:row.preparationRequired?'preparation':'not_run',...selected.get(row.id)}));
 const counts={};for(const row of rows){const s=displayStatus(row);counts[s]=(counts[s]??0)+1;}
 return {configHash,rows,counts,compatibleRuns:eligible.length,excludedRuns:reports.length-eligible.length};
}
