import {locationText} from './problem-locations.mjs';
import {automaticEvaluation,automaticAssessmentVersion} from './automatic-assessment.mjs';
import {rubricVersion,riskAxes,calculateRisk,rubricText} from '../ui/public/risk-rubric.js';
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function examFingerprint(report){return hash({rubricVersion,assessmentVersion:5,automaticAssessmentVersion,context:report.examContextDigest,runId:report.runId,configHash:report.configHash,finishedAt:report.finishedAt,rows:report.rows.map(r=>({id:r.id,status:r.status,reason:r.reason,failures:r.failures,evidence:r.evidence,evidenceState:r.evidenceState}))});}
export function riskLevel(score){return score===null?'採点保留':score>=80?'重大':score>=50?'高':score>=20?'中':'低';}
export function examGroups(report){
 const groups=new Map();
 for(const row of report.rows.filter(r=>r.status==='fail'))for(const f of row.failures?.length?row.failures:[{key:'unknown:'+row.id,title:'期待する結果と一致しませんでした',impact:'具体的な影響は追加確認が必要です。',admin:'証拠と期待条件を照合してから、修正箇所を判断してください。'}]){
  const id=hash(f.key).slice(0,24);if(!groups.has(id))groups.set(id,{id,key:f.key,kind:f.key.startsWith('axe:')?'accessibility':f.key.startsWith('javascript:')?'javascript':f.key.startsWith('metadata:')||f.key.startsWith('indexable:')?'metadata':'other',title:f.title,impact:f.impact,action:f.admin,repro:row.customerRepro?.[f.key],cases:[]});
  const g=groups.get(id);if(!g.cases.some(c=>c.id===row.id))g.cases.push({id:row.id,title:row.title,locations:row.customerLocations?.[f.key]??[],evidence:row.evidence??[],evidenceState:row.evidenceState??{},observations:row.assessmentObservations??[],images:(row.customerImages??[]).filter(i=>f.key==='axe:'+i.rule)});
 }
 return [...groups.values()];
}
export function buildExam(report,saved=null){
 const fingerprint=examFingerprint(report),valid=saved?.fingerprint===fingerprint;
 const issues=examGroups(report).map(g=>{
  const base={scores:null,certainty:'pending',reasons:['','',''],impact:g.impact,action:g.action,summary:g.title,proofs:[0,1,2].map(()=>({file:'',observation:''})),steps:g.repro?.steps??[],expected:g.repro?.expected??'',observed:'',reproductionVerified:false,imageFiles:[],imagesReviewed:false,reviewed:false,source:'rule'};
  const evaluation=valid?saved.items?.find(x=>x.id===g.id):null;
  const item={...g,...base,...automaticEvaluation(g),...evaluation};item.score=item.certainty==='pending'||!item.scores?null:calculateRisk(item.scores);item.level=riskLevel(item.score);return item;
 });
 const scores=issues.map(i=>i.score).filter(n=>n!==null);const maxFor=certainty=>{const a=issues.filter(i=>i.certainty===certainty&&i.score!==null).map(i=>i.score);return a.length?Math.max(...a):null;};
 const pendingCounts={};for(const i of issues.filter(i=>i.score===null)){const k=i.pendingCategory??'manual';pendingCounts[k]=(pendingCounts[k]??0)+1;}
 const unresolvedSecurity=report.rows.filter(r=>(r.id?.startsWith('check.security-')||r.failures?.some(f=>f.key.startsWith('security:')))&&r.status!=='pass').length;
 const warning=(issues.some(i=>i.score===null)||unresolvedSecurity)?'評価未完了：未評価の課題があります。表示された点数だけで低リスク・安全とは判断できません。'+(unresolvedSecurity?' セキュリティ未解決・未確認 '+unresolvedSecurity+'項目。':''):'';
 return {warning,pendingCounts,unresolvedSecurity,confirmedMaximum:maxFor('confirmed'),provisionalMaximum:maxFor('provisional'),rubricVersion,fingerprint,version:saved?.version??null,stale:!!saved&&!valid,issues,maximum:scores.length?Math.max(...scores):null,pending:issues.filter(i=>i.score===null).length,reviewed:issues.filter(i=>i.reviewed).length,coverage:{total:report.rows.length,executed:report.rows.filter(r=>['pass','fail'].includes(r.status)).length,unconfirmed:report.rows.filter(r=>!['pass','fail'].includes(r.status)).map(r=>({id:r.id,title:r.title,status:r.status}))},savedAt:valid?saved.savedAt:null};
}
export function validateExamItems(items,exam){
 if(!Array.isArray(items)||items.length!==exam.issues.length||new Set(items.map(i=>i.id)).size!==items.length)throw Error('すべての課題の評価を指定してください');
 return items.map(i=>{
  if(!exam.issues.some(g=>g.id===i.id)||Object.keys(i).some(k=>!['id','scores','certainty','reasons','impact','action','reviewed','source','summary','proofs','steps','expected','observed','reproductionVerified','imageFiles','imagesReviewed'].includes(k)))throw Error('評価項目が不正です');
  if(!['pending','provisional','confirmed'].includes(i.certainty)||typeof i.reviewed!=='boolean'||!['rule','manual','ai'].includes(i.source))throw Error('評価状態が不正です');
  if(i.scores!==null&&(!Array.isArray(i.scores)||i.scores.length!==3||i.scores.some((v,n)=>!Number.isInteger(v)||v<1||v>(n===2?4:5))))throw Error('点数は影響1～5、起こりやすさ1～5、範囲1～4で指定してください');
  if(i.certainty!=='pending'&&!i.scores)throw Error('採点の内訳が必要です');
  if(!Array.isArray(i.reasons)||i.reasons.length!==3||[...(i.certainty==='pending'?[]:i.reasons),i.impact,i.action].some(v=>typeof v!=='string'||!v.trim()||v.length>3000))throw Error('採点理由・影響・対応方法を各3000文字以内で入力してください');
  if(i.reasons.some(r=>typeof r!=='string'||r.length>3000))throw Error('採点理由の形式が不正です');
  if(i.reviewed&&i.certainty==='pending')throw Error('採点保留の課題は内容確認済みにできません');
  const group=exam.issues.find(g=>g.id===i.id);
  const extra={summary:i.summary??group.title,proofs:i.proofs??[0,1,2].map(()=>({file:'',observation:''})),steps:i.steps??[],expected:i.expected??'',observed:i.observed??'',reproductionVerified:i.reproductionVerified??false,imageFiles:i.imageFiles??[],imagesReviewed:i.imagesReviewed??false};
  for(const name of ['summary','expected','observed'])if(typeof extra[name]!=='string'||extra[name].length>3000)throw Error('顧客向け説明の形式が不正です');
  if(!Array.isArray(extra.steps)||extra.steps.length>20||extra.steps.some(x=>typeof x!=='string'||!x.trim()||x.length>1000))throw Error('再現手順は20行以内で指定してください');
  if(typeof extra.reproductionVerified!=='boolean'||typeof extra.imagesReviewed!=='boolean')throw Error('確認状態が不正です');
  if(!Array.isArray(extra.proofs)||extra.proofs.length!==3||extra.proofs.some(p=>!p||Object.keys(p).sort().join(',')!=='file,observation'||typeof p.file!=='string'||typeof p.observation!=='string'||p.observation.length>3000))throw Error('各評価軸の証拠と観測事実を指定してください');
  if(!Array.isArray(extra.imageFiles)||extra.imageFiles.length>4||new Set(extra.imageFiles).size!==extra.imageFiles.length||extra.imageFiles.some(file=>!group.cases.some(c=>c.images.some(i=>i.file===file))))throw Error('この課題の枠付き画像を4枚以内で選択してください');
  if(extra.imageFiles.length&&!extra.imagesReviewed)throw Error('画像に個人情報・認証情報が含まれないことを確認してください');
  const substantive=(text,min)=>text.replace(/\[[^\]]*\]/g,'').replace(/\s/g,'').length>=min&&!/^(未確認|不明|要確認|test|testtest|サンプル|根拠なし)[。.!！]*$/i.test(text.trim());
  if(i.certainty==='confirmed'){
   if(!i.reviewed||!extra.reproductionVerified)throw Error('確定には内容確認と再現手順の実施確認が必要です');
   if(i.reasons.some(r=>!substantive(r,20))||new Set(i.reasons.map(r=>r.trim())).size!==3)throw Error('各軸の採点理由に、観測事実が選択した段階に該当する理由を具体的に記載してください（20文字以上、IDだけ・同一文の繰り返しは不可）');
   for(const p of extra.proofs)if(!substantive(p.observation,15)||!group.cases.some(c=>c.evidence.includes(p.file)&&c.evidenceState[p.file]?.available))throw Error('確定には実在する証拠と具体的な観測事実が各軸に必要です');
   if(extra.steps.length<2||!substantive(extra.expected,15)||!substantive(extra.observed,15)||!substantive(extra.summary,10))throw Error('確定には顧客向け説明・再現手順2行以上・期待結果・実際の結果を記載してください');
  }
  return {...extra,id:i.id,scores:i.scores,certainty:i.certainty,reasons:i.reasons,impact:i.impact,action:i.action,reviewed:i.reviewed,source:i.source};
 });
}
export function customerImageWarnings(exam,readImage=()=>null){
 let bytes=0;const warnings=[];
 for(const issue of exam.issues)for(const file of issue.imageFiles??[]){
  let src;try{src=readImage(file);}catch{}
  if(typeof src!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(src)){warnings.push({issueId:issue.id,message:(issue.summary||issue.title)+'：掲載用の画像を読み込めません。画像を選び直してください。'});continue;}
  if(bytes+src.length>24*1024*1024){warnings.push({issueId:issue.id,message:(issue.summary||issue.title)+'：画像容量の上限により、この画像は提出用HTMLに掲載されません。画像を減らしてください。'});continue;}
  bytes+=src.length;
 }
 return warnings;
}
export function customerExamHtml(report,exam,readImage=()=>null){
 let imageBytes=0;
 const e=escapeHtml,certainty={pending:'採点保留',provisional:'暫定評価（未確定）',confirmed:'確定評価'};
 const draft=!exam.savedAt||exam.issues.some(i=>!i.reviewed||i.certainty!=='confirmed');
 let site='';try{const u=new URL(report.baseURL);site=u.origin+u.pathname;}catch{}
 const images=i=>(i.imageFiles??[]).map(file=>{
  const src=readImage(file);
  if(typeof src!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(src)||imageBytes+src.length>24*1024*1024)return '';
  imageBytes+=src.length;
  const location=i.cases.flatMap(c=>c.locations??[]).find(l=>l.imageFile===file);
  return '<figure><img src="'+src+'" alt="問題箇所を枠で示した画面"><figcaption>'+e(location?.number?'指摘 '+location.number+'：'+location.element:'枠内が指摘箇所です。')+'</figcaption></figure>';
 }).join('');
 const cards=exam.issues.map(i=>{
  const picture=images(i),locations=[...new Set(i.cases.flatMap(c=>c.locations?.length?c.locations.map(l=>locationText({...l,number:(i.imageFiles??[]).includes(l.imageFile)?l.number:null})):[c.title]).filter(Boolean))];
  for(const c of i.cases){const data=report.rows.find(r=>r.id===c.id)?.softwareSecurity;for(const finding of data?.findings??[]){const key='security:'+data.component+':'+(finding.asset?.slug??'')+':'+(finding.cves?.join(',')||finding.title);if(key===i.key)locations.push([finding.asset?.name,finding.asset?.version,...(finding.cves??[])].filter(Boolean).join(' ／ '));}}

  const reasons=i.reasons.map((reason,n)=>reason?.trim()?'<li><strong>'+e(riskAxes[n].name)+'：</strong>'+e(reason)+'</li>':'').join('');
  return '<section><h2>'+e(i.summary||i.title)+'</h2><p class="risk">危険度：'+(i.score===null?'採点保留':e(i.score)+' / 100 ・ '+e(i.level))+' <span>'+e(certainty[i.certainty])+'</span></p><h3>問題箇所</h3><p>'+(locations.length?locations.map(l=>e(l)).join('<br>'):'箇所の特定には追加確認が必要です。')+'</p>'+(i.observed?'<p>'+e(i.observed)+'</p>':'')+picture+'<h3>採点理由</h3>'+(i.score===null?'<p>'+e(i.pendingReason||'採点に必要な根拠が不足しているため、評価を保留しています。')+'</p>':'')+(reasons?'<ul>'+reasons+'</ul>':'')+(i.score!==null&&i.assumptions?'<p class="muted">'+e(i.assumptions)+'</p>':'')+'</section>';
 }).join('');
 return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SITE EXAM_ 診断報告書</title><style>body{font:16px/1.8 system-ui,sans-serif;color:#213547;margin:0;background:#f4f6f8}main{max-width:900px;margin:auto;padding:32px}header{margin-bottom:28px}h1{font-size:28px}h2{font-size:21px;margin-top:0}h3{font-size:16px;margin-bottom:6px}section{background:#fff;border:1px solid #dce3e8;border-radius:8px;padding:24px;margin:20px 0}.risk{font-size:20px;font-weight:700}.risk span{font-size:14px;font-weight:400;margin-left:12px}.muted,figcaption{color:#52616d;font-size:14px}figure{margin:16px 0}img{max-width:100%;height:auto}p,li{overflow-wrap:anywhere}li{margin:8px 0}@media(max-width:600px){main{padding:16px}section{padding:18px}.risk span{display:block;margin:0}}@media print{body{background:white}main{padding:0}section{break-inside:avoid}}</style></head><body><main><header><h1>サイト診断報告書</h1><p>'+e(report.name??site)+' ／ '+e(site)+'</p><p class="muted">診断日時：'+e(report.finishedAt??'未記録')+' ／ '+(draft?'下書き・暫定版':'確定版')+'</p><p class="muted">点数が高いほど危険度が高い評価です。未確認・採点保留は0点を意味しません。</p>'+(exam.warning?'<p class="muted">'+e(exam.warning)+'</p>':'')+'</header>'+ (cards||'<section><p>今回判定できた範囲では、採点対象の問題はありません。未確認の範囲を含むサイト全体の安全性を保証するものではありません。</p></section>')+'</main></body></html>';
}
