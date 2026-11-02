import {initSiteExam} from './site-exam.js';
import {initAiSettings} from './ai-settings.js';
import {initSettings} from './settings.js';
import {initExternalAuth} from './external-auth.js';
import {initRegistration} from './registration.js';
import {initDesignerReport} from './designer-report.js';
import {extendedSuites} from './coverage-editor.js';
import {preparationImportance} from './case-generator.js';
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
 panel.innerHTML=`<div class="verdict-code">SITE EXAM_ // EXECUTION COMPLETE</div><div class="verdict-symbol" aria-hidden="true">${denied?'⊗':granted?'✓':'◈'}</div><h2>ACCESS ${denied?'DENIED':granted?'GRANTED':'PENDING'}</h2><p>${denied?'不合格または実行エラーを検出しました。':granted?'すべての必須条件を満たしました。':'未実施・実行不能・直接確認の項目が残っています。'}</p><small>検査結果の演出表示</small><button type="button">結果に戻る ×</button>`;
 panel.hidden=false;clearTimeout(verdictTimer);
 panel.querySelector('button').onclick=()=>{panel.hidden=true;clearTimeout(verdictTimer);};
 verdictTimer=setTimeout(()=>{panel.hidden=true;},7500);
}
const names={preparation:'設定が必要',pass:'合格',fail:'不合格',blocked:'実行不能',not_run:'未実施',review:'直接確認',caution:'注意',not_applicable:'対象外',running:'実行中'};
const suites={admin:'管理設定',audit:'URL・公開設定',journey:'操作・メール',visual:'表示検査',manual:'手動確認',...extendedSuites};
for(const [value,label] of Object.entries(extendedSuites))$('#suite-select').add(new Option(label,value));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Intl.DateTimeFormat('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)):'—';
const duration=ms=>typeof ms==='number'?`${(ms/1000).toFixed(1)}s`:'—';
const projectAPI=()=>`/api/projects/${encodeURIComponent(state.projectId)}`;
const runAPI=()=>`${projectAPI()}/runs/${encodeURIComponent(state.runId)}`;
const fileURL=file=>`${runAPI()}/files?path=${encodeURIComponent(file)}`;
$('#report-link').insertAdjacentHTML('afterend','<a id="results-download" class="text-link" download hidden>結果をPCに保存（ZIP）</a><label><input id="auto-download-results" type="checkbox">実行完了後にPCへダウンロード</label>');
$('#auto-download-results').checked=localStorage.getItem('wpqa-auto-download')!=='off';
$('#auto-download-results').onchange=e=>localStorage.setItem('wpqa-auto-download',e.target.checked?'on':'off');
const downloadedRuns=new Set();
$('#filters').insertAdjacentHTML('beforeend','<button data-filter="review" aria-pressed="false">直接確認</button>');
$('.page-heading').insertAdjacentHTML('afterend','<details class="confirmation-panel" id="standard-operation-settings"><summary>注文・問い合わせの実行設定</summary><p>「すべての検査」「操作・メール」では、登録済みの注文・問い合わせテストも実行します。</p><label>実行範囲<select id="standard-operation-mode"><option value="preview">入力・確認画面まで（送信なし）</option><option value="submit">注文確定・問い合わせ送信まで</option></select></label><label>サイト閲覧パスワード<input id="standard-operation-password" type="password" autocomplete="off"></label><label><input type="checkbox" id="standard-operation-confirmed"> 注文と問い合わせをそれぞれ新規1件送信することを確認しました</label></details>');
$('#standard-operation-settings').insertAdjacentHTML('afterend','<section id="profile-operation-scope" class="confirmation-panel" hidden></section>');
function savedScopeText(scope){
  return `登録済みの実行範囲：問い合わせ送信：${scope.contactSubmit?'有効':'無効'} ／ 銀行振込注文検査：${scope.bankOrder?'有効（対応状況・回収条件を検査）':'無効'} ／ テスト投稿の作成・公開・更新・回収：${scope.postLifecycle?'有効':'無効'} ／ 予約公開・回収：${scope.scheduled?'有効':'無効'}。「すべての検査」「操作・メール」では、この保存済み範囲を実行します。管理設定・URL・表示などの個別検査には送信を含みません。問い合わせ送信は受信箱への到着を保証しません。`;
}
let operationScopeProject=null;
function renderOperationScope(){
  if(operationScopeProject!==state.projectId){
    operationScopeProject=state.projectId;
    $('#standard-operation-mode').value='preview';$('#standard-operation-password').value='';$('#standard-operation-confirmed').checked=false;
  }
  const scope=state.project?.profileScope;
  $('#standard-operation-settings').hidden=!state.project||!!scope;
  $('#profile-operation-scope').hidden=!scope;
  $('#profile-operation-scope').textContent=scope?savedScopeText(scope):'';
  if(scope){$('#standard-operation-password').value='';$('#standard-operation-confirmed').checked=false;}
}
$('#standard-operation-mode').onchange=()=>{$('#standard-operation-confirmed').checked=false;};
$('#run-button').insertAdjacentHTML('beforebegin','<button id="stop-button" hidden>検査を停止</button>');
$('#metadata').insertAdjacentHTML('afterend','<div id="recovery-info"></div><button id="recover-button" hidden>残ったテストデータを回収</button>');
$('#report-link').insertAdjacentHTML('afterend','<details id="issue-report-panel"><summary>不具合報告書を作成</summary><p>選択した実行の証拠を集約し、影響・管理画面での修正候補・再確認項目をHTMLにまとめます。</p><label><input type="checkbox" id="issue-report-history" checked> 未実施の項目を同じ設定の過去結果で補う（出典を明記）</label><label for="issue-report-notes">追加調査・担当者の補足（任意）</label><textarea id="issue-report-notes" maxlength="10000" rows="4" placeholder="確認者・確認日・原因を確定した根拠など。認証情報は記載しないでください。"></textarea><button id="issue-report-generate" type="button">報告書を生成</button><a id="issue-report-open" target="_blank" rel="noopener" hidden>生成した報告書を開く ↗</a><p id="issue-report-status" role="status"></p></details>');
$('#report-link').parentElement.after($('#issue-report-panel'));
$('#issue-report-panel p').innerHTML='保存済みの証拠から生成します。 <a href="/help/user-manual.html#results-guide" target="_blank" rel="noopener">報告書の使い方 ↗</a>';
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
$('#issue-report-panel').insertAdjacentHTML('afterend','<details id="handoff-panel"><summary>開発担当への引き継ぎ（C-HUB）</summary><p>不合格・注意の課題を、開発担当に渡す文面にまとめます。コピーした時点の内容が引き継ぎ記録として保存されます。</p><button id="handoff-make" type="button">文面を作成</button><div id="handoff-result" hidden><p>引き継ぐ課題（外すと文面から消えます）</p><div id="handoff-issues"></div><label for="handoff-subject">件名</label><input id="handoff-subject" readonly><label for="handoff-body">本文</label><textarea id="handoff-body" readonly rows="14"></textarea><button id="handoff-copy-subject" type="button">件名をコピー</button><button id="handoff-copy-body" type="button">本文をコピー</button></div><div id="handoff-compare" hidden><button id="handoff-compare-open" type="button" hidden>前回の引き継ぎと比較</button><div id="handoff-compare-result" hidden><p id="handoff-compare-counts"></p><p>新たに発生した課題（外すと比較文面から消えます）</p><div id="handoff-compare-added"></div><label for="handoff-compare-body">比較文面</label><textarea id="handoff-compare-body" readonly rows="12"></textarea><button id="handoff-compare-copy" type="button">比較結果をコピー</button></div></div><p id="handoff-status" role="status"></p></details>');
const handoff={scope:'',id:'',cmpId:'',ticket:0};
const handoffURL=kind=>`${runAPI()}/${kind}`,handoffKeys=box=>[...box.querySelectorAll('input:not(:checked)')].map(i=>i.dataset.key);
const handoffList=(box,items)=>{box.innerHTML=items.map(i=>`<label><input type="checkbox" data-key="${escape(i.key)}" checked> <span>${escape(i.level==='caution'?'注意':'不合格')}：${escape(i.rowTitle)} — ${escape(i.title)}</span></label>`).join('')||'<p class="quiet">該当する課題はありません。</p>';};
const handoffCurrent=scope=>scope===`${state.projectId}/${state.runId}`;
async function handoffPreview(fresh,save){
  const scope=`${state.projectId}/${state.runId}`,box=$('#handoff-issues');
  const data=await api(handoffURL('handoff'),{method:'POST',body:JSON.stringify({...(handoff.id?{handoffId:handoff.id}:{}),excludedKeys:fresh?[]:handoffKeys(box),save})});
  if(!handoffCurrent(scope))return null;
  handoff.id=data.handoffId;if(fresh)handoffList(box,data.issues);
  $('#handoff-subject').value=data.subject;$('#handoff-body').value=data.body;$('#handoff-result').hidden=false;
  return data;
}
async function handoffCompare(save,fresh){
  const scope=`${state.projectId}/${state.runId}`,box=$('#handoff-compare-added');
  const data=await api(handoffURL('handoff-compare'),{method:'POST',body:JSON.stringify({...(handoff.cmpId?{handoffId:handoff.cmpId}:{}),uncheckedAddedKeys:fresh?[]:handoffKeys(box),save})});
  if(!handoffCurrent(scope))return null;
  handoff.cmpId=data.handoffId;return data;
}
function handoffCopy(text,done){
  const fallback=()=>{const area=$('#handoff-body');area.hidden=false;area.focus();area.select();$('#handoff-status').textContent='自動コピーできませんでした。Ctrl+C でコピーしてください。';};
  (navigator.clipboard?.writeText?navigator.clipboard.writeText(text).then(()=>{$('#handoff-status').textContent=done;},fallback):Promise.resolve().then(fallback));
}
async function handoffAction(task){
  if(state.requesting)return;const scope=`${state.projectId}/${state.runId}`;state.requesting=true;render();showError('');
  try{await task();}catch(error){if(handoffCurrent(scope)){showError(error.message);$('#handoff-status').textContent='処理できませんでした。';}}
  finally{state.requesting=false;render();}
}
$('#handoff-make').onclick=()=>handoffAction(async()=>{$('#handoff-status').textContent='文面を作成しています…';if(await handoffPreview(true,false))$('#handoff-status').textContent='プレビューです。コピーすると引き継ぎ記録として保存します。';});
$('#handoff-issues').onchange=()=>handoffAction(()=>handoffPreview(false,false));
for(const [id,field,label] of [['#handoff-copy-subject','subject','件名'],['#handoff-copy-body','body','本文']])$(id).onclick=()=>handoffAction(async()=>{const data=await handoffPreview(false,true);if(data)await handoffCopy(data[field],`${label}をコピーしました。引き継ぎ記録を保存しました。`);});
$('#handoff-compare-open').onclick=()=>handoffAction(async()=>{const data=await handoffCompare(false,true);if(data)handoffShowCompare(data,true);});
$('#handoff-compare-added').onchange=()=>handoffAction(async()=>{const data=await handoffCompare(false,false);if(data)handoffShowCompare(data,false);});
$('#handoff-compare-copy').onclick=()=>handoffAction(async()=>{const data=await handoffCompare(true,false);if(data){handoffShowCompare(data,false);await handoffCopy(data.body,'比較結果をコピーしました。引き継ぎ記録を保存しました。');}});
function handoffShowCompare(data,fresh){
  const c=data.comparison;
  $('#handoff-compare-counts').textContent=[['解消',c.resolved],['未解消',c.unresolved],['再確認できず',c.unverified],['新たに発生',c.added],['除外のまま',c.carriedExcluded]].map(([label,list])=>`${label} ${list.length}件`).join(' / ')+(data.scopeGap?`（前回と検査範囲が違う項目：${data.scopeGap}件）`:'');
  if(fresh)handoffList($('#handoff-compare-added'),c.added);
  $('#handoff-compare-body').value=data.body;$('#handoff-compare-result').hidden=false;
}
async function handoffProbe(finished){
  const scope=`${state.projectId}/${state.runId}`;$('#handoff-compare').hidden=true;
  if(!$('#handoff-panel').open||!state.runId||!finished)return;
  try{await api(handoffURL('handoff-compare'),{method:'POST',body:JSON.stringify({uncheckedAddedKeys:[],save:false})});if(handoffCurrent(scope)){$('#handoff-compare').hidden=false;$('#handoff-compare-open').hidden=false;}}catch{}
}
$('#handoff-panel').ontoggle=()=>handoffProbe(state.report?.report?.runStatus==='finished'&&state.report.report.runId===state.runId);
const designerReportUI=initDesignerReport({state,api,render,showError});
const siteExamUI=initSiteExam({state,api});
function notify(message){state.notice=message;$('#toast').textContent=message;$('#toast').hidden=!message;}
function showError(message){$('#error').textContent=message;$('#error').hidden=!message;}
async function api(url,options={}){
  const response=await fetch(url,{...options,headers:{...(options.body?{'Content-Type':'application/json','X-QA-Token':state.token}:{}),...options.headers}});
  const data=await response.json();if(!response.ok)throw new Error(data.error??data.message??'処理に失敗しました');return data;
}
const needsPreparation=row=>row.preparationRequired===true;
$('#filters').insertAdjacentHTML('afterend','<p class="quiet">黄色：優先設定（不具合確定ではありません） <button type="button" id="preparation-motion" aria-pressed="false">重要項目の点滅を停止</button></p>');
const motionButton=$('#preparation-motion');
function setPreparationMotion(stopped){document.body.classList.toggle('preparation-motion-off',stopped);motionButton.setAttribute('aria-pressed',String(stopped));motionButton.textContent=stopped?'重要項目の点滅を再開':'重要項目の点滅を停止';}
setPreparationMotion(localStorage.getItem('wpqa-preparation-motion')==='off');
motionButton.onclick=()=>{const stopped=!document.body.classList.contains('preparation-motion-off');localStorage.setItem('wpqa-preparation-motion',stopped?'off':'on');setPreparationMotion(stopped);};
function priorityLabel(row){const info=preparationImportance(row);return info?`<span class="preparation-priority-label" title="${escape(info.reason)}">重要 · ${escape(info.category)}</span>`:'';}
const displayStatus=row=>needsPreparation(row)?'preparation':row.active?'running':row.level==='caution'&&row.status==='fail'?'caution':row.status;
const failCount=s=>(s?.fail??0)-(s?.caution??0);
function badge(row){const status=displayStatus(row);return `<span class="pill ${escape(status)}">${escape(names[status]??status)}</span>`;}
function renderHistory(runs){
  const key=JSON.stringify([runs,state.runId]);if(key===state.historyKey)return;state.historyKey=key;
  $('#history-count').textContent=runs.length;
  $('#run-list').innerHTML=runs.length?runs.map(r=>{
    const active=state.active?.runId===r.runId;const label=active?'実行中':r.gatePassed?'必須条件充足':failCount(r.summary)?'不合格あり':'未確認あり';
    return `<button class="history-item ${r.runId===state.runId?'selected':''}" data-run="${escape(r.runId)}"><span class="history-top"><span><i class="dot ${active?'blue':r.gatePassed?'green':failCount(r.summary)?'red':'orange'}"></i>${escape(date(r.startedAt))}</span></span><small>${label} · ${r.summary?.pass??0}件合格${r.summary?.caution?` · 注意${r.summary.caution}件`:''}</small></button>`;
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
    snapshot:['画像比較','承認済み基準画像と比較。未承認時は直接確認。'+displayReadiness],
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
  const visible=[...groups.values()].map(g=>({...g,matches:g.rows.filter(r=>(state.filter==='all'||(state.filter==='attention'?['fail','blocked','review','caution','preparation'].includes(displayStatus(r)):displayStatus(r)===state.filter))&&`${g.title} ${g.description} ${r.id} ${r.title}`.toLowerCase().includes(state.search.toLowerCase()))})).filter(g=>g.matches.length);
  const key=JSON.stringify([visible,state.detail,[...openGroups]]);if(key!==state.rowsKey){
    const causes=new Map();
    for(const g of visible)for(const r of g.matches)for(const f of r.failures??[]){if(!causes.has(f.key))causes.set(f.key,{...f,rows:[]});causes.get(f.key).rows.push(r);}
    const causeHTML=causes.size?`<tr><td colspan="4"><section class="preparation-help"><h3>不合格の理由・対応方法（${causes.size}項目）</h3><p>同じ検出内容を集約しています。根本原因の一致は未確定です。</p>${[...causes.values()].map(f=>`<details><summary><strong>${escape(f.title)}</strong> — ${f.rows.length}ケース</summary>${failureHTML(f)}<h4>対象URL・条件</h4>${f.rows.map(r=>`<button class="row-button" data-row="${escape(r.id)}">${escape(r.title)} — 詳細・証拠を確認</button>`).join('')}</details>`).join('')}</section></td></tr>`:'';
    state.rowsKey=key;$('#test-rows').innerHTML=causeHTML+visible.map((g,index)=>{
      const expanded=openGroups.has(g.id),counts={};
      for(const r of g.rows){const status=displayStatus(r);counts[status]=(counts[status]??0)+1;}
      const summary=Object.entries(counts).map(([status,count])=>`${names[status]??status} ${count}`).join(' / ');
      const status=['fail','blocked','running','review','caution','preparation','not_run','pass','not_applicable'].find(s=>counts[s])??'not_run';
      const children=g.matches.map(r=>`<tr class="group-child ${preparationImportance(r)?'preparation-priority':''} ${state.detail===r.id?'row-selected':''}"><td><button class="row-button" data-row="${escape(r.id)}"><strong>${escape(r.title)}</strong>${priorityLabel(r)}<small>${escape(r.id)}${r.required?' · 必須':''}</small></button></td><td class="suite-col">${escape(suites[r.suite]??r.suite)}</td><td>${badge(r)}</td><td class="time-col">${duration(r.durationMs)}</td></tr>`).join('');
      const importantCount=g.matches.filter(r=>preparationImportance(r)).length;
      return `<tr class="group-heading ${importantCount?'preparation-priority':''}"><td colspan="2"><button class="row-button group-toggle" data-group="${escape(g.id)}" aria-expanded="${expanded}" aria-controls="group-${index}"><strong>${expanded?'▾':'▸'} ${escape(g.title)} <span class="count">${g.rows.length}</span></strong>${importantCount?`<span class="preparation-priority-label">重要 · 設定が必要 ${importantCount}件</span>`:''}<small>全体: ${escape(summary)}${g.matches.length!==g.rows.length?` · 絞り込み一致 ${g.matches.length}件`:''}</small></button></td><td>${badge({status})}</td><td class="time-col">${duration(g.rows.reduce((total,r)=>total+(r.durationMs??0),0))}</td></tr><tr id="group-${index}" class="group-results" ${expanded?'':'hidden'}><td colspan="4">${expanded?`<div class="group-detail-panel"><table class="group-table"><thead><tr><th>URL・条件</th><th class="suite-col">種別</th><th>結果</th><th class="time-col">時間</th></tr></thead><tbody>${children}</tbody></table></div>`:''}</td></tr>`;
    }).join('');
  }
  $('#row-count').textContent=`${groups.size}分類`;$('#empty-state').hidden=!!visible.length;
  if(rows.length&&!visible.length){$('#empty-state h3').textContent='条件に一致する項目はありません';$('#empty-state p').textContent='絞り込み条件や検索キーワードを変更してください。';}
  else if(!rows.length){$('#empty-state h3').textContent=state.active?'検査を準備しています':'まだ実行履歴がありません';$('#empty-state p').textContent=state.active?'結果の保存を待っています。自動で更新されます。':'「検査を実行」から開始できます。';}
  $('#table-note').textContent=rows.length?`${visible.length} / ${groups.size}分類 · URL・条件別 ${rows.length}件（絞り込み一致 ${visible.reduce((n,g)=>n+g.matches.length,0)}件）`:'';
}
function failureHTML(f){return `<dl><dt>不合格の理由・取得結果</dt><dd>${escape(f.actual)}</dd><dt>利用者への影響</dt><dd>${escape(f.impact)}</dd><dt>管理画面での対応・確認方法</dt><dd>${escape(f.admin)}</dd><dt>設定で直らない場合</dt><dd>${escape(f.code)}</dd><dt>修正後の確認</dt><dd>${escape(f.verify)}</dd></dl>`;}
function renderDetail(){
  const r=state.report?.report?.rows.find(r=>r.id===state.detail);
  const key=JSON.stringify([state.runId,r,state.report?.canApprove,state.report?.candidates,state.busy]);if(key===state.detailKey)return;state.detailKey=key;
  if(!r){$('#detail').innerHTML='<div class="detail-placeholder"><span aria-hidden="true">↖</span><h3>確認したい項目を選択</h3></div>';return;}
  const preparing=needsPreparation(r),files=r.evidence??[],candidate=!preparing&&state.report.candidates.includes(r.id),canApprove=state.report.canApprove&&!state.busy;
  const descriptions={preparation:'検査条件や期待値が未定義のため、実行対象に含めていません。設定を登録してから検査してください。',pass:'この検査は期待した結果に一致しました。',not_run:'この実行では確認していません。対象の検査範囲を選んで実行してください。',review:'人による確認が必要です。証拠と期待する状態を照合してください。',caution:'参考検査で兆候が見つかりました。必須条件には影響しません。内容を確認し、必要に応じて対応してください。',blocked:'前提条件や実行環境を確認してから再実行してください。',not_applicable:'このサイトでは適用外として登録されています。',fail:'期待結果との違いがあります。証拠から原因を確認してください。'};
  $('#detail').innerHTML=`${badge(r)}<h3 class="detail-title">${escape(r.title)}</h3><div class="detail-id">${escape(r.id)}</div><span class="detail-label">判定の内容</span><p class="detail-description">${escape(descriptions[displayStatus(r)]??'')}</p>${r.setting?`<span class="detail-label">設定の照合</span><dl><dt>取得方法</dt><dd>${escape(r.setting.source)}</dd><dt>期待値</dt><dd>${escape(JSON.stringify(r.setting.expected))}</dd><dt>取得した値</dt><dd>${escape(JSON.stringify(r.setting.actual))}</dd></dl>`:''}${r.reason?`<pre class="reason">${escape(r.reason.replace(/\x1b\[[0-9;]*m/g,''))}</pre>`:''}${files.length?'<span class="detail-label">証拠ファイル</span>':''}<div class="evidence-list">${files.map(f=>`<a class="evidence-link" href="${fileURL(f)}" target="_blank" rel="noopener">${escape(f.split('/').at(-1))} ↗</a>${/\.png$/i.test(f)?`<a href="${fileURL(f)}" target="_blank" rel="noopener"><img class="evidence-image" src="${fileURL(f)}" alt="${escape(f.split('/').at(-1))}"></a>`:''}`).join('')}</div>${candidate?`<div class="approval"><span class="detail-label">基準画像のレビュー</span><p class="detail-description">表示が意図どおりか確認した画像のみ承認します。承認後も、再実行するまで以前の判定は変わりません。</p>${canApprove?'<label><input type="checkbox" id="approve-check">候補画像を確認し、意図した表示であることを確認しました</label><button class="primary" id="approve-button" disabled>この画像を基準として承認</button>':'<p class="approval-note">実行中、または現在の設定と異なる履歴のため承認できません。必要に応じて再実行してください。</p>'}</div>`:''}`;
  const importance=preparationImportance(r);
  if(importance)$('#detail .detail-id').insertAdjacentHTML('afterend',`<section class="preparation-priority-note">${priorityLabel(r)}<p>${escape(importance.reason)}</p></section>`);
  $('#detail .detail-id').insertAdjacentHTML('afterend',`<details class="check-details"><summary>検査内容</summary><p>${escape(classifyRow(r)[2])}</p></details>`);
  if(r.failures?.length)$('#detail .detail-id').insertAdjacentHTML('afterend',r.failures.map(f=>`<section class="preparation-help"><h4>${escape(f.title)}</h4>${failureHTML(f)}</section>`).join(''));
  if(preparing||r.status==='blocked'){

    const help=document.createElement('section');help.className='blocked-help';help.setAttribute('aria-live','polite');help.textContent='不足している設定を確認しています…';$('#detail .detail-id').after(help);
    const url=runAPI()+'/guidance/'+encodeURIComponent(r.id);
    api(url).then(g=>{
      if(!help.isConnected)return;
      help.innerHTML=`<h4>実行できるようにするには</h4>${g.changed?'<p class="guidance-history">この履歴の実行後に設定が変わっています。以下は現在の設定の案内です。</p>':''}<h5>不足・確認が必要なもの</h5><ul>${g.missing.map(x=>`<li>${escape(x)}</li>`).join('')}</ul><h5>設定する場所</h5><p>${escape(g.location)}</p><h5>対応手順</h5><ol>${g.steps.map(x=>`<li>${escape(x)}</li>`).join('')}</ol><p class="quiet">${escape(g.scope)}</p><button type="button" data-open-settings ${state.busy?'disabled':''}>設定画面を開く</button>`;
      if(preparing)help.innerHTML=`<h4>不足している設定</h4><ul>${g.missing.map(x=>`<li>${escape(x)}</li>`).join('')}</ul>${g.changed?'<p>現在の設定に合わせて準備します。過去の結果は保存だけでは変わりません。</p>':''}<button type="button" data-open-settings ${state.busy?'disabled':''}>設定を開く</button>`;
      const fields=document.createElement('div');fields.hidden=preparing;fields.innerHTML=`${g.fields?.length?`<h5>入力する欄と内容</h5><dl>${g.fields.map(f=>`<dt>${escape(f.label)}</dt><dd>${escape(f.value)}</dd>`).join('')}</dl>`:''}${g.external?`<p>${escape(g.external)}</p>`:''}`;
      help.querySelector('[data-open-settings]').before(fields);
      help.querySelector('[data-open-settings]').textContent=preparing?'設定を開く':g.target?'該当する検査の設定を開く':'設定画面を開く';
      help.querySelector('[data-open-settings]').onclick=async e=>{const button=e.currentTarget;const label=button.textContent;button.disabled=true;button.textContent='サイト情報を取得しています…';try{await settingsEditor.open(state.projectId,g.target?{...g.target,fields:g.fields,steps:g.steps}:null);}finally{button.disabled=state.busy;button.textContent=label;}};
    }).catch(e=>{if(help.isConnected)help.textContent='設定案内を取得できませんでした。項目を選び直してください：'+e.message;});
  }
  if(r.softwareSecurity){const d=r.softwareSecurity;$('#detail').insertAdjacentHTML('beforeend',`<section class="preparation-help"><h4>構成情報と照合結果</h4><p>照合日時：${escape(d.checkedAt)}</p>${(d.assets??[]).map(a=>`<p><strong>${escape(a.name)}</strong>：${escape(a.version??'取得不能')}${a.active===false?'（無効・非使用）':''}</p>`).join('')}${(d.assets??[]).filter(a=>a.supplement).map(a=>{const x=a.supplement,p=x.parent;return `<h5>${escape(a.name)}：公式情報の補助照合</h5><p>公式掲載版：${escape(x.referenceVersion??p?.referenceVersion??'未確認')} ／ 比較：${escape(({current:'一致',outdated:'更新候補あり',ahead:'公式掲載版より新しいため確認が必要','child-review':'子テーマの差分確認が必要'})[x.comparison])}</p>${p?`<p>親テーマ：${escape(p.name)} ${escape(p.version)}</p>`:''}<p>出典：${escape(x.source)}</p><p>${escape(x.action)}</p><p>${escape(x.limit)}</p>`;}).join('')}${(d.assets??[]).filter(a=>a.childCode).map(a=>childCodeSummary(a.childCode)).join('')}${d.lifecycle?`<p>PHP：${escape(({active:'通常サポート中','security-only':'セキュリティ修正のみ提供',eol:'公式サポート終了'})[d.lifecycle.state]??d.lifecycle.state)} ／ セキュリティサポート期限：${escape(d.lifecycle.security??'終了済み（現在の公式対象外）')}</p><p>${escape(d.lifecycle.note)}</p>`:''}${d.unknown?.length?`<h5>未確認事項</h5><ul>${d.unknown.map(x=>`<li>${escape(x)}</li>`).join('')}</ul>`:''}<p>${escape(d.scope)}</p></section>`);}
  if(r.details)$('#detail').insertAdjacentHTML('beforeend',`<details class="check-details"><summary>期待値と取得結果</summary><pre class="reason">${escape(JSON.stringify(r.details,null,2))}</pre></details>`);
  if(r.diagnostics)$('#detail').insertAdjacentHTML('beforeend',`<details class="check-details" open><summary>実行経過・失敗時の証拠</summary><pre class="reason">${escape(JSON.stringify(r.diagnostics,null,2))}</pre></details>`);
  if(r.instructions)$('#detail').insertAdjacentHTML('beforeend',`<p class="detail-description">${escape(r.instructions)}</p>`);
  if(!preparing&&r.manualReview)$('#detail').insertAdjacentHTML('beforeend',`<form id="manual-review" class="manual-review"><h4>人手による判定を記録</h4>${r.review?`<p>前回: ${escape(r.review.reviewer)} · ${escape(date(r.review.timestamp))} · ${escape(names[r.review.outcome])}</p>`:''}<label>確認者<input name="reviewer" required maxlength="10000" value="${escape(r.review?.reviewer??'')}"></label><label>判定<select name="outcome"><option value="pass">合格</option><option value="fail">不合格</option><option value="not_applicable">対象外</option></select></label><label>確認内容・判断理由<textarea name="notes" required maxlength="10000" rows="4">${escape(r.review?.notes??'')}</textarea></label><label>証拠・実施環境（1行に1件）<textarea name="evidence" required rows="4">${escape((r.review?.evidence??[]).join('\n'))}</textarea></label><button type="submit" class="primary" ${state.busy?'disabled':''}>判定を保存</button></form>`);
  if(!preparing&&r.manualReview){
    $('#manual-review').hidden=true;
    $('#detail .detail-id').insertAdjacentHTML('afterend',`<section class="confirmation-panel"><button type="button" id="start-confirmation" ${!canApprove?'disabled':''}>確認を進める</button><p>手順ごとに確認し、途中結果・証拠を保存できます。サイトへの送信は自動実行しません。</p><div id="confirmation-workspace"></div></section>`);
  }else if(!preparing&&['review','blocked','fail','not_run'].includes(r.status)){
    $('#detail').insertAdjacentHTML('beforeend',`<section class="confirmation-panel">${candidate?'<p>候補画像の承認後に比較できます。</p>':''}<button id="execute-case" type="button" ${!canApprove?'disabled':''}>この項目を再検査</button></section>`);
  }
}
function render(){
  if($('#remove-site'))$('#remove-site').disabled=!state.canRemove||!state.project||state.busy||state.requesting;
  designerReportUI.render();
  siteExamUI.render();
  renderOperationScope();
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
  $('#stop-button').hidden=!(active&&state.active?.kind==='run');
  $('#stop-button').disabled=state.requesting||state.active?.state==='stopping';
  $('#stop-button').textContent=state.active?.state==='stopping'?'後始末を待っています':'検査を停止';
  const pending=state.report?.recovery?.pending??0;
  $('#recovery-info').textContent=pending?`未回収のテストデータ: ${pending}件。次の実行前に回収してください。`:'';
  $('#recover-button').hidden=!pending;$('#recover-button').disabled=state.busy||state.requesting;
  let title='実行待ち',subtitle='',label='待機中',tone='neutral',icon='○';
  if(live&&state.active?.kind==='prepare'){title='設定を自動補完しています';subtitle='サイト・管理画面の取得情報を検証し、実行できる検査を準備しています。';label='設定中';tone='running';icon='◌';}
  else if(live){title='検査を実行しています';subtitle=rows.find(r=>r.active)?.title??'テストを準備しています';label='実行中';tone='running';icon='◌';}
  else if(state.report?.orphaned){title='実行の完了を確認できません';subtitle='アプリの終了などで中断した可能性があります。ログを確認してください。';label='未完了';tone='blocked';icon='!';}
  else if(report?.runStatus==='planned'){title='テストケースを実行できます';subtitle='検査範囲を選択できます。';label='未実施';tone='not_run';icon='○';}
  else if(report){title=report.gatePassed?'必須条件を満たしています':failCount(report.summary)?'不合格の項目を確認してください':'確認が必要な項目が残っています';subtitle=`${date(report.startedAt)} の実行結果`;label=report.gatePassed?'必須条件充足':failCount(report.summary)?'不合格あり':'未確認あり';tone=report.gatePassed?'pass':failCount(report.summary)?'fail':'review';icon=report.gatePassed?'✓':failCount(report.summary)?'!':'○';}
  if(report?.aggregation&&!live){title='実行結果・実査レビューの統合';subtitle='複数の実行履歴を統合した結果です。新たな全件実行ではありません。各項目の採用元・確認日を参照してください。';}
  const preparationCount=rows.filter(needsPreparation).length;
  if(preparationCount)subtitle+=` · 設定が必要 ${preparationCount}件（実行対象外）`;
  $('#run-title').textContent=title;$('#run-subtitle').textContent=subtitle;$('#run-badge').className=`pill ${tone}`;$('#run-badge').textContent=label;
  $('#run-indicator').className=`status-icon ${live?'running':tone==='pass'?'good':tone==='fail'?'bad':''}`;$('#run-indicator').textContent=icon;
  $('#progress-fill').style.width=`${percent}%`;$('.progress-track').setAttribute('aria-valuenow',percent);$('#progress-label').textContent=`${completed} / ${selected.length} 項目`;
  if(report?.aggregation&&!live)$('#progress-label').textContent=`${rows.length}項目の保存証拠を統合`;
  for(const status of ['pass','blocked','review','not_run'])$(`#metric-${status}`).textContent=report?.summary?.[status]??'—';
  $('#metric-fail').textContent=report?.summary?failCount(report.summary):'—';$('#metric-caution').textContent=report?.summary?report.summary.caution??0:'—';
  $('#metric-preparation').textContent=report?preparationCount:'—';
  $('#metric-not_run').textContent=report?rows.filter(r=>r.status==='not_run'&&!needsPreparation(r)).length:'—';
  $('#report-link').hidden=!report;if(report)$('#report-link').href=fileURL(report.aggregation&&rows.some(r=>r.evidence?.includes('followup-summary.html'))?'followup-summary.html':'report.html');
  $('#results-download').hidden=!report||['running','starting','planned'].includes(report.runStatus);if(report)$('#results-download').href=runAPI()+'/download';
  $('#issue-report-panel').hidden=!report;
  $('#issue-report-generate').disabled=state.requesting||report?.runStatus!=='finished';
  const reportScope=`${state.projectId}/${state.runId}`;
  if(issueReportScope!==reportScope){issueReportScope=reportScope;$('#issue-report-open').hidden=true;$('#issue-report-status').textContent='';$('#issue-report-notes').value='';}
  $('#handoff-panel').hidden=!report;$('#handoff-make').disabled=state.requesting||report?.runStatus!=='finished';
  if(handoff.scope!==reportScope){handoff.scope=reportScope;handoff.id=handoff.cmpId='';$('#handoff-result').hidden=true;$('#handoff-compare-result').hidden=true;$('#handoff-status').textContent='';}
  const finished=report?.runStatus==='finished'&&report.runId===state.runId,probeKey=reportScope+finished;if(handoff.probeKey!==probeKey){handoff.probeKey=probeKey;handoffProbe(finished);}
  if(report?.autoReport?.file==='issue-report.html'){$('#issue-report-open').href=`${projectAPI()}/runs/${state.runId}/files?path=issue-report.html`;$('#issue-report-open').hidden=false;$('#issue-report-status').textContent='検査完了時に報告書を自動生成しました。';}
  renderRows();renderDetail();
  $('#run-time').textContent=report?date(report.finishedAt??report.startedAt):'';
  const metadata=[['対象サイト',report?.baseURL??state.project?.baseURL??'—'],['実行ID',report?.runId??'—'],['環境',({local:'ローカル',staging:'検証環境',production:'本番環境'})[report?.environment??state.project?.environment]??'—'],['設定ファイル',state.project?.configPath??'—'],['対象リビジョン',report?.revision??'未指定'],['実行環境',report?.runtime??'—']];
  $('#metadata').innerHTML=metadata.map(([k,v])=>`<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join('');
  $('#run-log').textContent=state.report?.log||state.active?.log||'まだログはありません。';
}
let latestKey='',latestTicket=0;
const latestPanel=document.createElement('details');latestPanel.className='panel';latestPanel.id='latest-results';latestPanel.innerHTML='<summary>サイト全体の最新結果</summary><div data-latest-content></div>';
$('.workspace-grid').before(latestPanel);
async function refreshLatest(data){
 const key=JSON.stringify([state.projectId,data.project.configHash,data.runs.map(r=>[r.runId,r.runStatus,r.finishedAt])]);if(key===latestKey)return;latestKey=key;
 const ticket=++latestTicket,projectId=state.projectId,content=latestPanel.querySelector('[data-latest-content]');content.textContent='最新結果を集約しています…';
 try{const result=await api('/api/projects/'+encodeURIComponent(projectId)+'/latest-results');if(ticket!==latestTicket||state.projectId!==projectId)return;
 content.innerHTML='<p>'+Object.entries(result.counts).map(([status,n])=>escape(names[status]??status)+' '+n+'件').join(' ／ ')+'</p><p>現在の設定と一致する実施結果を項目ごとに表示しています。採点・証拠は元の履歴で確認できます。</p>'+(result.unreadableRuns?'<p>読み込めない履歴があります。集約は不完全です。</p>':'')+'<div style="overflow-x:auto"><table><thead><tr><th>検査項目</th><th>結果</th><th>検査日時・証拠</th></tr></thead><tbody>'+result.rows.map(r=>'<tr><td>'+escape(r.title??r.id)+'</td><td>'+escape(names[displayStatus(r)]??r.status)+'</td><td>'+(r.sourceRunId?'<button type="button" data-source-run="'+escape(r.sourceRunId)+'">'+escape(date(r.checkedAt))+' の結果</button>':'現在の設定での実施結果なし')+'</td></tr>').join('')+'</tbody></table></div>';
 }catch(err){if(ticket===latestTicket){latestKey='';content.textContent=err.message;}}
}
latestPanel.addEventListener('click',async event=>{const button=event.target.closest('[data-source-run]');if(!button)return;++refreshTicket;state.runId=button.dataset.sourceRun;state.report=null;state.detail=null;state.follow=false;render();await refresh();});
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
    renderHistory(data.runs);render();void refreshLatest(data);
    if(completedReport)showVerdict(completedReport.report,data.lastJob.exitCode);
    if(completedReport&&$('#auto-download-results').checked&&!downloadedRuns.has(expectedProject+'/'+completedId)){
      downloadedRuns.add(expectedProject+'/'+completedId);const link=document.createElement('a');link.href=`/api/projects/${encodeURIComponent(expectedProject)}/runs/${encodeURIComponent(completedId)}/download`;link.download='';document.body.append(link);link.click();link.remove();notify('結果のダウンロードを開始しました。保存されない場合は「結果をPCに保存（ZIP）」を押してください。');
    }
  }catch(e){if(current())showError('状態を取得できませんでした：'+e.message);}
}
$('#project-select').addEventListener('change',async e=>{++refreshTicket;state.projectId=e.target.value;state.project=null;localStorage.setItem('wpqa-project',state.projectId);state.runId=null;state.report=null;state.detail=null;state.follow=true;state.lastActive=false;state.rowsKey='';state.historyKey='';notify('');showError('');render();await refresh();});
$('#run-button').addEventListener('click',async()=>{
  const verdict=document.querySelector('#cinema-verdict');if(verdict)verdict.hidden=true;
  if(state.busy||state.requesting||!state.project)return;++refreshTicket;state.requesting=true;render();showError('');notify('');
  try{const payload={suite:$('#suite-select').value};if(!state.project.profileScope)payload.operation={mode:$('#standard-operation-mode').value,password:$('#standard-operation-password').value,confirmed:$('#standard-operation-confirmed').checked};$('#standard-operation-password').value='';await api(`${projectAPI()}/runs`,{method:'POST',body:JSON.stringify(payload)});state.follow=true;state.runId=null;state.report=null;state.detail=null;state.lastActive=true;}
  catch(e){showError(e.message);}finally{state.requesting=false;await refresh();}
});
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
    try{await api(endpoint,{method:'POST',body:JSON.stringify(payload)});notify(payload.finish?'確認結果を保存しました':'途中結果を保存しました。直接確認として残しています。');state.detailKey='';}
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
  const boot=await api('/api/bootstrap');document.querySelector('.page-footer').textContent+=' ／ '+(boot.releaseVersion??'版情報なし');state.shared=boot.shared===true;state.canRemove=boot.canRemove===true;state.token=boot.token;state.projects=boot.projects;$('#demo-label').hidden=!boot.demo;
  $('#project-select').innerHTML=boot.projects.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('');
  const saved=localStorage.getItem('wpqa-project');state.projectId=boot.projects.some(p=>p.id===saved)?saved:boot.projects[0]?.id;
  $('#project-select').value=state.projectId;await refresh();
  // Sequential polling prevents an older response from overwriting a newer state.
  const poll=async()=>{await refresh();setTimeout(poll,1000);};setTimeout(poll,1000);
}catch(e){showError(e.message);}

initAiSettings({api});
const removeSite=document.createElement('button');removeSite.id='remove-site';removeSite.type='button';removeSite.textContent='サイトを一覧から削除';removeSite.className='danger-text';document.querySelector('.site-actions').append(removeSite);
removeSite.disabled=!state.canRemove||!state.project||state.busy;
removeSite.textContent='サイトを削除';
removeSite.onclick=async()=>{
 if(!state.project||state.busy||state.requesting)return;
 const project=state.project;let plan;
 try{plan=await api('/api/projects/'+encodeURIComponent(project.id)+'/removal');}catch(error){showError(error.message);return;}
 const dialog=document.createElement('dialog');dialog.className='settings-dialog';
 dialog.innerHTML=`<form><header><h2>サイトの削除</h2></header><div class="editor-body"><h3>対象サイト</h3><p><strong>${escape(project.name)}</strong><br>${escape(project.baseURL)}</p><label>削除方法<select name="mode"><option value="hide">一覧から除外（データは残す）</option>${plan.canDelete?'<option value="delete">設定・認証情報・テスト結果も完全削除</option>':''}</select></label>${plan.canDelete?'':'<p>'+escape(plan.reason)+'</p>'}<div data-delete-content hidden>${plan.interrupted?'<p>前回の削除が中断されています。残っているデータを確認して削除を再実行してください。</p>':''}<h3>削除される内容</h3><ul><li>サイト設定・自動取得した設定情報</li><li>保存したログイン認証・閲覧パスワード・ロール別認証</li><li>テスト結果・レポート・画像・ログ・比較用の基準画像</li></ul><p>保存ファイル：${plan.files??0}件 ／ 実行結果：${plan.runs??0}件 ／ 容量：${((plan.bytes??0)/1024/1024).toFixed(2)} MB</p><p>この操作は取り消せません。対象のWordPressサイト自体や、ダウンロード済みファイル・別途保管したバックアップは削除しません。</p><label>確認のため、上のサイト名を入力<input name="name" autocomplete="off"></label><label class="check-line"><input name="ack" type="checkbox">削除対象を確認し、元に戻せないことを理解しました</label></div><p data-hide-content>設定・認証情報・テスト結果は保存先に残ります。</p><p>共有版では全利用者に反映されます。</p><p data-error role="alert"></p></div><footer><button type="button" data-cancel>キャンセル</button><button type="submit" data-submit>一覧から除外</button></footer></form>`;
 document.body.append(dialog);const form=dialog.querySelector('form'),submit=dialog.querySelector('[data-submit]'),field=n=>form.elements.namedItem(n);
 const update=()=>{const full=field('mode').value==='delete';dialog.querySelector('[data-delete-content]').hidden=!full;dialog.querySelector('[data-hide-content]').hidden=full;submit.textContent=full?'完全削除する':'一覧から除外';submit.disabled=full&&(field('name').value!==project.name||!field('ack').checked);};
 form.addEventListener('input',update);form.addEventListener('change',update);
 dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();update();
 form.onsubmit=async event=>{
  event.preventDefault();if(submit.disabled||state.requesting)return;
  ++refreshTicket;state.requesting=true;submit.disabled=true;render();
  try{await api('/api/projects/'+encodeURIComponent(project.id)+'/remove',{method:'POST',body:JSON.stringify({confirmed:true,configHash:project.configHash,mode:field('mode').value,name:field('name').value,hash:plan.hash})});localStorage.removeItem('wpqa-project');location.reload();}
  catch(error){dialog.querySelector('[data-error]').textContent=error.message;state.requesting=false;render();update();}
 };
};

initExternalAuth({api,currentProject:()=>state.project,onSaved:()=>refresh()});
const siteSaved=async id=>{
  ++refreshTicket;state.projectId=id;state.project=null;state.runId=null;state.report=null;state.detail=null;state.follow=true;state.lastActive=false;
  const boot=await api('/api/bootstrap');state.projects=boot.projects;
  $('#project-select').innerHTML=boot.projects.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('');$('#project-select').value=id;
  localStorage.setItem('wpqa-project',id);notify('サイト設定を保存しました');render();await refresh();
};
const settingsEditor=initSettings({api,currentProject:()=>state.projectId,onSaved:siteSaved,shared:state.shared});
if(!state.shared)initRegistration({api,onSaved:siteSaved});
else {const notice=document.createElement("p");notice.id="shared-pilot-notice";notice.textContent="社内試用版：登録・設定からWordPressにログインして認証を保存できます。全利用者が同じサイトを操作できます。検査・ログインは1件ずつ実行します。";document.querySelector(".page-heading").after(notice);}

// Movie-prop telemetry: entirely local decoration, independent of QA state.
const cinemaToggle=document.querySelector('#cinema-toggle');
const cinemaFeed=document.querySelector('#cinema-feed');
let cinemaPaused=false;
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

function childCodeSummary(c){return '<h4>子テーマ独自コードの簡易静的検査</h4><p>取得 '+c.files.length+'ファイル ／ 要確認 '+c.findings.length+'箇所</p><ul>'+c.findings.map(f=>'<li>'+escape(f.file)+'：'+f.line+'行 — '+escape(f.title)+'<p>'+escape(f.fix)+' 技術担当者によるコードの確認・検証環境での修正が必要です。管理画面での直接編集は推奨しません。</p></li>').join('')+'</ul><details><summary>取得したファイル</summary><p>'+c.files.map(f=>escape(f.file)).join('、')+'</p></details><p>'+escape(c.incomplete.join(' / '))+'</p><p>'+escape(c.scope)+'</p>';}
