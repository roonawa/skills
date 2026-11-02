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
