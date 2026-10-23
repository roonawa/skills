import {initSettings} from './settings.js';
import {extendedSuites} from './coverage-editor.js';
const $=selector=>document.querySelector(selector);
const state={token:'',projects:[],projectId:'',project:null,runId:null,report:null,detail:null,filter:'all',search:'',busy:false,active:null,follow:true,lastActive:false,notice:'',detailKey:'',rowsKey:'',historyKey:'',requesting:false};
let refreshTicket=0;
let verdictTimer,verdictRun='';
function showVerdict(report,exitCode){
 if(!report||report.runStatus!=='finished'||report.runId===verdictRun)return;
 verdictRun=report.runId;
 const denied=report.rows?.some(r=>r.status==='fail')||report.errors?.length||exitCode===1;
 const granted=!denied&&report.gatePassed===true;
 const tone=denied?'denied':granted?'granted':'pending';
 let panel=document.querySelector('#cinema-verdict');
 if(!panel){panel=document.createElement('section');panel.id='cinema-verdict';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');document.body.append(panel);}
 panel.className='verdict '+tone;
 panel.innerHTML=`<div class="verdict-code">PHANTOM PROTOCOL // EXECUTION COMPLETE</div><div class="verdict-symbol" aria-hidden="true">${denied?'⊗':granted?'✓':'◈'}</div><h2>ACCESS ${denied?'DENIED':granted?'GRANTED':'PENDING'}</h2><p>${denied?'不合格または実行エラーを検出しました。':granted?'すべての必須条件を満たしました。':'未実施・実行不能・確認待ちの項目が残っています。'}</p><small>検査結果の演出表示</small><button type="button">結果に戻る ×</button>`;
 panel.hidden=false;clearTimeout(verdictTimer);
 panel.querySelector('button').onclick=()=>{panel.hidden=true;clearTimeout(verdictTimer);};
 verdictTimer=setTimeout(()=>{panel.hidden=true;},7500);
}
const names={pass:'合格',fail:'不合格',blocked:'実行不能',not_run:'未実施',review:'確認待ち',not_applicable:'対象外',running:'実行中'};
const suites={admin:'管理設定',audit:'URL・公開設定',journey:'操作・メール',visual:'表示検査',manual:'手動確認',...extendedSuites};
for(const [value,label] of Object.entries(extendedSuites))$('#suite-select').add(new Option(label,value));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Intl.DateTimeFormat('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)):'—';
const duration=ms=>typeof ms==='number'?`${(ms/1000).toFixed(1)}s`:'—';
const projectAPI=()=>`/api/projects/${encodeURIComponent(state.projectId)}`;
const runAPI=()=>`${projectAPI()}/runs/${encodeURIComponent(state.runId)}`;
const fileURL=file=>`${runAPI()}/files?path=${encodeURIComponent(file)}`;
$('#filters').insertAdjacentHTML('beforeend','<button data-filter="review" aria-pressed="false">確認待ち</button>');
$('#run-button').insertAdjacentHTML('beforebegin','<button id="operation-tests" type="button">注文・問い合わせを自動テスト</button>');
$('.page-heading').insertAdjacentHTML('afterend','<section id="operation-panel" class="confirmation-panel" hidden></section>');
$('#operation-tests').onclick=async()=>{
 const host=$('#operation-panel'),endpoint=projectAPI(),projectId=state.projectId;
 host.hidden=false;host.textContent='操作テストを読み込んでいます…';
 try{
  const data=await api(endpoint+'/operations');if(projectId!==state.projectId)return;
  if(!data.operations.length){host.textContent='このサイトには自動操作テストが登録されていません。サイトの設定に専用の操作モジュールを登録してください。';return;}
  host.innerHTML=`<h3>注文・問い合わせの自動操作テスト</h3><p>対象：${escape(data.baseURL)} ／ ${escape(data.environment)}</p><p>ブラウザーを自動操作し、入力・画面遷移・完了表示と証拠画像を記録します。メール到着や注文取消の確認は別途必要です。</p><form id="operation-form"><label>操作<select name="operation">${data.operations.map(o=>`<option value="${escape(o.id)}">${escape(o.title)}</option>`).join('')}</select></label><p id="operation-description"></p><label>実行範囲<select name="mode"><option value="preview">入力・確認画面まで（注文確定・送信なし）</option><option value="submit">注文確定／問い合わせ送信まで（新規1件）</option></select></label><label>サイト閲覧パスワード（保護されている場合）<input name="password" type="password" autocomplete="off"></label><p>パスワードは今回の実行だけに使います。管理画面のログイン情報は入力しないでください。</p><label><input name="confirmed" type="checkbox" required> 対象サイト・操作内容・実行範囲を確認しました</label><button type="submit" class="primary" ${!data.enabled?'disabled':''}>自動操作を開始</button><button type="button" id="close-operations">閉じる</button></form>`;
  const form=host.querySelector('form');
  $('#operation-description').insertAdjacentHTML('afterend','<div id="operation-pending"></div>');
  const describe=()=>{
   const operation=data.operations.find(o=>o.id===form.elements.operation.value);
   $('#operation-description').textContent=operation.description;form.elements.confirmed.checked=false;
   $('#operation-pending').innerHTML=operation.pending?`<p>前回の送信記録：${escape(operation.pending.token)}。${escape(operation.pending.cleanup)}。新しい送信は停止しています。</p><label>前回の結果・注文取消の確認内容<textarea id="operation-resolution" maxlength="10000"></textarea></label><button type="button" id="release-operation">前回の結果・後片付けを確認済みにする</button>`:'';
   if(operation.pending)$('#release-operation').onclick=async()=>{
    if(state.busy||state.requesting)return;const notes=$('#operation-resolution').value.trim();if(!notes){showError('前回の結果・注文取消の確認内容を入力してください');return;}
    state.requesting=true;$('#release-operation').disabled=true;
    try{await api(endpoint+'/operations/'+encodeURIComponent(operation.id)+'/release',{method:'POST',body:JSON.stringify({configHash:data.configHash,token:operation.pending.token,confirmed:true,notes})});operation.pending=null;describe();notify('前回の確認記録を保存しました。新しい操作テストを実行できます。');}
    catch(error){showError(error.message);$('#release-operation').disabled=false;}finally{state.requesting=false;}
   };
  };describe();form.elements.operation.onchange=describe;form.elements.mode.onchange=()=>{form.elements.confirmed.checked=false;};
  $('#close-operations').onclick=()=>{form.reset();host.hidden=true;};
  form.onsubmit=async event=>{
   event.preventDefault();if(state.requesting||state.busy||projectId!==state.projectId)return;
   const operation=form.elements.operation.value,payload={configHash:data.configHash,mode:form.elements.mode.value,password:form.elements.password.value,confirmed:form.elements.confirmed.checked};
   form.elements.password.value='';state.requesting=true;form.querySelector('button[type=submit]').disabled=true;showError('');
   try{await api(endpoint+'/operations/'+encodeURIComponent(operation),{method:'POST',body:JSON.stringify(payload)});host.hidden=true;state.follow=true;state.runId=null;state.report=null;state.detail=null;state.lastActive=true;notify('自動操作テストを開始しました。結果と証拠は新しい実行履歴に保存されます。');}
   catch(error){showError(error.message);form.querySelector('button[type=submit]').disabled=false;}
   finally{payload.password='';state.requesting=false;await refresh();}
  };
 }catch(error){host.textContent=error.message;}
};
$('#operation-tests').textContent='送信履歴・後片付け';
$('.page-heading').insertAdjacentHTML('afterend','<details class="confirmation-panel" id="standard-operation-settings"><summary>注文・問い合わせの実行設定</summary><p>「すべての検査」「操作・メール」では、登録済みの注文・問い合わせテストも実行します。</p><label>実行範囲<select id="standard-operation-mode"><option value="preview">入力・確認画面まで（送信なし）</option><option value="submit">注文確定・問い合わせ送信まで</option></select></label><label>サイト閲覧パスワード<input id="standard-operation-password" type="password" autocomplete="off"></label><label><input type="checkbox" id="standard-operation-confirmed"> 注文と問い合わせをそれぞれ新規1件送信することを確認しました</label></details>');
$('#standard-operation-mode').onchange=()=>{$('#standard-operation-confirmed').checked=false;};
$('#run-button').insertAdjacentHTML('beforebegin','<button id="preflight-button">実行前の確認</button><button id="stop-button" hidden>検査を停止</button>');
$('#metadata').insertAdjacentHTML('afterend','<div id="recovery-info"></div><button id="recover-button" hidden>残ったテストデータを回収</button>');
$('#report-link').insertAdjacentHTML('afterend','<details id="issue-report-panel"><summary>不具合報告書を作成</summary><p>選択した実行の証拠を集約し、影響・管理画面での修正候補・再確認項目をHTMLにまとめます。</p><label><input type="checkbox" id="issue-report-history" checked> 未実施の項目を同じ設定の過去結果で補う（出典を明記）</label><label for="issue-report-notes">追加調査・担当者の補足（任意）</label><textarea id="issue-report-notes" maxlength="10000" rows="4" placeholder="確認者・確認日・原因を確定した根拠など。認証情報は記載しないでください。"></textarea><button id="issue-report-generate" type="button">報告書を生成</button><a id="issue-report-open" target="_blank" rel="noopener" hidden>生成した報告書を開く ↗</a><p id="issue-report-status" role="status"></p></details>');
$('#report-link').parentElement.after($('#issue-report-panel'));
$('#issue-report-panel p').textContent='検査証拠から、影響・修正候補・再現手順・スクリーンショットをHTMLにまとめます。赤枠付き画像は新しい表示検査で取得します。既存の履歴に画像がない場合は、表示検査を再実行してください。';
let issueReportScope='';
$('#issue-report-generate').onclick=async()=>{
  if(state.requesting||!state.runId)return;
  const scope=`${state.projectId}/${state.runId}`,endpoint=runAPI();
  state.requesting=true;render();showError('');
  $('#issue-report-open').hidden=true;
  $('#issue-report-status').textContent='証拠から報告書を生成しています…';
  try{
    const data=await api(`${endpoint}/issue-report`,{method:'POST',body:JSON.stringify({includeHistory:$('#issue-report-history').checked,notes:$('#issue-report-notes').value})});
    if(scope!==`${state.projectId}/${state.runId}`)return;
    $('#issue-report-open').href=`${endpoint}/files?path=${encodeURIComponent(data.file)}`;
    $('#issue-report-open').hidden=false;
    $('#issue-report-status').textContent=`不合格${data.failedCases}ケースを修正候補${data.issueCount}項目に整理しました。${data.warnings.length?'証拠の読取りに関する注意があります。':''}`;
  }catch(error){if(scope===`${state.projectId}/${state.runId}`){showError(error.message);$('#issue-report-status').textContent='生成できませんでした。';}}
  finally{state.requesting=false;render();}
};
$('.page-heading').insertAdjacentHTML('afterend','<div id="preflight-result" role="status"></div>');
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
const openGroups=new Set();let groupScope='';
const displayReadiness='共通: 可視画像・フォントの読込みを確認。JavaScript例外は独立検査。';
function classifyRow(r){
  const prefix=r.id.split('.')[0];
  const categories={
    javascript:['JavaScriptエラー','ページ表示・表示準備・画像スクロール中の未捕捉例外を検査。他の表示検査は続行。'],
    page:['HTTP・メタ情報','HTTP 200、HTML形式、タイトル、canonical、noindexの期待値を確認。'],
    links:['内部リンク','ページ内の内部リンク先にアクセスでき、HTTPエラーにならないことを確認。'],
    layout:['レイアウト','画面幅からの横はみ出しを確認。'+displayReadiness],
    axe:['アクセシビリティ','axeによるWCAG 2.0・2.1 A／AAの自動検査。'+displayReadiness],
    snapshot:['画像比較','承認済み基準画像と比較。未承認時は確認待ち。'+displayReadiness],
  };
  if(categories[prefix])return [prefix,...categories[prefix]];
  if(prefix==='policy'){
    const target=`${r.id} ${r.title}`;
    if(/soft-404/.test(target))return ['soft-404','存在しないページ','存在しないURLが404を返すことを確認。'];
    if(/wp-config\.php\.bak|wp-config-bak|hidden-|readme|git-head|env-file|debug-log/.test(target))return ['hidden-files','非公開ファイル等','バックアップ・README・Git情報・環境設定・ログの応答と、設定された転送先・禁止文字列を確認。'];
    if(/wp-config/.test(target))return ['wp-config','設定ファイル','wp-config.phpの応答と、設定内容を示す特定文字列の露出を確認。'];
    if(/users-rest|wp\/v2\/users/.test(target))return ['users-rest','ユーザー情報API','未認証でのユーザー一覧取得が拒否されることを確認。'];
    if(/author-enum|author=/.test(target))return ['author-enum','投稿者URL','投稿者URLの転送先と、指定管理者名が本文に含まれないことを確認。'];
    if(/xmlrpc/.test(target))return ['xmlrpc','XML-RPC','GET応答のHTTPステータスを確認。POSTの無効化は未検証。'];
  }
  // 未知の検査は独立して残し、異なる検査内容をまとめない。
  return [r.id,r.title,'個別に登録された検査。詳細で判定内容を確認できます。'];
}
function renderRows(){
  const report=state.report?.report,rows=report?.rows??[];
  const scope=`${state.projectId}/${state.runId}`;
  if(groupScope!==scope){openGroups.clear();groupScope=scope;}
  const groups=new Map();
  for(const r of rows){
    const [id,title,description]=classifyRow(r);
    if(!groups.has(id))groups.set(id,{id,title,description,rows:[]});
    groups.get(id).rows.push(r);
  }
  const visible=[...groups.values()].map(g=>({...g,matches:g.rows.filter(r=>(state.filter==='all'||(state.filter==='attention'?['fail','blocked','review'].includes(r.status):r.status===state.filter))&&`${g.title} ${g.description} ${r.id} ${r.title}`.toLowerCase().includes(state.search.toLowerCase()))})).filter(g=>g.matches.length);
  const key=JSON.stringify([visible,state.detail,[...openGroups]]);if(key!==state.rowsKey){
    state.rowsKey=key;$('#test-rows').innerHTML=visible.map((g,index)=>{
      const expanded=openGroups.has(g.id),counts={};
      for(const r of g.rows){const status=r.active?'running':r.status;counts[status]=(counts[status]??0)+1;}
      const summary=Object.entries(counts).map(([status,count])=>`${names[status]??status} ${count}`).join(' / ');
      const status=['fail','blocked','running','review','not_run','pass','not_applicable'].find(s=>counts[s])??'not_run';
      const children=g.matches.map(r=>`<tr class="group-child ${state.detail===r.id?'row-selected':''}"><td><button class="row-button" data-row="${escape(r.id)}"><strong>${escape(r.title)}</strong><small>${escape(r.id)}${r.required?' · 必須':''}</small></button></td><td class="suite-col">${escape(suites[r.suite]??r.suite)}</td><td>${badge(r)}</td><td class="time-col">${duration(r.durationMs)}</td></tr>`).join('');
      return `<tr class="group-heading"><td colspan="2"><button class="row-button group-toggle" data-group="${escape(g.id)}" aria-expanded="${expanded}" aria-controls="group-${index}"><strong>${expanded?'▾':'▸'} ${escape(g.title)} <span class="count">${g.rows.length}</span></strong><small>${escape(g.description)}</small><small>全体: ${escape(summary)}${g.matches.length!==g.rows.length?` · 絞り込み一致 ${g.matches.length}件`:''}</small></button></td><td>${badge({status})}</td><td class="time-col">${duration(g.rows.reduce((total,r)=>total+(r.durationMs??0),0))}</td></tr><tr id="group-${index}" class="group-results" ${expanded?'':'hidden'}><td colspan="4">${expanded?`<p class="group-caption">URL・条件ごとの結果（${g.matches.length}件）。項目を選ぶと判定理由・証拠を表示します。</p><table class="group-table"><thead><tr><th>URL・条件</th><th class="suite-col">種別</th><th>結果</th><th class="time-col">時間</th></tr></thead><tbody>${children}</tbody></table>`:''}</td></tr>`;
    }).join('');
  }
  $('#row-count').textContent=`${groups.size}分類`;$('#empty-state').hidden=!!visible.length;
  if(rows.length&&!visible.length){$('#empty-state h3').textContent='条件に一致する項目はありません';$('#empty-state p').textContent='絞り込み条件や検索キーワードを変更してください。';}
  else if(!rows.length){$('#empty-state h3').textContent=state.active?'検査を準備しています':'まだ実行履歴がありません';$('#empty-state p').textContent=state.active?'結果の保存を待っています。自動で更新されます。':'検査範囲を選び「検査を実行」を押してください。進捗と証拠は自動で更新されます。';}
  $('#table-note').textContent=rows.length?`${visible.length} / ${groups.size}分類 · URL・条件別 ${rows.length}件（絞り込み一致 ${visible.reduce((n,g)=>n+g.matches.length,0)}件） · 上部の集計はURL・条件別の件数`:'実行結果はこのPCに保存されます';
}
function renderDetail(){
  const r=state.report?.report?.rows.find(r=>r.id===state.detail);
  const key=JSON.stringify([state.runId,r,state.report?.canApprove,state.report?.candidates,state.busy]);if(key===state.detailKey)return;state.detailKey=key;
  if(!r){$('#detail').innerHTML='<div class="detail-placeholder"><span aria-hidden="true">↖</span><h3>確認したい項目を選択</h3><p>結果の理由、スクリーンショット、<br>ログをここで確認できます。</p></div>';return;}
  const files=r.evidence??[],candidate=state.report.candidates.includes(r.id),canApprove=state.report.canApprove&&!state.busy;
  const descriptions={pass:'この検査は期待した結果に一致しました。',not_run:'この実行では確認していません。対象の検査範囲を選んで実行してください。',review:'人による確認が必要です。証拠と期待する状態を照合してください。',blocked:'前提条件や実行環境を確認してから再実行してください。',not_applicable:'このサイトでは適用外として登録されています。',fail:'期待結果との違いがあります。証拠から原因を確認してください。'};
  $('#detail').innerHTML=`${badge(r)}<h3 class="detail-title">${escape(r.title)}</h3><div class="detail-id">${escape(r.id)}</div><span class="detail-label">判定の内容</span><p class="detail-description">${escape(descriptions[r.status]??'')}</p>${r.setting?`<span class="detail-label">設定の照合</span><dl><dt>取得方法</dt><dd>${escape(r.setting.source)}</dd><dt>期待値</dt><dd>${escape(JSON.stringify(r.setting.expected))}</dd><dt>取得した値</dt><dd>${escape(JSON.stringify(r.setting.actual))}</dd></dl>`:''}${r.reason?`<pre class="reason">${escape(r.reason.replace(/\x1b\[[0-9;]*m/g,''))}</pre>`:''}${files.length?'<span class="detail-label">証拠ファイル</span>':''}<div class="evidence-list">${files.map(f=>`<a class="evidence-link" href="${fileURL(f)}" target="_blank" rel="noopener">${escape(f.split('/').at(-1))} ↗</a>${/\.png$/i.test(f)?`<a href="${fileURL(f)}" target="_blank" rel="noopener"><img class="evidence-image" src="${fileURL(f)}" alt="${escape(f.split('/').at(-1))}"></a>`:''}`).join('')}</div>${candidate?`<div class="approval"><span class="detail-label">基準画像のレビュー</span><p class="detail-description">表示が意図どおりか確認した画像のみ承認します。承認後も、再実行するまで以前の判定は変わりません。</p>${canApprove?'<label><input type="checkbox" id="approve-check">候補画像を確認し、意図した表示であることを確認しました</label><button class="primary" id="approve-button" disabled>この画像を基準として承認</button>':'<p class="approval-note">実行中、または現在の設定と異なる履歴のため承認できません。必要に応じて再実行してください。</p>'}</div>`:''}`;
  if(r.status==='blocked'){
    const help=document.createElement('section');help.className='blocked-help';help.setAttribute('aria-live','polite');help.textContent='不足している設定を確認しています…';$('#detail .detail-id').after(help);
    const url=runAPI()+'/guidance/'+encodeURIComponent(r.id);
    api(url).then(g=>{
      if(!help.isConnected)return;
      help.innerHTML=`<h4>実行できるようにするには</h4>${g.changed?'<p class="guidance-history">この履歴の実行後に設定が変わっています。以下は現在の設定の案内です。</p>':''}<h5>不足・確認が必要なもの</h5><ul>${g.missing.map(x=>`<li>${escape(x)}</li>`).join('')}</ul><h5>設定する場所</h5><p>${escape(g.location)}</p><h5>対応手順</h5><ol>${g.steps.map(x=>`<li>${escape(x)}</li>`).join('')}</ol><p class="quiet">${escape(g.scope)}</p><button type="button" data-open-settings ${state.busy?'disabled':''}>設定画面を開く</button>`;
      help.querySelector('[data-open-settings]').onclick=()=>$('#edit-site').click();
    }).catch(e=>{if(help.isConnected)help.textContent='設定案内を取得できませんでした。項目を選び直してください：'+e.message;});
  }
  if(r.details)$('#detail').insertAdjacentHTML('beforeend',`<details class="check-details"><summary>期待値と取得結果</summary><pre class="reason">${escape(JSON.stringify(r.details,null,2))}</pre></details>`);
  if(r.diagnostics)$('#detail').insertAdjacentHTML('beforeend',`<details class="check-details" open><summary>実行経過・失敗時の証拠</summary><pre class="reason">${escape(JSON.stringify(r.diagnostics,null,2))}</pre></details>`);
  if(r.instructions)$('#detail').insertAdjacentHTML('beforeend',`<p class="detail-description">${escape(r.instructions)}</p>`);
  if(r.manualReview)$('#detail').insertAdjacentHTML('beforeend',`<form id="manual-review" class="manual-review"><h4>人手による判定を記録</h4>${r.review?`<p>前回: ${escape(r.review.reviewer)} · ${escape(date(r.review.timestamp))} · ${escape(names[r.review.outcome])}</p>`:''}<label>確認者<input name="reviewer" required maxlength="10000" value="${escape(r.review?.reviewer??'')}"></label><label>判定<select name="outcome"><option value="pass">合格</option><option value="fail">不合格</option><option value="not_applicable">対象外</option></select></label><label>確認内容・判断理由<textarea name="notes" required maxlength="10000" rows="4">${escape(r.review?.notes??'')}</textarea></label><label>証拠・実施環境（1行に1件）<textarea name="evidence" required rows="4">${escape((r.review?.evidence??[]).join('\n'))}</textarea></label><button type="submit" class="primary" ${state.busy?'disabled':''}>判定を保存</button></form>`);
  if(r.manualReview){
    $('#manual-review').hidden=true;
    $('#detail .detail-id').insertAdjacentHTML('afterend',`<section class="confirmation-panel"><button type="button" id="start-confirmation" ${!canApprove?'disabled':''}>確認を進める</button><p>手順ごとに確認し、途中結果・証拠を保存できます。サイトへの送信は自動実行しません。</p><div id="confirmation-workspace"></div></section>`);
  }else if(['review','blocked','fail','not_run'].includes(r.status)){
    $('#detail').insertAdjacentHTML('beforeend',`<section class="confirmation-panel"><p>${candidate?'候補画像を上の欄で確認・承認してから比較を実行します。':'登録済みの検査処理をこの項目だけ実行します。'}</p><button id="execute-case" type="button" ${!canApprove?'disabled':''}>この項目を再検査</button></section>`);
  }
}
function render(){
  const report=state.report?.report,rows=report?.rows??[],active=state.active?.projectId===state.projectId;
  const live=active&&(!state.runId||state.active.runId===state.runId);
  document.body.classList.toggle('cinema-active',!!active&&state.active?.kind==='run');
  const cinemaStatus=document.querySelector('.cinema-caption b');
  if(cinemaStatus)cinemaStatus.textContent=active&&state.active?.kind==='run'?'EXECUTING / OVERDRIVE · 演出':'SIMULATED FEED · 演出';
  const selected=rows.filter(r=>r.selected),completed=selected.filter(r=>!r.active&&r.status!=='not_run').length;
  const percent=selected.length?Math.round(completed/selected.length*100):0;
  $('#project-name').textContent=state.project?`${state.project.name} · ${state.project.counts.pages}ページ / ${state.project.planned}項目`:'';
  $('#environment').textContent=({local:'ローカル',staging:'検証環境',production:'本番環境'})[state.project?.environment]??'—';
  $('#run-button').disabled=state.busy||!state.project||state.requesting;$('#suite-select').disabled=state.busy||state.requesting;
  $('#preflight-button').disabled=state.busy||!state.project||state.requesting;
  $('#stop-button').hidden=!(active&&state.active?.kind==='run');
  $('#stop-button').disabled=state.requesting||state.active?.state==='stopping';
  $('#stop-button').textContent=state.active?.state==='stopping'?'後始末を待っています':'検査を停止';
  const pending=state.report?.recovery?.pending??0;
  $('#recovery-info').textContent=pending?`未回収のテストデータ: ${pending}件。次の実行前に回収してください。`:'';
  $('#recover-button').hidden=!pending;$('#recover-button').disabled=state.busy||state.requesting;
  let title='検査を始めましょう',subtitle='実行結果と確認が必要な項目を、ここで確認できます。',label='待機中',tone='neutral',icon='○';
  if(live){title='検査を実行しています';subtitle=rows.find(r=>r.active)?.title??'テストを準備しています';label='実行中';tone='running';icon='◌';}
  else if(state.report?.orphaned){title='実行の完了を確認できません';subtitle='アプリの終了などで中断した可能性があります。ログを確認してください。';label='未完了';tone='blocked';icon='!';}
  else if(report?.runStatus==='planned'){title='テストケースを実行できます';subtitle='未実施のケース一覧です。検査範囲を選び「検査を実行」を押してください。';label='未実施';tone='not_run';icon='○';}
  else if(report){title=report.gatePassed?'必須条件を満たしています':report.summary?.fail?'不合格の項目を確認してください':'確認が必要な項目が残っています';subtitle=`${date(report.startedAt)} の実行結果 · 手動確認と未実施の項目も確認してください`;label=report.gatePassed?'必須条件充足':report.summary?.fail?'不合格あり':'未確認あり';tone=report.gatePassed?'pass':report.summary?.fail?'fail':'review';icon=report.gatePassed?'✓':report.summary?.fail?'!':'○';}
  $('#run-title').textContent=title;$('#run-subtitle').textContent=subtitle;$('#run-badge').className=`pill ${tone}`;$('#run-badge').textContent=label;
  $('#run-indicator').className=`status-icon ${live?'running':tone==='pass'?'good':tone==='fail'?'bad':''}`;$('#run-indicator').textContent=icon;
  $('#progress-fill').style.width=`${percent}%`;$('.progress-track').setAttribute('aria-valuenow',percent);$('#progress-label').textContent=`${completed} / ${selected.length} 項目`;
  for(const status of ['pass','fail','blocked','review','not_run'])$(`#metric-${status}`).textContent=report?.summary?.[status]??'—';
  $('#report-link').hidden=!report;if(report)$('#report-link').href=fileURL('report.html');
  $('#issue-report-panel').hidden=!report;
  $('#issue-report-generate').disabled=state.requesting||report?.runStatus!=='finished';
  const reportScope=`${state.projectId}/${state.runId}`;
  if(issueReportScope!==reportScope){issueReportScope=reportScope;$('#issue-report-open').hidden=true;$('#issue-report-status').textContent='';$('#issue-report-notes').value='';}
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
    const completed=state.lastActive&&!running&&data.lastJob?.kind==='run'&&data.lastJob?.projectId===expectedProject;
    const completedId=completed?data.lastJob.runId:null;
    const completedReport=completedId?(completedId===runId?report:await api('/api/projects/'+encodeURIComponent(expectedProject)+'/runs/'+encodeURIComponent(completedId))):null;
    if(!current())return;
    state.project=data.project;state.busy=data.busy;state.active=data.active;
    if(state.lastActive&&!running){notify(completedReport?.report.runStatus==='interrupted'?'検査を停止しました。実行済みの結果と後始末の状態を確認してください。':'実行が完了しました');if(data.lastJob?.exitCode===2&&!data.lastJob.runId)showError(data.lastJob.log||'実行を開始できませんでした');}
    state.lastActive=running;state.runId=runId;state.report=report;
    renderHistory(data.runs);render();
    if(completedReport)showVerdict(completedReport.report,data.lastJob.exitCode);
  }catch(e){if(current())showError('状態を取得できませんでした：'+e.message);}
}
$('#project-select').addEventListener('change',async e=>{++refreshTicket;state.projectId=e.target.value;localStorage.setItem('wpqa-project',state.projectId);state.runId=null;state.report=null;state.detail=null;state.follow=true;state.lastActive=false;state.rowsKey='';state.historyKey='';notify('');showError('');render();await refresh();});
$('#run-button').addEventListener('click',async()=>{
  const verdict=document.querySelector('#cinema-verdict');if(verdict)verdict.hidden=true;
  if(state.busy||state.requesting)return;++refreshTicket;state.requesting=true;render();showError('');notify('');
  try{const operation={mode:$('#standard-operation-mode').value,password:$('#standard-operation-password').value,confirmed:$('#standard-operation-confirmed').checked};$('#standard-operation-password').value='';await api(`${projectAPI()}/runs`,{method:'POST',body:JSON.stringify({suite:$('#suite-select').value,operation})});state.follow=true;state.runId=null;state.report=null;state.detail=null;state.lastActive=true;}
  catch(e){showError(e.message);}finally{state.requesting=false;await refresh();}
});
$('#preflight-button').onclick=async()=>{
 const projectId=state.projectId;
 try{const result=await api(projectAPI()+'/preflight');if(state.projectId!==projectId)return;$('#preflight-result').innerHTML=`<p>${result.ready?'設定上の前提条件を満たしています。':'設定に確認事項があります。'}</p><ul>${result.issues.map(i=>`<li>${escape(i.id)}: ${escape(i.message)}</li>`).join('')}</ul><p>${escape(result.scope)}</p>`;}catch(e){showError(e.message);}
};
$('#project-select').addEventListener('change',()=>$('#preflight-result').replaceChildren());
for(const [id,suffix,message] of [['stop-button','/stop','停止を要求しました。安全な後始末の完了を待っています。'],['recover-button','/recover','回収結果を更新しました。']]){
 $('#'+id).onclick=async()=>{
  if(state.requesting)return;state.requesting=true;render();showError('');
  try{await api((id==='stop-button'?projectAPI():runAPI())+suffix,{method:'POST',body:'{}'});notify(message);}catch(e){showError(e.message);}finally{state.requesting=false;await refresh();}
 };
}
$('#run-list').addEventListener('click',async e=>{const button=e.target.closest('[data-run]');if(!button)return;++refreshTicket;state.runId=button.dataset.run;state.report=null;state.detail=null;state.follow=false;notify('');render();await refresh();});
$('#test-rows').addEventListener('click',e=>{
  const group=e.target.closest('[data-group]');
  if(group){const id=group.dataset.group;openGroups.has(id)?openGroups.delete(id):openGroups.add(id);renderRows();[...$('#test-rows').querySelectorAll('[data-group]')].find(b=>b.dataset.group===id)?.focus();return;}
  const button=e.target.closest('[data-row]');if(!button)return;state.detail=button.dataset.row;renderRows();renderDetail();
});
$('#filters').addEventListener('click',e=>{const button=e.target.closest('[data-filter]');if(!button)return;state.filter=button.dataset.filter;for(const b of $('#filters').querySelectorAll('button')){b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));}renderRows();});
$('#search').addEventListener('input',e=>{state.search=e.target.value;renderRows();});
$('#detail').addEventListener('change',e=>{if(e.target.id==='approve-check')$('#approve-button').disabled=!e.target.checked;});
$('#detail').addEventListener('click',async e=>{
 if(e.target.id==='start-confirmation'){
  const host=$('#confirmation-workspace'),endpoint=runAPI()+'/confirmation/'+encodeURIComponent(state.detail);
  e.target.disabled=true;
  try{
   const plan=await api(endpoint);if(!host.isConnected)return;
   host.innerHTML=`<form id="confirmation-form"><p>${escape(plan.warning)}</p><label>確認者<input name="reviewer" required maxlength="1000" value="${escape(plan.reviewer)}"></label>${plan.steps.map(s=>`<fieldset data-step="${escape(s.id)}"><legend>${escape(s.title)}</legend><label>結果<select name="status">${['review','pass','fail','not_applicable'].map(v=>`<option value="${v}" ${v===s.status?'selected':''}>${names[v]}</option>`).join('')}</select></label><label>証拠・確認内容<textarea name="evidence" rows="3" maxlength="10000">${escape(s.evidence)}</textarea></label></fieldset>`).join('')}<label>補足<textarea name="notes" maxlength="10000">${escape(plan.notes)}</textarea></label><button type="submit" value="draft">途中保存</button><button type="submit" value="finish" class="primary">確認を完了</button></form>`;
   host.querySelector('form').onsubmit=async event=>{
    event.preventDefault();if(state.requesting||state.busy)return;
    const form=event.target;
    const payload={reviewer:form.elements.reviewer.value,notes:form.elements.notes.value,finish:event.submitter?.value==='finish',steps:[...form.querySelectorAll('[data-step]')].map(f=>({id:f.dataset.step,status:f.querySelector('select').value,evidence:f.querySelector('textarea').value}))};
    state.requesting=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await api(endpoint,{method:'POST',body:JSON.stringify(payload)});notify(payload.finish?'確認結果を保存しました':'途中結果を保存しました。確認待ちとして残しています。');state.detailKey='';}
    catch(error){showError(error.message);form.querySelectorAll('button').forEach(b=>b.disabled=false);}
    finally{state.requesting=false;await refresh();}
   };
  }catch(error){showError(error.message);if(e.target.isConnected)e.target.disabled=false;}
 }
 if(e.target.id==='execute-case'){
  if(state.requesting||state.busy)return;
  const endpoint=runAPI()+'/execute',rowId=state.detail;
  state.requesting=true;e.target.disabled=true;showError('');
  try{await api(endpoint,{method:'POST',body:JSON.stringify({rowId})});state.follow=true;state.runId=null;state.report=null;state.detail=null;state.lastActive=true;notify('選択した項目の再検査を開始しました');}
  catch(error){showError(error.message);state.detailKey='';}
  finally{state.requesting=false;await refresh();}
 }
});
$('#detail').addEventListener('submit',async e=>{
 if(e.target.id!=='manual-review')return;e.preventDefault();if(state.requesting||state.busy)return;
 const form=e.target,values=new FormData(form),url=runAPI()+'/review',rowId=state.detail;
 const payload={rowId,reviewer:values.get('reviewer').trim(),outcome:values.get('outcome'),notes:values.get('notes').trim(),evidence:values.get('evidence').split(/\r?\n/).map(v=>v.trim()).filter(Boolean)};
 ++refreshTicket;state.requesting=true;form.querySelector('button').disabled=true;showError('');
 try{await api(url,{method:'POST',body:JSON.stringify(payload)});notify('人手による判定を保存しました');}catch(error){showError(error.message);}finally{state.requesting=false;state.detailKey='';await refresh();}
});
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

