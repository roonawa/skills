import {isConfirmed} from './handoff-issues.mjs';
const OWNERS=[['admin','管理画面・プラグイン'],['server','サーバー・ホスティング'],['theme','テーマ・開発'],['unknown','担当区分の確認が必要']];
const LEVEL={fail:'不合格',caution:'注意'};
const CLOSING='修正後はSITE EXAMで同じ範囲を再診断し、比較結果をこのタスクに追記してください。',TRUNC_NOTE='全文はSITE EXAMの不具合報告書を参照';
const first=s=>String(s??'').trim().split(/(?<=。)|\n/)[0].trim();
const indent=s=>String(s).trim().replace(/\n/g,'\n　');
const jst=iso=>{const t=Date.parse(iso);return Number.isFinite(t)?new Date(t+9*36e5).toISOString().slice(0,16).replace('T',' '):'未記録';};
export const handoffSubject=({siteName,finishedAt})=>`${String(siteName??'').replace(/\r?\n/g,' ').replace(/[:：]/g,'・').trim()}：SITE EXAM 診断結果の修正（${jst(finishedAt).slice(0,10)}）`;
// 1課題の見出し行と「・」の箇条書き。short=true で状況・直し方・確認方法を最初の1文にする。Task 3 の「新たに発生」でも使う。
export function formatIssueDetail(issue,{short=false,titleOnly=false}={}){
  const head=`［${LEVEL[issue.level]??issue.level}］${issue.title}`;if(titleOnly)return head;
  const t=short?first:s=>String(s??'').trim(),all=issue.urls??[],urls=all.slice(0,5),more=all.length-urls.length;
  const lines=[head,`・対象：${urls.length?indent(urls.join('\n')+(more>0?`\nほか${more}件`:'')):issue.rowTitle??''}`];
  if(issue.actual)lines.push(`・状況：${indent(t(issue.actual))}`);
  if(issue.owner==='unknown'){if(issue.admin)lines.push(`・直し方（管理画面）：${indent(t(issue.admin))}`);if(issue.code)lines.push(`・直し方（技術）：${indent(t(issue.code))}`);}
  else{const fix=issue.owner==='admin'?issue.admin||issue.code:issue.code||issue.admin;if(fix)lines.push(`・直し方：${indent(t(fix))}`);}
  if(issue.verify)lines.push(`・確認方法：${indent(t(issue.verify))}`);
  return lines.join('\n');
}
export function buildHandoffText({report,siteName,issues,excludedKeys=[],unconfirmed,publicOrigin,projectId,clean=s=>s,limit=20000}){
  const ex=new Set(excludedKeys),included=issues.filter(i=>!ex.has(i.key));
  const nf=included.filter(i=>i.level==='fail').length,nc=included.filter(i=>i.level==='caution').length,at=report.finishedAt??report.startedAt;
  // 結果画面には URL で project/run を選ぶ仕組みがないため、トップへのリンクと実行IDを併記する（projectId は将来の深いリンク用）。
  const summary=['【概要】',`・サイトURL：${report.baseURL??''}`,`・環境：${report.environment??''}`,`・実行日時（日本時間）：${jst(at)}`,`・実行ID：${report.runId??''}`,...(publicOrigin?[`・結果画面：${String(publicOrigin).replace(/\/+$/,'')}/`]:[]),`・課題：不合格${nf}件・注意${nc}件`,`・SITE EXAMで未確認の項目：${unconfirmed??0}件`].join('\n');
  const ordered=[];
  for(const [owner,label] of OWNERS){const list=included.filter(i=>owner==='unknown'?!['admin','server','theme'].includes(i.owner):i.owner===owner);if(list.length)ordered.push({label,items:[...list.filter(i=>i.level==='fail'),...list.filter(i=>i.level==='caution')]});}
  const cautions=ordered.flatMap(g=>g.items).filter(i=>i.level==='caution');
  // 縮め方：stage1 注意を最初の1文に、stage2 不合格も1文に、さらに後ろの注意から順に titleCut 件をタイトルのみに。
  const build=(stage,titleCut=0,truncated=false)=>{
    const titleOnly=new Set(titleCut?cautions.slice(-titleCut):[]);
    const sections=ordered.map(g=>[`【${g.label}】`,...g.items.map(i=>formatIssueDetail(i,{short:stage>=2||(stage>=1&&i.level==='caution'),titleOnly:titleOnly.has(i)}))].join('\n\n'));
    // redactor は1回の文字列を16000字で切るため、段落ごとに通す。
    return [summary,...sections,CLOSING,...(truncated?[TRUNC_NOTE]:[])].join('\n\n').split('\n\n').map(clean).join('\n\n');
  };
  let body=build(0),truncated=false;
  if(body.length>limit){
    truncated=true;body=build(1,0,true);
    if(body.length>limit)body=build(2,0,true);
    if(body.length>limit){let lo=0,hi=cautions.length;while(lo<hi){const m=(lo+hi)>>1;if(build(2,m,true).length>limit)lo=m+1;else hi=m;}body=build(2,lo,true);}
    if(body.length>limit)body=body.slice(0,limit-TRUNC_NOTE.length-1)+'\n'+TRUNC_NOTE;
  }
  return {subject:clean(handoffSubject({siteName,finishedAt:at})),body,truncated,included};
}
const ROWKEY=/^(unclassified|timeout):/,CMP_CLOSING='タスクを完了にするかは担当者が判断してください。再確認できずの項目は、条件を整えて再診断が必要です。';
// 前回の引き継ぎ記録と今回の課題を課題キーで突き合わせる。行が今回 pass のときだけ解消にする（2026-11-02 利用者判断で変更）。
export function compareHandoff({record,report,issues}){
  const rows=new Map((report.rows??[]).map(r=>[r.id,r])),cur=new Map(issues.map(i=>[i.key,i])),used=new Set(),out={resolved:[],unresolved:[],unverified:[],added:[],carriedExcluded:[],scopeGap:0};
  const still=(prev,now)=>{used.add(now.key);const urls=now.urls??[];out.unresolved.push({...now,fixedUrlCount:(prev.urls??[]).filter(u=>!urls.includes(u)).length});};
  // 集約で別の実行から写した行は、今回確認したことにならない。
  const pending=[],copied=row=>[row.sourceRunId,row.details?.sourceRunId].some(s=>s&&s!==report.runId);
  for(const prev of record.issues??[]){
    const row=rows.get(prev.rowId);
    if(!row||!isConfirmed(row)||copied(row)){out.unverified.push({...prev,reason:'not-rechecked'});if(cur.has(prev.key))used.add(prev.key);if(!row||(row.status==='not_run'&&!row.preparationRequired))out.scopeGap++;continue;}
    if(cur.has(prev.key))still(prev,cur.get(prev.key));else if(row.status==='pass')out.resolved.push(prev);else pending.push(prev);
  }
  // 行が fail のまま：行単位のキーは文字列が変わっていても未解消。個別のキーが消えていても、同じ検査が別の課題や途中終了で fail のため確認できたとは言えない。
  for(const prev of pending){
    const m=ROWKEY.exec(prev.rawKey??''),now=m&&issues.find(i=>i.rowId===prev.rowId&&!used.has(i.key)&&String(i.rawKey??'').startsWith(m[0]));
    if(now)still(prev,now);else if(m)out.unresolved.push({...prev,fixedUrlCount:0});else out.unverified.push({...prev,reason:'same-check-failing'});
  }
  const ex=new Set(record.excludedKeys??[]);
  for(const i of issues)if(!used.has(i.key))(ex.has(i.key)?out.carriedExcluded:out.added).push(i);
  return out;
}
const urlLine=i=>{const all=i.urls??[],urls=all.slice(0,5),more=all.length-urls.length;return `　対象：${urls.length?(urls.join('\n　')+(more>0?`\n　ほか${more}件`:'')):i.rowTitle??''}`;};
const brief=i=>[`・${formatIssueDetail(i,{titleOnly:true})}`,urlLine(i),...(i.fixedUrlCount>0?[`　前回から${i.fixedUrlCount}件のURLが解消`]:[]),...(i.reason==='same-check-failing'?['　'+SAME_CHECK]:[])].join('\n');
export const SAME_CHECK='（同じ検査に別の課題が残っているため確認できません）';
export function buildCompareText({comparison:c,report,uncheckedAddedKeys=[],clean=s=>s,limit=20000}){
  const off=new Set(uncheckedAddedKeys),added=c.added.filter(i=>!off.has(i.key)),at=report.finishedAt??report.startedAt;
  const head=[`【SITE EXAM 再診断結果（${jst(at).slice(0,10)}）】`,...(c.scopeGap>0?[`前回と同じ検査範囲で再診断していないため、${c.scopeGap}件は確認できていません`]:[]),`・実行日時（日本時間）：${jst(at)}`,`・実行ID：${report.runId??''}`,`・解消：${c.resolved.length}件`,`・未解消：${c.unresolved.length}件`,`・再確認できず：${c.unverified.length}件`,`・新たに発生：${added.length}件`,...(c.carriedExcluded.length?[`・前回引き継ぎ対象外：${c.carriedExcluded.length}件`]:[])].join('\n');
  const list=(label,items)=>items.length?[[`【${label}（${items.length}件）】`,...items.map(brief)].join('\n')]:[];
  const fixed=[head,...list('解消',c.resolved),...list('未解消',c.unresolved),...list('再確認できず',c.unverified)];
  // 縮め方：stage1 新たに発生を最初の1文に、stage2 タイトルのみに。それでも超える分は末尾の文を残して切る。
  const build=(stage,truncated=false)=>[...fixed,...(added.length?[[`【新たに発生（${added.length}件）】`,...added.map(i=>formatIssueDetail(i,{short:stage>=1,titleOnly:stage>=2}))].join('\n\n')]:[]),...(truncated?[TRUNC_NOTE]:[]),CMP_CLOSING].join('\n\n').split('\n\n').map(clean).join('\n\n');
  let body=build(0),truncated=false;
  if(body.length>limit){
    truncated=true;body=build(1,true);
    if(body.length>limit)body=build(2,true);
    if(body.length>limit){const tail='\n\n'+clean(TRUNC_NOTE)+'\n\n'+clean(CMP_CLOSING);body=body.slice(0,limit-tail.length).replace(/\n[^\n]*$/,'')+tail;}
  }
  return {body,truncated};
}
// 次の比較の基準。解消は含めず、未解消・再確認できず・チェックした新規を引き継ぐ。
export function nextRecord({record,comparison:c,uncheckedAddedKeys=[],report,siteName,handoffId,actor,now}){
  const off=new Set(uncheckedAddedKeys),strip=({fixedUrlCount,reason,...i})=>i;
  return {handoffId,createdAt:new Date(now??Date.now()).toISOString(),actor:actor??'',sourceRunId:report.runId??'',sourceFinishedAt:report.finishedAt??report.startedAt??'',siteName,
    issues:[...c.unresolved,...c.unverified,...c.added.filter(i=>!off.has(i.key))].map(strip),
    excludedKeys:[...new Set([...c.carriedExcluded.map(i=>i.key),...c.added.filter(i=>off.has(i.key)).map(i=>i.key)])]};
}
