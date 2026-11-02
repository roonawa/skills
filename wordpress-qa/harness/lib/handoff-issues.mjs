import {displayStatus} from './results.mjs';
import {RULES} from './security-baseline-rules.mjs';
import {evidenceUrls} from './issue-report.mjs';

const KEEP=/^(baseline|security|setting):/;
// 実行ごとに変わる部分（クエリ・UUID・日時・16進・数字）を除き、同じ問題を同じキーにする。baseline:/security:/setting: はパスやIDが識別子なので変えない。
export const normalizeKey=key=>KEEP.test(key)?key:String(key).replace(/\?\S*/g,'?…').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,'<uuid>').replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?/g,'<time>').replace(/[0-9a-f]{8,}/gi,'<hex>').replace(/\d{3,}/g,'<n>');
export const issueKey=(row,failure)=>row.id+'|'+normalizeKey(failure.key);
export const isConfirmed=row=>['pass','fail'].includes(row.status)&&!row.preparationRequired;
export const unconfirmedCount=report=>(report.rows??[]).filter(r=>!isConfirmed(r)&&!(r.status==='not_run'&&!r.preparationRequired)).length;
export function collectIssues({report,readEvidence}){
  const out=new Map();
  for(const row of report.rows??[]){
    const level=displayStatus(row);if(level!=='fail'&&level!=='caution')continue;
    for(const f of row.failures??[]){
      const m=/^baseline:([^:]+):(.*)$/s.exec(f.key??'');
      let urls;
      if(m){try{urls=[new URL(m[2],report.baseURL).href];}catch{urls=[];}}
      else urls=evidenceUrls({row,run:report,readEvidence});
      const key=issueKey(row,f),old=out.get(key);
      if(old){old.urls=[...new Set([...old.urls,...urls])];continue;}
      out.set(key,{key,rawKey:f.key,rowId:row.id,rowTitle:row.title,level,owner:m?RULES[m[1]]?.owner??'unknown':'unknown',urls,title:f.title,actual:f.actual,admin:f.admin,code:f.code,verify:f.verify});
    }
  }
  return [...out.values()];
}
