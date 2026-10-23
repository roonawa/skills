const recipes={
 'manual.checkout-flow':[['registration','既存のテスト注文を管理画面で照合する（注文番号・商品・金額・支払方法）'],['mail','受信箱で注文番号または識別子を検索し、宛先・内容を確認する'],['cleanup','同じテスト注文をキャンセルし、保存後の状態を確認する']],
 'manual.contact-form':[['submission','送信済みのテスト問い合わせの完了表示・識別子を照合する'],['mail','通知先の受信箱で識別子を検索し、通知・必要な自動返信を確認する']],
 'manual.design-review':[['design','対象ページのPC・スマートフォン表示を確認する'],['content','文章・画像・リンク先の内容を確認する'],['usability','キーボード操作・文字の読みやすさ・操作性を確認する']]
};
export function confirmationPlan(row){
 if(!row.manualReview)return {mode:row.id.startsWith('snapshot.')?'snapshot':'automatic',steps:[]};
 const steps=(recipes[row.id]??[['check',row.instructions??'対象画面を操作し、この項目の期待結果と証拠を照合する']]).map(([id,title])=>({id,title,status:'review',evidence:''}));
 const previous=row.details?.confirmation;
 const admin=row.details?.adminFollowup;
 for(const step of steps){
  if(admin&&((step.id==='registration'&&admin.registration==='verified')||(step.id==='cleanup'&&admin.cancellation==='verified'))){step.status='pass';step.evidence=`既存証拠: 注文${admin.orderId} / admin-followup.json / ${admin.screenshot??''}`;}
  const saved=previous?.steps?.find(s=>s.id===step.id);if(saved){step.status=saved.status;step.evidence=saved.evidence;}
 }
 return {mode:'manual',steps,reviewer:previous?.reviewer??'',notes:previous?.notes??'',warning:'既存の証拠を先に確認してください。注文・問い合わせを重複送信しないでください。この画面は手動確認の手順と結果を記録します。'};
}
export function validateConfirmation(plan,data){
 if(plan.mode!=='manual'||!data||!Array.isArray(data.steps)||data.steps.length!==plan.steps.length||new Set(data.steps.map(s=>s.id)).size!==plan.steps.length||data.steps.some(s=>!plan.steps.some(p=>p.id===s.id)))throw Error('確認手順が不正です');
 if(typeof data.finish!=='boolean'||typeof data.reviewer!=='string'||!data.reviewer.trim()||data.reviewer.length>1000||typeof data.notes!=='string'||data.notes.length>10000)throw Error('確認者・記録を入力してください');
 const steps=data.steps.map(s=>{
  if(!['review','pass','fail','not_applicable'].includes(s.status)||typeof s.evidence!=='string'||s.evidence.length>10000)throw Error('手順の結果が不正です');
  if(s.status!=='review'&&!s.evidence.trim())throw Error('確認した手順には証拠または対象外の理由が必要です');
  return {id:s.id,status:s.status,evidence:s.evidence.trim()};
 });
 if(data.finish&&steps.some(s=>s.status==='review'))throw Error('未確認の手順があります。途中保存してください');
 const outcome=!data.finish?'review':steps.some(s=>s.status==='fail')?'fail':steps.every(s=>s.status==='not_applicable')?'not_applicable':'pass';
 return {steps,reviewer:data.reviewer.trim(),notes:data.notes.trim(),outcome};
}
export function selectSingleTest(rows,id){
 const row=rows.find(r=>r.id===id);if(!row)throw Error('検査が見つかりません');
 if(row.manualReview)throw Error('手動確認は確認手順から実施してください');
 for(const r of rows)r.selected=r.id===id;
}
