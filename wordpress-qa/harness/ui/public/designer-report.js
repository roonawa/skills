export function initDesignerReport({state,api,render,showError}){
 const panel=document.createElement('details');panel.id='designer-report-panel';
 panel.innerHTML='<summary>デザイナー向けレポートを作成・ダウンロード</summary><p>表示・配色・入力欄・リンクの指摘をまとめ、影響、管理画面での修正候補、再現手順、枠付き画像を単体HTMLにします。実装・運用への引継ぎと未確認事項も掲載します。新しい検査や画像撮影は行いません。</p><label><input type="checkbox" id="designer-report-history" checked> 未実施の項目を同じ設定の過去結果で補う（出典付き）</label><label for="designer-report-notes">デザイナーへの補足（任意）</label><textarea id="designer-report-notes" rows="4" maxlength="10000" placeholder="配色やデザインの意図、確認した範囲など。認証情報・個人情報は記載しないでください。"></textarea><div class="designer-report-actions"><button type="button" id="designer-report-generate">デザイナー向けHTMLを生成</button><a id="designer-report-open" target="_blank" rel="noopener" hidden>生成したレポートを開く ↗</a><a id="designer-report-download" download hidden>HTMLをダウンロード</a></div><p id="designer-report-status" role="status"></p>';
 document.querySelector('#issue-report-panel').after(panel);
 const q=s=>panel.querySelector(s);let scope='';
 const endpoint=()=>`/api/projects/${encodeURIComponent(state.projectId)}/runs/${encodeURIComponent(state.runId)}`;
 function links(){const url=endpoint()+'/files?path=designer-report.html';q('#designer-report-open').href=url;q('#designer-report-download').href=url+'&download=1';q('#designer-report-open').hidden=false;q('#designer-report-download').hidden=false;}
 function update(){
  const report=state.report?.report,current=report&&report.runId===state.runId;
  panel.hidden=!current;
  q('#designer-report-generate').disabled=state.requesting||!current||report.runStatus!=='finished'||!report.finishedAt;
  const key=`${state.projectId}/${state.runId}`;
  if(scope!==key){scope=key;q('#designer-report-open').hidden=true;q('#designer-report-download').hidden=true;q('#designer-report-notes').value='';q('#designer-report-status').textContent='';}
  if(current&&state.report.designerReport){links();if(!q('#designer-report-status').textContent)q('#designer-report-status').textContent='作成済みのレポートを開く・ダウンロードできます。結果や補足を変更した場合は再生成してください。';}
 }
 q('#designer-report-generate').onclick=async()=>{
  if(state.requesting||!state.runId||state.report?.report.runStatus!=='finished')return;
  const key=`${state.projectId}/${state.runId}`,url=endpoint();
  state.requesting=true;render();showError('');q('#designer-report-status').textContent='保存済みの証拠から生成しています…';
  try{
   const result=await api(url+'/designer-report',{method:'POST',body:JSON.stringify({includeHistory:q('#designer-report-history').checked,notes:q('#designer-report-notes').value})});
   if(key!==`${state.projectId}/${state.runId}`)return;
   state.report.designerReport=true;links();
   q('#designer-report-status').textContent=`生成しました。不合格${result.failedCases}ケースを整理。画像を含むHTMLファイルだけで共有できます。${result.warnings.length?'証拠の読取り・表示制限に関する注意事項があります。レポート末尾を確認してください。':''}`;
  }catch(error){if(key===`${state.projectId}/${state.runId}`){q('#designer-report-status').textContent='生成できませんでした。';showError(error.message);}}
  finally{state.requesting=false;render();}
 };
 return {render:update};
}

