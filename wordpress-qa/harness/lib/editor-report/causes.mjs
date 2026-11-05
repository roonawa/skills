import {displayStatus} from '../results.mjs';

export const CATEGORIES=['editor','admin','tech','not-site','unverified','not-applicable'];
const ANSI=/\x1b\[[0-9;]*[A-Za-z]/g;
const DISPLAY_PREFIX=/^(layout|javascript|snapshot|axe)\./;
const MAX_PROBES=3;
const text=row=>String(row.reason??'').replace(ANSI,'');
const uniq=(v,i,a)=>a.indexOf(v)===i;
const probes=(kind,values,key='path')=>values.filter(Boolean).filter(uniq).slice(0,MAX_PROBES).map(v=>({kind,[key]:v}));
// Page path of a row, taken from the run config (page.<id>, links.<id>, <display>.<visualId>).
function pagePath(row,config){
  const [prefix,...rest]=row.id.split('.'),id=rest.join('.');
  const pageId=prefix==='page'||prefix==='links'?id:(config?.visuals??[]).find(v=>v.id===id)?.pageId;
  return (config?.pages??[]).find(p=>p.id===pageId)?.path??null;
}
function failedLinks(row,readEvidence){
  for(const file of row.evidence??[]){
    let data;try{data=readEvidence?.(file);}catch{continue;}
    const list=Array.isArray(data)?data:data?.links;
    if(Array.isArray(list)){const bad=list.filter(l=>l?.url&&l.status>=400).map(l=>l.url);if(bad.length) return bad;}
  }
  return [];
}

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
    const r=f.range??{},unfixed=r.unfixed==='1';
    return {name:f.asset?.name??f.asset?.slug??'',version:f.asset?.version??'',cves:[...(f.cves??[])],
      fixedIn:!unfixed&&r.max_operator==='lt'&&r.max_version?String(r.max_version):null,unfixed,closed:r.closed==='1'};
  });
  return {plugins};
}

// AI に渡すのは理由の種類だけ。元の理由の文（ページの本文の抜粋を含みうる）は根拠のファイルにだけ残す。
const KINDS=['page','links','layout','axe','javascript','snapshot','journey','check','admin'];
const ERROR_CLASSES=[['timeout',/Timeout \d+ms|timed? ?out/i],['accessibility',/\baxe\b|violation|wcag|accessib/i],['javascript',/pageerror|ReferenceError|TypeError|SyntaxError|console error|javascript/i],
  ['status',/Received:\s*[1-5]\d\d\b|\bHTTP\s*[1-5]\d\d\b|\bstatus\b/i],['missing-element',/not found|toBeVisible|toHaveCount|waiting for (?:locator|selector)|no element/i],['assertion',/expect\(|Expected|Received|AssertionError|toHave|toBe|toEqual|toMatch/]];
export function reasonKind(row){
  const prefix=String(row.id).split('.')[0],reason=text(row);
  const kind=KINDS.includes(prefix)?prefix:'other';
  return {kind,errorClass:kind==='axe'?'accessibility':ERROR_CLASSES.find(([,re])=>re.test(reason))?.[0]??'other'};
}

function factsAndProbes(rule,rows,{environment,config,readEvidence}){
  const paths=rs=>rs.map(r=>pagePath(r,config));
  switch(rule){
    case 'index-expectation': return {facts:{environment:environment??null,pageCount:rows.filter(r=>r.id.startsWith('page.')).length,adminSetting:rows.some(r=>r.id==='admin.indexing')},probes:probes('page',paths(rows.filter(r=>r.id.startsWith('page.'))))};
    case 'render-timeout': return {facts:{environment:environment??null},probes:probes('images',paths(rows))};
    case 'link-transient': {
      const urls=rows.flatMap(r=>failedLinks(r,readEvidence));
      return {facts:{},probes:urls.length?probes('link',urls,'url'):probes('page',paths(rows))};
    }
    case 'soft-404': return {facts:{},probes:[{kind:'missing-page'}]};
    case 'sitemap-format': return {facts:{},probes:[{kind:'sitemap'}]};
    case 'plugin-vulnerability': return {facts:pluginFacts(rows[0]),probes:[]};
    case 'unclassified': return {facts:{reasonKinds:rows.map(reasonKind)},probes:[],basis:{reasons:rows.map(text)}};
    default: return {facts:{},probes:[]};
  }
}

export function groupRows(report,options={}){
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
    const {facts,probes,basis}=factsAndProbes(rule,rows,options);
    groups.push({id:key.replace(/[^A-Za-z0-9._:-]/g,'_'),rule,rowIds:rows.map(r=>r.id),status,category,facts,probes,...(basis?{basis}:{})});
  }
  const count=s=>groups.filter(g=>g.status===s).reduce((n,g)=>n+g.rowIds.length,0);
  return {groups,counts:{fail:count('fail'),caution:count('caution'),unverified:count('unverified'),notApplicable:count('not-applicable')}};
}
