// Shared by the browser and report generation. Counts always refer to rows,
// never to the number of findings or their presentation groups.
export function isRouteDisposalError(message=''){
 const text=String(message).replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
 return /apiResponse\.dispose: Target page, context or browser has been closed/.test(text)
  && /while running route callback/.test(text)
  && !/AssertionError|Expected:|Received:|expect\(/.test(text);
}
export function isToolExecutionFailure(row){
 return ['fail','blocked'].includes(row.status)&&(row.failureOrigin==='tool'||(row.failureOrigin!=='mixed'&&isRouteDisposalError(row.reason)));
}
export function resultStatus(row){
 if(row.status==='not_applicable'||row.autoNotApplicable)return 'not_applicable';
 if(row.preparationRequired)return 'preparation';
 if(row.active)return 'running';
 if(isToolExecutionFailure(row))return 'blocked';
 return row.level==='caution'&&row.status==='fail'?'caution':row.status;
}
export function countResults(rows=[]){
 const counts=Object.fromEntries(['pass','fail','caution','blocked','review','not_run','preparation','not_applicable','running'].map(s=>[s,0]));
 for(const row of rows){const status=resultStatus(row);if(Object.hasOwn(counts,status))counts[status]++;}
 counts.unverified=counts.blocked+counts.review+counts.not_run+counts.preparation;
 return counts;
}
export function executionScope(report={}){
 const rows=report.rows??[],explicit=Array.isArray(report.selection?.ids)&&report.selection.ids.length>0;
 const count=explicit?new Set(report.selection.ids).size:rows.filter(r=>r.selected===true).length;
 const omitted=rows.some(r=>r.selected===false&&!r.manualReview&&!r.preparationRequired&&!r.autoNotApplicable&&r.status!=='not_applicable');
 return {partial:explicit||(!report.aggregation&&count>0&&omitted),count,parentRunId:report.selection?.parentRunId??null,explicit};
}
