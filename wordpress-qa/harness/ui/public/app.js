const $=selector=>document.querySelector(selector);
const state={token:'',projects:[],projectId:'',project:null,runId:null,report:null,detail:null,filter:'all',search:'',busy:false,active:null,follow:true,lastActive:false,notice:'',detailKey:'',rowsKey:'',historyKey:'',requesting:false};
let refreshTicket=0;
const names={pass:'合格',fail:'不合格',blocked:'実行不能',not_run:'未実施',review:'確認待ち',not_applicable:'対象外',running:'実行中'};
const suites={audit:'URL・公開設定',journey:'操作・メール',visual:'表示検査',manual:'手動確認'};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Intl.DateTimeFormat('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)):'—';
const duration=ms=>typeof ms==='number'?`${(ms/1000).toFixed(1)}s`:'—';
const projectAPI=()=>`/api/projects/${encodeURIComponent(state.projectId)}`;
const runAPI=()=>`${projectAPI()}/runs/${encodeURIComponent(state.runId)}`;
const fileURL=file=>`${runAPI()}/files?path=${encodeURIComponent(file)}`;
function notify(message){state.notice=message;$('#toast').textContent=message;$('#toast').hidden=!message;}
function showError(message){$('#error').textContent=message;$('#error').hidden=!message;}
async function api(url,options={}){
  const response=await fetch(url,{...options,headers:{...(options.body?{'Content-Type':'application/json','X-QA-Token':state.token}:{}),...options.headers}});
  const data=await response.json();if(!response.ok)throw new Error(data.error??data.message??'処理に失敗しました');return data;
}
function badge(row){const status=row.active?'running':row.status;return `<span class="pill ${escape(status)}">${escape(names[status]??status)}</span>`;}
function renderHistory(runs){
  const key=JSON.stringify([runs,state.runId]);if(key===state.historyKey)return;state.historyKey=key;
  $('#history-count').textContent=runs.length;
  $('#run-list').innerHTML=runs.length?runs.map(r=>{
    const active=state.active?.runId===r.runId;const label=active?'実行中':r.gatePassed?'必須条件充足':r.summary?.fail?'不合格あり':'未確認あり';
    return `<button class="history-item ${r.runId===state.runId?'selected':''}" data-run="${escape(r.runId)}"><span class="history-top"><span><i class="dot ${active?'blue':r.gatePassed?'green':r.summary?.fail?'red':'orange'}"></i>${escape(date(r.startedAt))}</span></span><small>${label} · ${r.summary?.pass??0}件合格</small></button>`;
  }).join(''):'<p class="quiet">履歴はここに表示されます</p>';
}
function renderRows(){
  const report=state.report?.report,rows=report?.rows??[];
  const filtered=rows.filter(r=>(state.filter==='all'||(state.filter==='attention'?['fail','blocked','review'].includes(r.status):r.status===state.filter))&&`${r.id} ${r.title}`.toLowerCase().includes(state.search.toLowerCase()));
  const key=JSON.stringify([filtered,state.detail]);if(key!==state.rowsKey){
    state.rowsKey=key;$('#test-rows').innerHTML=filtered.map(r=>`<tr class="${state.detail===r.id?'row-selected':''}"><td><button class="row-button" data-row="${escape(r.id)}"><strong>${escape(r.title)}</strong><small>${escape(r.id)}${r.required?' · 必須':''}</small></button></td><td class="suite-col">${escape(suites[r.suite]??r.suite)}</td><td>${badge(r)}</td><td class="time-col">${duration(r.durationMs)}</td></tr>`).join('');
  }
  $('#row-count').textContent=rows.length;$('#empty-state').hidden=!!filtered.length;
  if(rows.length&&!filtered.length){$('#empty-state h3').textContent='条件に一致する項目はありません';$('#empty-state p').textContent='絞り込み条件や検索キーワードを変更してください。';}
  else if(!rows.length){$('#empty-state h3').textContent=state.active?'検査を準備しています':'まだ実行履歴がありません';$('#empty-state p').textContent=state.active?'結果の保存を待っています。自動で更新されます。':'検査範囲を選び「検査を実行」を押してください。進捗と証拠は自動で更新されます。';}
  $('#table-note').textContent=rows.length?`${filtered.length} / ${rows.length}項目を表示 · 対象外 ${report.summary?.not_applicable??0}件`:'実行結果はこのPCに保存されます';
}
function renderDetail(){
  const r=state.report?.report?.rows.find(r=>r.id===state.detail);
  const key=JSON.stringify([state.runId,r,state.report?.canApprove,state.report?.candidates,state.busy]);if(key===state.detailKey)return;state.detailKey=key;
  if(!r){$('#detail').innerHTML='<div class="detail-placeholder"><span aria-hidden="true">↖</span><h3>確認したい項目を選択</h3><p>結果の理由、スクリーンショット、<br>ログをここで確認できます。</p></div>';return;}
  const files=r.evidence??[],candidate=state.report.candidates.includes(r.id),canApprove=state.report.canApprove&&!state.busy;
  const descriptions={pass:'この検査は期待した結果に一致しました。',not_run:'この実行では確認していません。対象の検査範囲を選んで実行してください。',review:'人による確認が必要です。証拠と期待する状態を照合してください。',blocked:'前提条件や実行環境を確認してから再実行してください。',not_applicable:'このサイトでは適用外として登録されています。',fail:'期待結果との違いがあります。証拠から原因を確認してください。'};
  $('#detail').innerHTML=`${badge(r)}<h3 class="detail-title">${escape(r.title)}</h3><div class="detail-id">${escape(r.id)}</div><span class="detail-label">判定の内容</span><p class="detail-description">${escape(descriptions[r.status]??'')}</p>${r.reason?`<pre class="reason">${escape(r.reason.replace(/\x1b\[[0-9;]*m/g,''))}</pre>`:''}${files.length?'<span class="detail-label">証拠ファイル</span>':''}<div class="evidence-list">${files.map(f=>`<a class="evidence-link" href="${fileURL(f)}" target="_blank" rel="noopener">${escape(f.split('/').at(-1))} ↗</a>${/\.png$/i.test(f)?`<a href="${fileURL(f)}" target="_blank" rel="noopener"><img class="evidence-image" src="${fileURL(f)}" alt="${escape(f.split('/').at(-1))}"></a>`:''}`).join('')}</div>${candidate?`<div class="approval"><span class="detail-label">基準画像のレビュー</span><p class="detail-description">表示が意図どおりか確認した画像のみ承認します。承認後も、再実行するまで以前の判定は変わりません。</p>${canApprove?'<label><input type="checkbox" id="approve-check">候補画像を確認し、意図した表示であることを確認しました</label><button class="primary" id="approve-button" disabled>この画像を基準として承認</button>':'<p class="approval-note">実行中、または現在の設定と異なる履歴のため承認できません。必要に応じて再実行してください。</p>'}</div>`:''}`;
}
function render(){
  const report=state.report?.report,rows=report?.rows??[],active=state.active?.projectId===state.projectId;
  const live=active&&(!state.runId||state.active.runId===state.runId);
  const selected=rows.filter(r=>r.selected),completed=selected.filter(r=>!r.active&&r.status!=='not_run').length;
  const percent=selected.length?Math.round(completed/selected.length*100):0;
  $('#project-name').textContent=state.project?`${state.project.name} · ${state.project.counts.pages}ページ / ${state.project.planned}項目`:'';
  $('#environment').textContent=({local:'ローカル',staging:'検証環境',production:'本番環境'})[state.project?.environment]??'—';
  $('#run-button').disabled=state.busy||!state.project||state.requesting;$('#suite-select').disabled=state.busy||state.requesting;
  let title='検査を始めましょう',subtitle='実行結果と確認が必要な項目を、ここで確認できます。',label='待機中',tone='neutral',icon='○';
  if(live){title='検査を実行しています';subtitle=rows.find(r=>r.active)?.title??'テストを準備しています';label='実行中';tone='running';icon='◌';}
  else if(state.report?.orphaned){title='実行の完了を確認できません';subtitle='アプリの終了などで中断した可能性があります。ログを確認してください。';label='未完了';tone='blocked';icon='!';}
  else if(report){title=report.gatePassed?'必須条件を満たしています':report.summary?.fail?'不合格の項目を確認してください':'確認が必要な項目が残っています';subtitle=`${date(report.startedAt)} の実行結果 · 手動確認と未実施の項目も確認してください`;label=report.gatePassed?'必須条件充足':report.summary?.fail?'不合格あり':'未確認あり';tone=report.gatePassed?'pass':report.summary?.fail?'fail':'review';icon=report.gatePassed?'✓':report.summary?.fail?'!':'○';}
  $('#run-title').textContent=title;$('#run-subtitle').textContent=subtitle;$('#run-badge').className=`pill ${tone}`;$('#run-badge').textContent=label;
  $('#run-indicator').className=`status-icon ${live?'running':tone==='pass'?'good':tone==='fail'?'bad':''}`;$('#run-indicator').textContent=icon;
  $('#progress-fill').style.width=`${percent}%`;$('.progress-track').setAttribute('aria-valuenow',percent);$('#progress-label').textContent=`${completed} / ${selected.length} 項目`;
  for(const status of ['pass','fail','blocked','review','not_run'])$(`#metric-${status}`).textContent=report?.summary?.[status]??'—';
  $('#report-link').hidden=!report;if(report)$('#report-link').href=fileURL('report.html');
  renderRows();renderDetail();
  $('#run-time').textContent=report?date(report.finishedAt??report.startedAt):'';
  const metadata=[['対象サイト',report?.baseURL??state.project?.baseURL??'—'],['実行ID',report?.runId??'—'],['環境',({local:'ローカル',staging:'検証環境',production:'本番環境'})[report?.environment??state.project?.environment]??'—'],['設定ファイル',state.project?.configPath??'—'],['対象リビジョン',report?.revision??'未指定'],['実行環境',report?.runtime??'—']];
  $('#metadata').innerHTML=metadata.map(([k,v])=>`<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join('');
  $('#run-log').textContent=state.report?.log||state.active?.log||'まだログはありません。';
}
async function refresh(){
  if(!state.projectId||state.requesting)return;
  const ticket=++refreshTicket,expectedProject=state.projectId;
  const current=()=>ticket===refreshTicket&&expectedProject===state.projectId&&!state.requesting;
  try {
    const data=await api(projectAPI());if(!current())return;
    const running=data.active?.projectId===expectedProject&&data.active.kind==='run';
    let runId=state.runId;
    if(state.follow&&running&&data.active.runId)runId=data.active.runId;
    if(!runId&&data.runs.length&&!running)runId=data.runs[0].runId;
    const report=runId?await api('/api/projects/'+encodeURIComponent(expectedProject)+'/runs/'+encodeURIComponent(runId)):null;
    if(!current())return;
    state.project=data.project;state.busy=data.busy;state.active=data.active;
    if(state.lastActive&&!running){notify('実行が完了しました');if(data.lastJob?.exitCode===2&&!data.lastJob.runId)showError(data.lastJob.log||'実行を開始できませんでした');}
    state.lastActive=running;state.runId=runId;state.report=report;
    renderHistory(data.runs);render();
  }catch(e){if(current())showError('状態を取得できませんでした：'+e.message);}
}
$('#project-select').addEventListener('change',async e=>{++refreshTicket;state.projectId=e.target.value;localStorage.setItem('wpqa-project',state.projectId);state.runId=null;state.report=null;state.detail=null;state.follow=true;state.lastActive=false;state.rowsKey='';state.historyKey='';notify('');showError('');render();await refresh();});
$('#run-button').addEventListener('click',async()=>{
  if(state.busy||state.requesting)return;++refreshTicket;state.requesting=true;render();showError('');notify('');
  try{await api(`${projectAPI()}/runs`,{method:'POST',body:JSON.stringify({suite:$('#suite-select').value})});state.follow=true;state.runId=null;state.report=null;state.detail=null;state.lastActive=true;}
  catch(e){showError(e.message);}finally{state.requesting=false;await refresh();}
});
$('#run-list').addEventListener('click',async e=>{const button=e.target.closest('[data-run]');if(!button)return;++refreshTicket;state.runId=button.dataset.run;state.report=null;state.detail=null;state.follow=false;notify('');render();await refresh();});
$('#test-rows').addEventListener('click',e=>{const button=e.target.closest('[data-row]');if(!button)return;state.detail=button.dataset.row;renderRows();renderDetail();});
$('#filters').addEventListener('click',e=>{const button=e.target.closest('[data-filter]');if(!button)return;state.filter=button.dataset.filter;for(const b of $('#filters').querySelectorAll('button')){b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));}renderRows();});
$('#search').addEventListener('input',e=>{state.search=e.target.value;renderRows();});
$('#detail').addEventListener('change',e=>{if(e.target.id==='approve-check')$('#approve-button').disabled=!e.target.checked;});
$('#detail').addEventListener('click',async e=>{
  if(e.target.id!=='approve-button'||!$('#approve-check')?.checked)return;
  const approvedRun=state.report?.report?.runId;
  if(!approvedRun||approvedRun!==state.runId||state.requesting)return;
  const approvalURL=runAPI()+'/approve',approvedId=state.detail;
  ++refreshTicket;state.requesting=true;e.target.disabled=true;showError('');
  try{await api(approvalURL,{method:'POST',body:JSON.stringify({id:approvedId,confirmed:true})});notify('基準画像を承認しました。再実行して比較してください。');}
  catch(error){showError(error.message);}finally{state.requesting=false;state.detailKey='';await refresh();}
});
try{
  const boot=await api('/api/bootstrap');state.token=boot.token;state.projects=boot.projects;$('#demo-label').hidden=!boot.demo;
  $('#project-select').innerHTML=boot.projects.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('');
  const saved=localStorage.getItem('wpqa-project');state.projectId=boot.projects.some(p=>p.id===saved)?saved:boot.projects[0]?.id;
  $('#project-select').value=state.projectId;await refresh();
  // Sequential polling prevents an older response from overwriting a newer state.
  const poll=async()=>{await refresh();setTimeout(poll,1000);};setTimeout(poll,1000);
}catch(e){showError(e.message);}
