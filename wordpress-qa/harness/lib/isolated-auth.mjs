export function isolatedAuthOnly(context){
 const rows=context.report.rows.filter(r=>r.selected);
 return rows.length>0&&rows.every(r=>r.suite==='admin'||context.config.journeys?.some(j=>'journey.'+j.id===r.id&&j.handlesAuthentication===true));
}
