import {rubricVersion,riskAxes,calculateRisk,rubricText} from '../ui/public/risk-rubric.js';
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function examFingerprint(report){return hash({rubricVersion,assessmentVersion:3,context:report.examContextDigest,runId:report.runId,configHash:report.configHash,finishedAt:report.finishedAt,rows:report.rows.map(r=>({id:r.id,status:r.status,reason:r.reason,failures:r.failures,evidence:r.evidence,evidenceState:r.evidenceState}))});}
export function riskLevel(score){return score===null?'採点保留':score>=80?'重大':score>=50?'高':score>=20?'中':'低';}
export function examGroups(report){
 const groups=new Map();
 for(const row of report.rows.filter(r=>r.status==='fail'))for(const f of row.failures?.length?row.failures:[{key:'unknown:'+row.id,title:'期待する結果と一致しませんでした',impact:'具体的な影響は追加確認が必要です。',admin:'証拠と期待条件を照合してから、修正箇所を判断してください。'}]){
  const id=hash(f.key).slice(0,24);if(!groups.has(id))groups.set(id,{id,kind:f.key.startsWith('axe:')?'accessibility':f.key.startsWith('javascript:')?'javascript':f.key.startsWith('metadata:')||f.key.startsWith('indexable:')?'metadata':'other',title:f.title,impact:f.impact,action:f.admin,repro:row.customerRepro?.[f.key],cases:[]});
  const g=groups.get(id);if(!g.cases.some(c=>c.id===row.id))g.cases.push({id:row.id,title:row.title,evidence:row.evidence??[],evidenceState:row.evidenceState??{},images:(row.customerImages??[]).filter(i=>f.key==='axe:'+i.rule)});
 }
 return [...groups.values()];
}
export function buildExam(report,saved=null){
 const fingerprint=examFingerprint(report),valid=saved?.fingerprint===fingerprint;
 const issues=examGroups(report).map(g=>{
  const base={scores:null,certainty:'pending',reasons:['','',''],impact:g.impact,action:g.action,summary:g.title,proofs:[0,1,2].map(()=>({file:'',observation:''})),steps:g.repro?.steps??[],expected:g.repro?.expected??'',observed:'',reproductionVerified:false,imageFiles:[],imagesReviewed:false,reviewed:false,source:'rule'};
  const evaluation=valid?saved.items?.find(x=>x.id===g.id):null;
  const item={...g,...base,...evaluation};item.score=item.certainty==='pending'||!item.scores?null:calculateRisk(item.scores);item.level=riskLevel(item.score);return item;
 });
 const scores=issues.map(i=>i.score).filter(n=>n!==null);const maxFor=certainty=>{const a=issues.filter(i=>i.certainty===certainty&&i.score!==null).map(i=>i.score);return a.length?Math.max(...a):null;};
 return {confirmedMaximum:maxFor('confirmed'),provisionalMaximum:maxFor('provisional'),rubricVersion,fingerprint,version:saved?.version??null,stale:!!saved&&!valid,issues,maximum:scores.length?Math.max(...scores):null,pending:issues.filter(i=>i.score===null).length,reviewed:issues.filter(i=>i.reviewed).length,coverage:{total:report.rows.length,executed:report.rows.filter(r=>['pass','fail'].includes(r.status)).length,unconfirmed:report.rows.filter(r=>!['pass','fail'].includes(r.status)).map(r=>({id:r.id,title:r.title,status:r.status}))},savedAt:valid?saved.savedAt:null};
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
export function customerExamHtml(report,exam,readImage=()=>null){
 let imageBytes=0;const embedded=file=>{const src=readImage(file);if(typeof src!=='string'||imageBytes+src.length>24*1024*1024)return null;imageBytes+=src.length;return src;};
 const e=escapeHtml,draft=!exam.savedAt||exam.issues.some(i=>!i.reviewed||i.certainty!=='confirmed'),certainty={pending:'採点保留',provisional:'暫定評価（未確定）',confirmed:'確定評価'};
 let site='';try{const u=new URL(report.baseURL);site=u.origin+u.pathname;}catch{}
 return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SITE EXAM_ 診断報告書</title><style>body{font:16px/1.8 system-ui,sans-serif;color:#183446;background:#f2f5f7;margin:0}main{max-width:980px;margin:auto;padding:32px}section{background:white;border:1px solid #d8e3e7;border-radius:10px;padding:24px;margin:20px 0}h1{font-size:30px}h2{font-size:21px}.notice{padding:14px;background:#fff1d9}li{margin:8px 0}p{overflow-wrap:anywhere}@media print{body{background:white}section{break-inside:avoid}}</style><main><h1>SITE EXAM_ サイト診断報告書</h1><p>${e(report.name??site)} ／ ${e(site)}</p><p>診断日時：${e(report.finishedAt)} ／ 実行ID：${e(report.runId)}</p><p class="notice">${draft?'下書き・暫定版：未確定の評価が含まれます。確定結果として扱わないでください。':'記載した課題の評価は確定済みです。未確認項目の安全性を保証するものではありません。'} 検査結果と採点は別の情報です。サイト全体の安全性を保証するものではありません。</p><section><h2>暫定を含む参考最大点：${exam.maximum===null?(exam.issues.length?'採点保留':'採点対象なし'):exam.maximum+' / 100'}</h2><p><b>確定評価の最高点：${exam.confirmedMaximum??'未確定'} ／ 暫定評価の参考最高点：${exam.provisionalMaximum??'なし'}</b></p><p>課題${exam.issues.length}件 ／ 採点保留${exam.pending}件 ／ 暫定点${exam.issues.filter(i=>i.certainty==='provisional').length}件</p><p>全${exam.coverage.total}項目中、判定済み${exam.coverage.executed}項目・未確認${exam.coverage.unconfirmed.length}項目。未確認を0点として扱いません。</p></section>${exam.issues.length?exam.issues.map(i=>`<section style="border-left:6px solid ${i.certainty==='confirmed'?'#21735a':'#b47a20'}"><h2>${e(i.summary||i.title)}</h2><p><strong>危険度：${i.score===null?'採点保留':i.score+' / 100 ・ '+i.level}</strong> ／ ${certainty[i.certainty]} ／ ${i.reviewed?'内容確認済み':'内容未確認'}</p><p>${e(i.impact)}</p><h3>再現・確認手順</h3><p>${i.reproductionVerified?'実施確認済みの手順':'追試手順：実施未確認'}</p><ol>${(i.steps??[]).map(step=>`<li>${e(step)}</li>`).join('')||'<li>具体的な操作が未記録です。確認が必要です。</li>'}</ol><p><b>期待する結果：</b>${e(i.expected||'未確認')}</p><p><b>実際の結果：</b>${e(i.observed||'具体的な挙動は未確認')}</p><h3>問題箇所</h3>${(i.imageFiles??[]).map(file=>{const src=embedded(file);return src&&/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(src)?`<figure><img style="max-width:100%;height:auto" src="${src}" alt="問題箇所を赤枠で示した画面"><figcaption>赤枠が検出対象です。検査後に撮影した画面です。</figcaption></figure>`:'<p>掲載予定の画像を取得できないか、HTMLへの画像埋込上限を超えました。</p>';}).join('')||'<p>掲載できる枠付き画像は未選択です。画面上の場所を特定できない問題もあります。</p>'}<h3>採点理由</h3><ul>${i.reasons.map((r,n)=>`<li>${riskAxes[n].name} ${i.scores?.[n]??'—'}：${e(r)}${i.proofs?.[n]?.observation?`<br>観測事実：${e(i.proofs[n].observation)}`:''}</li>`).join('')}</ul><h3>対応方法</h3><p>${e(i.action)}</p><details><summary>根拠となる検査（詳細）</summary><ul>${i.cases.map(c=>`<li>${e(c.title)} ／ 証拠${c.evidence.length}件</li>`).join('')}</ul></details><p>顧客への掲載を確認した画像・説明のみを出力しています。認証情報を含み得る生のログやトレースは掲載していません。</p></section>`).join(''):'<section>今回判定できた範囲では不合格を検出しませんでした。未確認の項目は下記をご確認ください。</section>'}<section><h2>未確認の項目</h2><ul>${exam.coverage.unconfirmed.map(r=>`<li>${e(r.title??r.id)}：${e(({blocked:'実行不能',not_run:'未実施',review:'直接確認',preparation:'設定が必要'})[r.status]??'未確認')}</li>`).join('')||'<li>今回の検査一覧上はありません。一覧外の機能の確認は含みません。</li>'}</ul></section><section><details><summary>専門的な評価基準と点数表</summary><pre style="white-space:pre-wrap">${e(rubricText())}</pre><p>評価基準：${e(rubricVersion)}。確定点には、実在する証拠・観測事実・各軸の採点理由・再現手順の実施確認が必要です。判断内容の妥当性は担当者が確認します。暫定点は未検証の前提を含みます。</p></details></section></main></html>`;
}