initSettings({api,currentProject:()=>state.projectId,onSaved:async id=>{
  $('#preflight-result').replaceChildren();
  ++refreshTicket;state.projectId=id;state.project=null;state.runId=null;state.report=null;state.detail=null;state.follow=true;state.lastActive=false;
  const boot=await api('/api/bootstrap');state.projects=boot.projects;
  $('#project-select').innerHTML=boot.projects.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('');$('#project-select').value=id;
  localStorage.setItem('wpqa-project',id);notify('サイト設定を保存しました');render();await refresh();
}});

// Movie-prop telemetry: entirely local decoration, independent of QA state.
const cinemaToggle=document.querySelector('#cinema-toggle');
const cinemaFeed=document.querySelector('#cinema-feed');
let cinemaPaused=matchMedia('(prefers-reduced-motion: reduce)').matches;
const cinemaLines=['[ghost] negotiating with imaginary mainframe','[trace] bouncing signal through /dev/null','[decode] entropy exceeds cinematic requirements','[link] localhost tunnel remains extremely local','[scan] triangulating the missing semicolon','[sync] 0xDEADBEEF :: dramatic checksum accepted','[sys] no actual intrusion. just excellent lighting.'];
let cinemaTick=0;
function cinemaState(){document.body.classList.toggle('cinema-paused',cinemaPaused);cinemaToggle.textContent=cinemaPaused?'演出を再開 ▶':'演出を停止 Ⅱ';cinemaToggle.setAttribute('aria-pressed',String(cinemaPaused));}
let cinemaLast=0;
const cinemaWave=document.querySelector('.signal-wave>path');
const cinemaHex=document.querySelector('.hex-feed');
if(cinemaToggle&&cinemaFeed){cinemaState();cinemaToggle.addEventListener('click',()=>{cinemaPaused=!cinemaPaused;cinemaState();});setInterval(()=>{
 if(cinemaPaused||document.hidden)return;
 const intense=document.body.classList.contains('cinema-active'),now=Date.now();
 if(now-cinemaLast<(intense?100:2100))return;cinemaLast=now;
 const lines=cinemaFeed.textContent.split('\n').slice(intense?-2:-4);
 for(let i=0;i<(intense?3:1);i++)lines.push((intense?'['+(cinemaTick%65536).toString(16).padStart(4,'0').toUpperCase()+'] ':'')+cinemaLines[cinemaTick++%cinemaLines.length]);
 cinemaFeed.textContent=lines.join('\n');
 const cipher=document.querySelector('#cipher-stream');
 if(cipher){cipher.textContent='KEY 0x'+(cinemaTick*7919%65536).toString(16).toUpperCase().padStart(4,'0')+' :: SEARCHING THE VOID\n'+['ENTROPY...........UNNECESSARY','PAYLOAD...........PURE CINEMA','CIPHER............STILL MYSTERIOUS'][cinemaTick%3]+'\nBLOCK '+String(cinemaTick).padStart(6,'0')+' / NO SECRETS FOUND';document.querySelector('.memory-grid')?.classList.toggle('shifted',cinemaTick%2===0);}
 if(cinemaWave){const points=Array.from({length:45},(_,i)=>`${i*10} ${Math.round(50+(Math.random()-.5)*(intense?88:20))}`);cinemaWave.setAttribute('d','M'+points.join(' L'));}
 if(intense&&cinemaHex)cinemaHex.textContent=Array.from({length:3},(_,i)=>'0x'+(cinemaTick*16+i*16).toString(16).toUpperCase().padStart(4,'0')+'  '+Array.from({length:8},()=>Math.floor(Math.random()*256).toString(16).toUpperCase().padStart(2,'0')).join(' ')).join('\n');
},100);}
