import {riskAxes,calculateRisk,rubricText} from './risk-rubric.js';
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initSiteExam({state,api}){
 const panel=document.createElement('section');panel.id='site-exam';panel.className='panel exam-panel';document.querySelector('.workspace-grid').before(panel);
 let scope='',data=null,busy=false,dirty=false,ticket=0,suggestions=[];
 const endpoint=()=>`/api/projects/${encodeURIComponent(state.projectId)}/runs/${encodeURIComponent(state.runId)}`;
 const message=t=>{const el=panel.querySelector('[data-message]');if(el)el.textContent=t;};
 const value=i=>i.certainty==='pending'||!i.scores?null:calculateRisk(i.scores);
 const proofFiles=i=>[...new Set(i.cases.flatMap(c=>c.evidence.filter(f=>c.evidenceState?.[f]?.available)))];
 const label=i=>{const v=value(i);return v===null?'採点保留':`${v} / 100 ・ ${v>=80?'重大':v>=50?'高':v>=20?'中':'低'}（${i.certainty==='confirmed'?'確定':'暫定'}）`;};
 const highest=certainty=>{const scores=data.issues.filter(i=>i.certainty===certainty).map(value).filter(v=>v!==null);return scores.length?Math.max(...scores):"なし";};
 function summary(){if(!data)return;const values=data.issues.map(value).filter(v=>v!==null);panel.querySelector('[data-summary]').textContent=`暫定を含む参考最大点：${values.length?Math.max(...values)+' / 100':data.issues.length?'採点保留':'採点対象なし'} ／ 確定評価の最高点：${highest("confirmed")}・暫定評価の参考最高点：${highest("provisional")} ／ 課題${data.issues.length}件・採点保留${data.issues.filter(i=>value(i)===null).length}件・内容確認${data.issues.filter(i=>i.reviewed).length}件。判定済み${data.coverage.executed} / ${data.coverage.total}項目、未確認${data.coverage.unconfirmed.length}項目。`;}
 function showSuggestions(){
    panel.querySelector('[data-suggestions]').innerHTML=`<h3>AIの説明候補（未反映）</h3>${suggestions.map((s,n)=>`<div class="exam-ai"><h4>${e(data.issues.find(i=>i.id===s.id)?.title)}</h4><p>${e(s.impact)}</p><p>${e(s.action)}</p><button type="button" data-apply-ai="${n}">この説明を入力欄に反映</button></div>`).join('')}`;
 }
 function draw(){
  if(!data)return;
  panel.innerHTML=`<div class="panel-heading"><h2>診断評価・顧客向け報告書</h2></div><p data-summary></p><p class="quiet">点数は検出課題の危険度であり、サイト全体の安全性を表しません。未確認や採点保留を0点として扱いません。保存済みの証拠から説明を整理します。</p><details><summary>採点基準・点数表</summary><pre style="white-space:pre-wrap">${e(rubricText())}</pre><p>各段階は証拠で判断します。観測した現在値を正しい仕様とは扱いません。確定には各軸の証拠・観測事実・具体的な採点理由と、再現手順の実施確認が必要です。IDだけの理由では確定できません。基準不足の検出だけでは影響度を決めません。</p></details><div class="exam-actions"><button type="button" data-save>評価を保存</button><button type="button" data-ai>Claudeで説明候補を補完</button><button type="button" data-preview>顧客向けHTMLを確認</button><a data-download href="${endpoint()}/customer-report?download=1" download>HTMLをダウンロード</a><button type="button" data-reload>評価を再取得</button></div><p class="quiet">AIには課題の種類とケース数だけを送ります（1回最大40課題）。URL・証拠・本文・認証情報は送りません。候補は一般的な説明で、具体的な原因や対応箇所の確定には証拠の確認が必要です。API利用料が発生します。</p><p data-message role="status">${data.stale?'検査結果または採点基準が更新されたため、以前の採点は適用していません。':data.savedAt?'評価を保存済みです。':'評価はまだ保存していません。未確認の説明を出力すると下書きになります。'}</p><div data-suggestions></div><div class="exam-issues">${data.issues.map((i,n)=>`<details class="exam-issue" data-issue="${n}"><summary><span>${e(i.title)}</span> <strong data-score="${n}">${e(label(i))}</strong> <small>${i.cases.length}ケース</small></summary><p>${e(i.impact)}</p><label>顧客向けの課題名・説明<textarea data-field="summary" maxlength="3000">${e(i.summary)}</textarea></label><label>採点の状態<select data-field="certainty"><option value="pending" ${i.certainty==='pending'?'selected':''}>採点保留</option><option value="provisional" ${i.certainty==='provisional'?'selected':''}>暫定</option><option value="confirmed" ${i.certainty==='confirmed'?'selected':''}>確定</option></select></label><div class="exam-score-fields">${riskAxes.map(({name},j)=>`<div><label>${name}<select data-score-input="${j}"><option value="">未設定</option>${Array.from({length:j===2?4:5},(_,k)=>`<option value="${k+1}" ${i.scores?.[j]===k+1?'selected':''}>${k+1}：${e(riskAxes[j].levels[k])}</option>`).join('')}</select></label><label>採点理由<textarea data-reason="${j}" maxlength="3000">${e(i.reasons[j])}</textarea></label><label>根拠の証拠<select data-proof-file="${j}"><option value="">選択してください</option>${proofFiles(i).map(file=>`<option value="${e(file)}" ${i.proofs[j]?.file===file?'selected':''}>${e(file)}</option>`).join('')}</select></label><label>証拠で確認した事実<textarea data-observation="${j}" maxlength="3000">${e(i.proofs[j]?.observation)}</textarea></label></div>`).join('')}</div><label>利用者への影響<textarea data-field="impact" maxlength="3000">${e(i.impact)}</textarea></label><label>対応方法（管理画面で可能な方法を優先）<textarea data-field="action" maxlength="3000">${e(i.action)}</textarea></label><label>再現・確認手順（1行に1操作）<textarea data-field="steps">${e(i.steps.join('\n'))}</textarea></label><label>期待する結果<textarea data-field="expected">${e(i.expected)}</textarea></label><label>実際に確認した結果<textarea data-field="observed">${e(i.observed)}</textarea></label><label><input type="checkbox" data-field="reproductionVerified" ${i.reproductionVerified?'checked':''}>上の操作を実施し、記載した結果を確認した</label><details><summary>顧客に掲載する問題箇所の画像</summary><p>既存の不具合報告書で取得した枠付き画像から選択します。画像がない場合は不具合報告書の画像取得を行って評価を再取得してください。場所を特定できない内部エラーは、画像なしの理由を説明に記載します。</p>${i.cases.flatMap(c=>c.images).map(img=>`<label><input type="checkbox" data-image-file="${e(img.file)}" ${i.imageFiles.includes(img.file)?'checked':''}><span>${e(img.caption)}<img style="display:block;max-width:100%;max-height:260px" src="${endpoint()}/files?path=${encodeURIComponent(img.file)}" alt="掲載前確認用の枠付き画像" loading="lazy"></span></label>`).join('')||'<p>この課題に対応する枠付き画像はありません。</p>'}<label><input type="checkbox" data-field="imagesReviewed" ${i.imagesReviewed?'checked':''}>選択画像の個人情報・認証情報と指摘箇所を確認し、顧客への掲載を許可する</label></details><label><input type="checkbox" data-field="reviewed" ${i.reviewed?'checked':''}>証拠・採点理由・説明内容を確認した</label><details><summary>根拠となる検査・証拠</summary>${i.cases.map(c=>`<div><strong>${e(c.title??c.id)}</strong><p>${e(c.id)}</p>${c.evidence.map(f=>`<a href="${endpoint()}/files?path=${encodeURIComponent(f)}" data-evidence>${e(f)}</a>`).join(' ／ ')||'<p>証拠ファイルなし。追加確認が必要です。</p>'}</div>`).join('')}</details></details>`).join('')||'<p>判定できた範囲では、不合格を検出しませんでした。未確認の範囲も確認してください。</p>'}</div><details><summary>未確認の項目（${data.coverage.unconfirmed.length}件）</summary><ul>${data.coverage.unconfirmed.map(r=>`<li>${e(r.title??r.id)}：${e(({blocked:'実行不能',review:'直接確認',not_run:'未実施',preparation:'設定が必要'})[r.status]??'未確認')}</li>`).join('')}</ul></details><div data-frame hidden><div class="exam-actions"><button type="button" data-close-frame>表示を閉じる</button></div><iframe title="報告書・証拠のプレビュー" sandbox></iframe></div>`;summary();
 }
 async function load(){const current=++ticket,url=endpoint();busy=true;try{const result=await api(url+'/exam');if(current!==ticket)return;data=result;dirty=false;suggestions=[];draw();}catch(err){if(current===ticket)panel.innerHTML=`<h2>診断評価</h2><p>${e(err.message)}</p><button type="button" data-reload>再取得</button>`;}finally{if(current===ticket)busy=false;}}
 function changed(){dirty=true;panel.querySelector('[data-frame]').hidden=true;message('未保存の変更があります。説明・採点を変更した課題は内容確認を解除しました。');summary();}
 panel.addEventListener('change',event=>{
  const box=event.target.closest('[data-issue]');if(!box)return;const n=Number(box.dataset.issue),i=data.issues[n],field=event.target.dataset.field;
  i.certainty=box.querySelector('[data-field=certainty]').value;const scores=[...box.querySelectorAll('[data-score-input]')].map(x=>x.value?Number(x.value):null);i.scores=scores.every(v=>v!==null)?scores:null;
  i.reasons=[...box.querySelectorAll('[data-reason]')].map(x=>x.value);i.impact=box.querySelector('[data-field=impact]').value;i.action=box.querySelector('[data-field=action]').value;
  for(const name of ['summary','expected','observed'])i[name]=box.querySelector('[data-field='+name+']').value;
  i.steps=box.querySelector('[data-field=steps]').value.split('\n').map(s=>s.trim()).filter(Boolean);
  i.proofs=[0,1,2].map(n=>({file:box.querySelector('[data-proof-file="'+n+'"]').value,observation:box.querySelector('[data-observation="'+n+'"]').value}));
  i.reproductionVerified=box.querySelector('[data-field=reproductionVerified]').checked;
  i.imageFiles=[...box.querySelectorAll('[data-image-file]:checked')].map(el=>el.dataset.imageFile);i.imagesReviewed=box.querySelector('[data-field=imagesReviewed]').checked;
  if(event.target.hasAttribute('data-image-file')){i.imagesReviewed=false;box.querySelector('[data-field=imagesReviewed]').checked=false;}
  if(['steps','expected','observed'].includes(field)){i.reproductionVerified=false;box.querySelector('[data-field=reproductionVerified]').checked=false;}
  i.reviewed=field==='reviewed'?event.target.checked:false;if(field!=='reviewed'){box.querySelector('[data-field=reviewed]').checked=false;i.source='manual';}
  box.querySelector('[data-score]').textContent=label(i);changed();
 });
 panel.addEventListener('input',event=>{if(event.target.matches('textarea'))event.target.dispatchEvent(new Event('change',{bubbles:true}));});
 panel.addEventListener('click',async event=>{
  const target=event.target.closest('button,a');if(!target)return;
  if(target.hasAttribute('data-close-frame')){panel.querySelector('[data-frame]').hidden=true;return;}
  if(target.hasAttribute('data-evidence')){event.preventDefault();const frame=panel.querySelector('[data-frame]');frame.hidden=false;frame.querySelector('iframe').src=target.href;frame.scrollIntoView({block:'nearest'});return;}
  if(target.hasAttribute('data-download')||target.hasAttribute('data-preview')){
   if(dirty){event.preventDefault();message('変更した評価を保存してからHTMLを出力してください。');return;}
   if(target.hasAttribute('data-preview')){const frame=panel.querySelector('[data-frame]');frame.hidden=false;frame.querySelector('iframe').src=endpoint()+'/customer-report';frame.scrollIntoView({block:'nearest'});}return;
  }
  if(target.hasAttribute('data-reload')){if(dirty&&!confirm('未保存の変更を破棄して再取得しますか？'))return;await load();return;}
  if(target.hasAttribute('data-apply-ai')){
   const suggestion=suggestions[Number(target.dataset.applyAi)],i=data.issues.find(i=>i.id===suggestion?.id);if(!i)return;i.impact=suggestion.impact;i.action=suggestion.action;i.source='ai';i.reviewed=false;suggestions=suggestions.filter(x=>x.id!==suggestion.id);draw();changed();message('AI候補を入力欄へ反映しました。証拠を確認してから保存してください。点数は変更していません。');return;
  }
  if(busy||!data)return;const current=ticket,url=endpoint();busy=true;for(const el of panel.querySelectorAll('input,textarea,select,button'))el.disabled=true;
  try{
   if(target.hasAttribute('data-save')){
    const items=data.issues.map(({id,scores,certainty,reasons,impact,action,reviewed,source,summary,proofs,steps,expected,observed,reproductionVerified,imageFiles,imagesReviewed})=>({id,scores,certainty,reasons,impact,action,reviewed,source,summary,proofs,steps,expected,observed,reproductionVerified,imageFiles,imagesReviewed}));
    const result=await api(url+'/exam',{method:'POST',body:JSON.stringify({version:data.version,fingerprint:data.fingerprint,items})});if(current!==ticket)return;data=result;dirty=false;draw();message('評価を保存しました。検査の合否と証拠は変更していません。');
   }else if(target.hasAttribute('data-ai')){
    message('Claudeで説明候補を生成しています…');const result=await api(url+'/exam-ai',{method:'POST',body:JSON.stringify({version:data.version,fingerprint:data.fingerprint})});if(current!==ticket)return;suggestions=result.suggestions;
    showSuggestions();message('候補はまだ保存・反映していません。点数はAIに決めさせません。');
   }
  }catch(err){if(current===ticket)message(err.message);}finally{if(current===ticket){busy=false;for(const el of panel.querySelectorAll('input,textarea,select,button'))el.disabled=false;}}
 });
 function render(){const r=state.report?.report,key=r&&r.runStatus==='finished'?`${state.projectId}/${state.runId}`:'';panel.hidden=!key;if(key===scope)return;scope=key;ticket++;data=null;dirty=false;busy=false;suggestions=[];if(key){panel.innerHTML='<h2>診断評価</h2><p>保存済みの検査結果を読み込んでいます…</p>';void load();}}
 return {render};
}
