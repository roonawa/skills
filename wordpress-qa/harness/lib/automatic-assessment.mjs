import {impactAssessments} from './impact-probes.mjs';
export const automaticAssessmentVersion='evidence-provisional-4';
const metadata={title:'ページタイトル',description:'検索用説明文',canonical:'正規URL',lang:'言語指定'};
export function evidenceObservations(data,file){
 const out=impactAssessments(data).map(o=>({...o,file,category:'measured-impact'}));
 for(const observation of [...contactImpactObservations(data),...blockedRetryObservations(data)])out.push({...observation,file});
 for(const error of Array.isArray(data?.errors)?data.errors:[]){
  if(typeof error!=='string')continue;
  for(const [key,label] of Object.entries(metadata))if(error.startsWith(key+' differs'))out.push({key:'metadata:'+key,file,label,category:'metadata'});
  const m=/^indexable differs from expectation \((true|false)\)$/.exec(error);
  if(m)out.push({key:'indexable:'+m[1],file,label:'検索公開方針',category:'metadata'});
 }
 for(const v of Array.isArray(data?.violations)?data.violations:[]){
  const names={'frame-title':'フレームの識別名','scrollable-region-focusable':'スクロール領域のフォーカス','color-contrast':'文字のコントラスト','image-alt':'画像の代替テキスト','link-name':'リンクの読み上げ名','button-name':'ボタンの読み上げ名',label:'入力欄のラベル'};
  if(names[v?.id]&&Array.isArray(v.nodes)&&v.nodes.length)out.push({key:'axe:'+v.id,file,label:names[v.id],category:'accessibility',nodes:v.nodes.length});
 }
 return out;
}
export function automaticEvaluation(group){
 const observations=group.cases.flatMap(c=>(c.observations??[]).filter(o=>o.key===group.key&&c.evidenceState[o.file]?.available));
 if(!observations.length){
 const key=group.key??'';
 const reason=key.startsWith('javascript:')?'例外の検出だけでは、停止した機能と利用者への影響を判断できません。該当操作の成否・回避手段・影響範囲を確認してください。'
 :key.startsWith('timeout:')?'待機時間の超過だけでは、サイトの障害と検査環境の問題を区別できません。同じ操作の再現性・通信状態・利用者への影響を確認してください。'
 :key.startsWith('security:')?'既知情報との照合だけでは攻撃の成立条件・権限・影響範囲を評価できません。脆弱性の適用条件と修正状況を確認してください。'
 :key.startsWith('axe:')?'このアクセシビリティ規則は自動採点の対応範囲外です。検出要素での操作・読み上げへの影響と回避手段を確認してください。'
 :'採点に必要な証拠が不足しているか、自動採点ルールの対応範囲外です。実際に失敗する操作、利用者への影響、影響する機能の範囲を確認してください。';
 if(group.cases.some(c=>Object.values(c.evidenceState??{}).some(e=>['budget-limit','file-limit'].includes(e.reason)))&&!group.cases.some(c=>Object.values(c.evidenceState??{}).some(e=>e.available)))return {pendingCategory:'evidence-limit',pendingReason:'証拠の読込み容量上限に達しました。ファイル欠損ではありません。診断範囲を分けるか、対象の証拠を直接確認してください。'};
 return {pendingCategory:group.cases.some(c=>Object.values(c.evidenceState??{}).some(e=>e.available))?(key.startsWith('axe:')||key.startsWith('unclassified:')?'rule-unsupported':'evidence-insufficient'):'evidence-missing',pendingReason:reason};
 }

 const o=observations.filter(o=>o.category==='measured-impact').sort((a,b)=>b.scores[0]-a.scores[0])[0]??observations[0];
 if(o.category==='measured-impact')return {scores:o.scores,certainty:'provisional',source:'rule',reviewed:false,reproductionVerified:false,reasons:o.reasons,proofs:o.reasons.map(()=>({file:o.file,observation:o.observation})),observed:o.observation,assumptions:o.scope,assessmentRule:automaticAssessmentVersion,pendingReason:''};

 if(o.category==='contact-retry-blocked')return {scores:[3,3,2],certainty:'provisional',source:'rule',reviewed:false,reproductionVerified:false,reasons:['最初の通信失敗後、フォームと入力が残り再操作のクリックも完了しましたが、2回目の送信要求が待機時間内に発生しませんでした。このフォームの再操作を完了できないため影響度3とします。','検査側がCF7通信を遮断した特定条件下での再操作失敗です。成立容易性3とし、通常通信での発生頻度は推定しません。','対象は記録された1つの問い合わせフォームの通信失敗後の再操作です。単一導線として範囲2とし、他ページや別フォームへの波及は未評価です。'],proofs:[0,1,2].map(()=>({file:o.file,observation:'1回目の通信遮断後、通知非表示。2回目のクリック完了後も要求なし。フォーム表示・入力保持を確認。'})),observed:'通信失敗後に再送信操作を行っても、待機時間内に送信要求が発生しませんでした。',assumptions:'通信を遮断した条件での、このフォームの再操作だけを評価しています。再読込等の回復方法、通常送信・メール到達、他ページへの波及は未確認です。',assessmentRule:automaticAssessmentVersion,pendingReason:''};
 if(o.category==='contact-feedback'){
 const reasons=[
 '同じフォームで2回、通信失敗後の通知が見えないことを観測しました。一方、入力保持・フォーム表示・再操作可能を両回で確認したため、この通知欠落の影響度を2とします。',
 '通常の成功通信ではなく、CF7通信を検査側で遮断した特定条件で2回再現しています。成立容易性は3とし、本番での障害発生頻度は推定しません。',
 '記録された1つのフォームの通信失敗時の導線を評価対象に限定し、範囲2とします。サイト全体や別フォームへの波及は評価していません。'
 ];
 return {scores:[2,3,2],certainty:'provisional',source:'rule',reviewed:false,reproductionVerified:false,reasons,proofs:reasons.map(()=>({file:o.file,observation:'2回の通信遮断で通知非表示。入力保持・フォーム表示・再操作可能・成功扱いなしを各回で観測。'})),observed:'通信遮断後の通知が2回とも表示されません。入力保持と再操作可能を確認しました。',assumptions:'このフォームの通信失敗通知だけの暫定評価です。通常の送信完了・メール配信・サイト全体の安全性は未評価です。',assessmentRule:automaticAssessmentVersion,pendingReason:''};
 }
 return {scores:null,certainty:'pending',source:'rule',pendingCategory:'evidence-insufficient',pendingReason:o.label+'の違反は証拠で確認できました。ただし、操作が完了できるか、回避方法があるか、どの機能・利用者まで影響するかは記録されていません。影響度・成立容易性・影響範囲を確認して採点してください。',observed:o.label+'の不一致が保存済み証拠に記録されています。',proofs:[0,1,2].map(()=>({file:o.file,observation:o.label+'の違反を検出。業務影響と波及範囲は未確認。'})),assessmentRule:automaticAssessmentVersion};
}

