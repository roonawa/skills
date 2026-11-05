import {displayStatus} from '../results.mjs';

export const CATEGORIES=['editor','admin','tech','not-site','unverified','not-applicable'];
const ANSI=/\x1b\[[0-9;]*[A-Za-z]/g;
const DISPLAY_PREFIX=/^(layout|javascript|snapshot|axe)\./;
const MAX_PROBES=3;
const flag=v=>!!v&&!['0','false','no'].includes(String(v).toLowerCase());
const text=row=>String(row.reason??'').replace(ANSI,'');
const pathOf=row=>row.path??row.url??row.details?.path??row.details?.url??null;
const probesFor=(rows,kind,key='path')=>rows.map(pathOf).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).slice(0,MAX_PROBES).map(v=>({kind,[key]:v}));

// Per-row rule match for failed/caution rows; null means no catalog rule applies.
function ruleOf(row){
  const reason=text(row);
  if(row.id==='check.security-plugin'||row.softwareSecurity?.findings?.length) return 'plugin-vulnerability';
  if(row.id==='check.security-compatibility') return 'compatibility';
  if(row.id==='check.auto-security-headers') return 'security-headers';
  if(row.id==='check.auto-security-disclosure') return 'disclosure';
  if(/unknown URL must return 404/.test(reason)||row.id==='check.auto-security-404') return 'soft-404';
  if(/indexable differs from expectation/.test(reason)) return 'index-expectation';
  if(DISPLAY_PREFIX.test(row.id)&&/Timeout \d+ms exceeded/.test(reason)) return 'render-timeout';
  if(/^links\./.test(row.id)&&/Received:\s*50[23]\b/.test(reason)) return 'link-transient';
  if(/malformed sitemap XML/i.test(reason)) return 'sitemap-format';
  return null;
}
// Provisional category before the live re-check (Task 3 finalizes it).
const PROVISIONAL={'index-expectation':'not-site','render-timeout':'not-site','link-transient':'not-site','soft-404':'admin','sitemap-format':'not-site','plugin-vulnerability':'admin',compatibility:'tech','security-headers':'tech',disclosure:'tech',unclassified:'tech'};

function pluginFacts(row){
  const plugins=(row.softwareSecurity?.findings??[]).map(f=>{
    const r=f.range??{};
    const unfixed=flag(r.unfixed);
    return {name:f.asset?.name??f.asset?.slug??'',version:f.asset?.version??'',cves:[...(f.cves??[])],
      fixedIn:!unfixed&&r.max_version&&r.max_operator==='<'?String(r.max_version):null,closed:flag(r.closed)};
  });
  return {plugins};
}

function factsAndProbes(rule,rows,environment){
  switch(rule){
    case 'index-expectation': return {facts:{environment:environment??null,pageCount:rows.filter(r=>r.id.startsWith('page.')).length,adminSetting:rows.some(r=>r.id==='admin.indexing')},probes:probesFor(rows.filter(r=>r.id.startsWith('page.')),'page')};
    case 'render-timeout': return {facts:{environment:environment??null},probes:probesFor(rows,'images')};
    case 'link-transient': return {facts:{},probes:probesFor(rows,'link','url')};
    case 'soft-404': return {facts:{},probes:[{kind:'missing-page'}]};
    case 'sitemap-format': return {facts:{},probes:[{kind:'sitemap'}]};
    case 'plugin-vulnerability': return {facts:pluginFacts(rows[0]),probes:[]};
    case 'unclassified': return {facts:{reasons:rows.map(text)},probes:[]};
    default: return {facts:{},probes:[]};
  }
}

export function groupRows(report,{environment}={}){
  const buckets=new Map();
  const put=(key,rule,status,row)=>{if(!buckets.has(key))buckets.set(key,{rule,status,rows:[]});buckets.get(key).rows.push(row);};
  for(const row of report.rows??[]){
    const shown=displayStatus(row);
    if(row.status==='not_applicable'||row.autoNotApplicable) put(`not-applicable:${row.id}`,'not-applicable','not-applicable',row);
    else if(['not_run','blocked','review'].includes(row.status)||row.preparationRequired) put(`unverified:${row.id}`,'unverified','unverified',row);
    else if(shown==='fail'||shown==='caution'){
      const status=shown==='caution'?'caution':'fail';
      const rule=ruleOf(row)??'unclassified';
      // plugin findings are reported per row; every other rule is one group per rule and status
      put(rule==='plugin-vulnerability'?`${rule}:${status}:${row.id}`:`${rule}:${status}`,rule,status,row);
    }
  }
  const groups=[];
  for(const [key,{rule,status,rows}] of buckets){
    const category=status==='unverified'||status==='not-applicable'?status:PROVISIONAL[rule];
    const {facts,probes}=factsAndProbes(rule,rows,environment);
    groups.push({id:key.replace(/[^A-Za-z0-9._:-]/g,'_'),rule,rowIds:rows.map(r=>r.id),status,category,facts,probes});
  }
  const count=s=>groups.filter(g=>g.status===s).reduce((n,g)=>n+g.rowIds.length,0);
  return {groups,counts:{fail:count('fail'),caution:count('caution'),unverified:count('unverified'),notApplicable:count('not-applicable')}};
}
