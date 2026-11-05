import {groupRows} from './causes.mjs';
import {recheck,defaultClient,publicGateHeaders} from './recheck.mjs';
import {lintItems} from './lint.mjs';
import {renderEditorReport,renderBasis} from './render.mjs';

// 編集者向け報告書の作成の流れ：事実の整理 → 再確認 → 文章（Claude）→ 機械的な確認（1回だけ書き直し）→ HTML。
const WRITTEN=['editor','admin','tech','not-site'];
const BATCH=20;
const PROBLEM_NAMES={missing:'項目の不足',extra:'項目の過不足',code:'読みにくい書き方',duplicate:'文の重複',term:'用語の説明',['unknown-fact']:'渡していない事実'};
const calls=groups=>Math.ceil(groups.length/BATCH);
const REASONS=[[/接続先の許可/,'接続先の許可がないため再確認できませんでした'],[/上限/,'再確認の上限に達したため一部を再確認できませんでした'],[/閲覧パスワード/,'閲覧パスワードの画面が表示されたため再確認できませんでした']];
const reasonOf=notes=>REASONS.find(([re])=>notes.some(n=>re.test(n)))?.[1]??'ページを取得できなかったため再確認できませんでした';

function failure(problems,items){
  const title=id=>items.find(i=>i.groupId===id)?.title??id;
  return Error(`文章の確認に通りませんでした：${problems.map(p=>`${PROBLEM_NAMES[p.problem]??p.problem}（${title(p.groupId)}）`).join('、')}`);
}

export async function buildEditorReport({report,readEvidence,config,site,environment,sitePath='/',allowedOrigins=[],publicPassword,client,ai,onStage=()=>{},now=()=>new Date().toISOString()}){
  const baseURL=site?.baseURL??report.baseURL,env=environment??site?.environment??report.environment;
  const shownSite={name:site?.name??report.name,baseURL,environment:env};

  onStage('facts');
  const facts=groupRows(report,{environment:env,config,readEvidence});

  onStage('recheck');
  const http=client??defaultClient({allowedOrigins,siteOrigin:new URL(baseURL).origin,publicHeaders:await publicGateHeaders({baseURL,sitePath,password:publicPassword})});
  const checkedAt=typeof now==='function'?now():now;
  const checked=await recheck(facts.groups,{baseURL,sitePath,environment:env,client:http,allowedOrigins,now:()=>checkedAt});
  const groups=checked.groups;
  const warnings=[...new Set(groups.filter(g=>g.verification?.result==='unverified').map(g=>reasonOf(g.verification.notes??[])))];

  const written=groups.filter(g=>WRITTEN.includes(g.category));
  let items=[],aiCalls=0,problems=[];
  if(written.length){
    onStage('writing');
    items=await ai.writeEditorItems(written);aiCalls+=calls(written);
    onStage('checking');
    problems=lintItems(items,{groups:written});
    if(problems.length){
      const bad=new Set(problems.map(p=>p.groupId)),redo=written.filter(g=>bad.has(g.id));
      onStage('writing');
      let again=[];
      if(redo.length){again=await ai.writeEditorItems(redo,{problems});aiCalls+=calls(redo);}
      const fixed=new Set(again.map(i=>i.groupId));
      items=[...items.filter(i=>!fixed.has(i.groupId)),...again];
      onStage('checking');
      const left=lintItems(items,{groups:written});
      if(left.length) throw failure(left,items);
    }
  }

  onStage('rendering');
  const input={site:shownSite,runId:report.runId,startedAt:report.startedAt,checkedAt,counts:facts.counts,groups,items};
  return {html:renderEditorReport(input),basisHtml:renderBasis({...input,recheckLog:checked.log,lintResults:problems,aiCalls}),counts:facts.counts,aiCalls,warnings};
}