export function contactImpactObservations(data){
 if(data?.area!=='contact-retry'||data.network?.forwardedWrites!==0||(!Number.isSafeInteger(data.network?.feedbackAttempts)||data.network.feedbackAttempts<2))return [];
 return (Array.isArray(data.observations)?data.observations:[]).filter(o=>o.schema==='wpqa-contact-impact-v1'&&o.delivery==='intercepted'&&o.scope==='single-form-network-failure'&&Number.isSafeInteger(o.formId)&&o.formId>0&&typeof o.path==='string'&&/^\/[^?#]*$/.test(o.path)&&Array.isArray(o.attempts)&&o.attempts.length===2&&o.attempts.every((a,i)=>a.attempt===i+1&&a.requestBlocked===true&&a.feedbackVisible===false&&a.retryEnabled===true&&a.inputsRetained===true&&a.formVisible===true&&a.reportedSuccess===false)).map(o=>({key:'interaction:feedback-missing:'+o.path+':'+o.formId,category:'contact-feedback',label:'通信失敗時のフォーム通知欠落'}));
}


export function blockedRetryObservations(data){
 if(data?.area!=='contact-retry'||data.network?.forwardedWrites!==0||data.network?.feedbackAttempts!==1)return [];
 return (Array.isArray(data.observations)?data.observations:[]).filter(o=>o.schema==='wpqa-contact-impact-v1'&&o.delivery==='intercepted'&&o.scope==='single-form-network-failure'&&Number.isSafeInteger(o.formId)&&o.formId>0&&typeof o.path==='string'&&/^\/[^?#]*$/.test(o.path)&&Array.isArray(o.attempts)&&o.attempts.length===2&&o.attempts.every((a,i)=>a.attempt===i+1&&a.clickCompleted===true&&a.requestBlocked===(i===0)&&a.feedbackVisible===false&&a.formVisible===true&&a.inputsRetained===true&&a.reportedSuccess===false)).map(o=>({key:'interaction:retry-blocked:'+o.path+':'+o.formId,category:'contact-retry-blocked',label:'通信失敗後のフォーム再操作不能'}));
}
