import {groupRows} from './causes.mjs';
import {recheck,defaultClient,publicGateHeaders} from './recheck.mjs';
import {lintItems,usedSentences} from './lint.mjs';
import {renderEditorReport,renderBasis} from './render.mjs';

// 編集者向け報告書の作成の流れ：事実の整理 → 再確認 → 文章（Claude）→ 機械的な確認（1回だけ書き直し）→ HTML。
const WRITTEN=['editor','admin','tech','not-site'];
const BATCH=20;
const PROBLEM_NAMES={missing:'項目の不足',extra:'項目の過不足',code:'読みにくい書き方',duplicate:'文の重複',term:'用語の説明',['unknown-fact']:'渡していない事実'};
const calls=groups=>Math.ceil(groups.length/BATCH);
const REASONS=[[/接続先の許可/,'接続先の許可がないため再確認できませんでした'],[/上限/,'再確認の上限に達したため一部を再確認できませんでした'],[/閲覧パスワード/,'閲覧パスワードの画面が表示されたため再確認できませんでした']];
const reasonOf=notes=>REASONS.find(([re])=>notes.some(n=>re.test(n)))?.[1]??'ページを取得できなかったため再確認できませんでした';

const RULE_NAMES={'plugin-vulnerability':'プラグインの既知の弱点',compatibility:'更新前の互換性の確認','security-headers':'セキュリティ用の設定',disclosure:'外から分かる情報','soft-404':'存在しないページの表示','index-expectation':'検索エンジンへの公開設定','render-timeout':'ページの表示に時間がかかった','link-transient':'リンク先の一時的な不調','sitemap-format':'サイトマップの形式','foreign-image':'検証用と思われる画像',unclassified:'その他の不具合'};
const VISUAL=/^(layout|javascript|snapshot|axe)\./;

// 画面の見た目の行の証拠にある読み込めなかった画像を、ページのパスごとにまとめる（読めない証拠は無視する）。
function failedImagesOf(report,config,readEvidence){
  const out={};
  for(const row of report.rows??[]){
    if(!VISUAL.test(row.id)) continue;
    const id=row.id.split('.').slice(1).join('.');
    const pageId=(config?.visuals??[]).find(v=>v.id===id)?.pageId,path=(config?.pages??[]).find(p=>p.id===pageId)?.path;
    if(!path) continue;
    for(const file of row.evidence??[]){
      let data;try{data=readEvidence?.(file);}catch{continue;}
      const list=data?.failedImages??data?.readiness?.failedImages;
      if(!Array.isArray(list)) continue;
      const seen=out[path]??=[];
      for(const i of list){
        if(!i?.url) continue;
        const known=seen.find(x=>x.url===i.url);
        // 同じ画像が別の証拠で「読み込めなかった」なら、そちらの理由を優先する。
        if(!known) seen.push({url:i.url,host:i.host,reason:i.reason});else if(i.reason==='not-loaded') known.reason='not-loaded';
      }
    }
  }
  return out;
}

function failure(problems,items,groups){
  const title=id=>items.find(i=>i.groupId===id)?.title??RULE_NAMES[groups.find(g=>g.id===id)?.rule]??'その他の項目';
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
  const checked=await recheck(facts.groups,{baseURL,sitePath,environment:env,client:http,allowedOrigins,now:()=>checkedAt,failedImagesByPath:failedImagesOf(report,config,readEvidence)});
  const groups=checked.groups;
  const warnings=[...new Set(groups.filter(g=>g.verification?.result==='unverified').map(g=>reasonOf(g.verification.notes??[])))];

  const written=groups.filter(g=>WRITTEN.includes(g.category));
  let items=[],aiCalls=0,problems=[];
  if(written.length){
    onStage('writing');
    const sent=new Set(written.map(g=>g.id));
    items=(await ai.writeEditorItems(written)).filter(i=>sent.has(i?.groupId));aiCalls+=calls(written);
    onStage('checking');
    problems=lintItems(items,{groups:written});
    if(problems.length){
      const bad=new Set(problems.map(p=>p.groupId)),redo=written.filter(g=>bad.has(g.id));
      onStage('writing');
      let again=[];
      if(redo.length){again=(await ai.writeEditorItems(redo,{problems,avoid:usedSentences(items.filter(i=>!bad.has(i?.groupId)))})).filter(i=>bad.has(i?.groupId));aiCalls+=calls(redo);}
      const fixed=new Set(again.map(i=>i.groupId));
      items=[...items.filter(i=>!fixed.has(i.groupId)),...again];
      onStage('checking');
      const left=lintItems(items,{groups:written});
      if(left.length) throw failure(left,items,written);
    }
  }

  onStage('rendering');
  const input={site:shownSite,runId:report.runId,startedAt:report.startedAt,checkedAt,counts:facts.counts,groups,items};
  return {html:renderEditorReport(input),basisHtml:renderBasis({...input,recheckLog:checked.log,lintResults:problems,aiCalls}),counts:facts.counts,aiCalls,warnings};
}
