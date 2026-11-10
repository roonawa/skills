export function initAiPreparation({container,api,readConfig,applyConfig,openCheck,prepare}){
  const panel=document.createElement('section');panel.className='ai-preparation';
  panel.innerHTML='<h3>Claudeで検査条件を補完</h3><p>登録前でも利用できます。保存済みサイトは公開ページ・管理画面から条件を再取得してから、Claudeが全項目を分割して確認します。取得した現在値は回帰基準であり、仕様の正しさの保証には使いません。読み取り検査だけを選んで追加でき、送信・注文の許可は変更しません。最後に設定の「保存」が必要です。</p><label>合意済みの読込時間の上限（ミリ秒・任意）<input data-budget type="number" min="100" max="120000" placeholder="例：3000"></label><p>基準が決まっていない場合は空欄にしてください。AIに勝手な基準を設定させません。</p><button type="button" data-propose>自動取得してClaudeで補完</button><p data-status role="status"></p><div data-output></div><button type="button" data-apply hidden>選んだ検査を設定に反映</button>';
  container.append(panel);const q=s=>panel.querySelector(s);let pending=null,busy=false,generation=0;
  function reset(){generation++;pending=null;q('[data-output]').replaceChildren();q('[data-status]').textContent='';q('[data-apply]').hidden=true;}
  q('[data-propose]').onclick=async()=>{if(busy)return;reset();const ticket=generation;busy=true;q('[data-propose]').disabled=true;q('[data-status]').textContent='検査の構造情報から提案を作っています…';try{
    if(prepare){q('[data-status]').textContent='サイト・管理画面から設定条件を自動取得しています…';const prepared=await prepare();if(ticket!==generation)return;
      if(prepared){const box=document.createElement('details'),title=document.createElement('summary');title.textContent='取得根拠による補完結果：'+prepared.adopted+'件・フォーム項目'+prepared.bindings+'件';box.append(title);for(const item of prepared.remaining??[]){const p=document.createElement('p');p.textContent=item.title+'：'+item.message;box.append(p);}q('[data-output]').append(box);}}
    q('[data-status]').textContent='Claudeで全項目の構造を分割確認しています。件数に応じて複数回のAPI利用料が発生します…';
    const config=readConfig(),answers=q('[data-budget]').value?{maxLoadMs:Number(q('[data-budget]').value)}:{};
    const result=await api('/api/ai/propose',{method:'POST',body:JSON.stringify({config,answers})});
    if(ticket!==generation)return;pending=result;
    const reviewBox=document.createElement('details'),reviewTitle=document.createElement('summary');reviewTitle.textContent='全項目の準備確認（合否判定ではありません）';reviewBox.append(reviewTitle);
    const names={pages:'ページ',checks:'機能検査',admin:'管理設定',visuals:'表示・画像',journeys:'操作手順',policies:'応答条件',manual:'人手確認'};
    for(const item of result.reviews??[]){const row=document.createElement('p');row.textContent=`${names[item.section]} #${item.index+1}：${item.reason}`;reviewBox.append(row);}q('[data-output]').append(reviewBox);
    pending.proposal.cases.forEach((c,i)=>{
      const label=document.createElement('label'),check=document.createElement('input'),copy=document.createElement('span'),title=document.createElement('strong'),target=document.createElement('small'),reason=document.createElement('small');
      check.type='checkbox';check.checked=true;check.dataset.choice=i;copy.className='checkbox-copy';
      title.textContent=({performance:'読込時間',canonical:'正規URL',metadata:'メタ情報',navigation:'ページ内リンク',forms:'フォーム構造',keyboard:'キーボード',integrations:'外部連携タグ',multilingual:'多言語宣言',crawl:'未知URLの応答'})[c.kind];
      target.textContent='対象：'+config.pages[c.pageIndex].path;
      reason.textContent='追加理由：'+c.reason;copy.append(title,target,reason);label.append(check,copy);q('[data-output]').append(label);
    });
    pending.proposal.questions.forEach(question=>{const box=document.createElement('div'),p=document.createElement('p');p.textContent=`${config.checks[question.checkIndex].title??config.checks[question.checkIndex].id}：${question.question}（${question.reason}）`;const b=document.createElement('button');b.type='button';b.textContent='この項目を設定する';b.onclick=()=>openCheck(config.checks[question.checkIndex].id);box.append(p,b);q('[data-output]').append(box);});
    q('[data-apply]').hidden=!pending.proposal.cases.length;q('[data-status]').textContent=`全${result.projection.pages.length}ページ・${result.projection.checks.length}追加検査、管理・画像・操作・手動等の登録項目を${result.batchCount??1}回に分割確認しました。候補${pending.proposal.cases.length}件、確認事項${pending.proposal.questions.length}件。適用しても合否は変わりません。保存後に再検査してください。`;
  }catch(e){q('[data-status]').textContent=e.message;}finally{busy=false;q('[data-propose]').disabled=false;}};
  q('[data-apply]').onclick=async()=>{if(!pending||busy)return;const ticket=generation;busy=true;try{const result=await api('/api/ai/apply',{method:'POST',body:JSON.stringify({id:pending.id,config:readConfig(),indices:[...q('[data-output]').querySelectorAll('[data-choice]:checked')].map(e=>Number(e.dataset.choice))})});if(ticket!==generation)return;applyConfig(result.config);pending=null;q('[data-apply]').hidden=true;q('[data-status]').textContent='入力中の設定に反映しました。最後に「保存」を押してください。'+result.notes.join(' ');}catch(e){q('[data-status]').textContent=e.message;}finally{busy=false;}};
  return {reset};
}
