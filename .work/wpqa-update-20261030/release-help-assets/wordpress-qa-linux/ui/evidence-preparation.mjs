import {validateConfig} from '../lib/config.mjs';
import {preparationReason} from '../lib/checks/index.mjs';
import {applyAutomationPlan,resolveAutomationProfile} from './automation-plan.mjs';

const keys=['contactNameField','contactEmailField','contactMessageField','contactConsentField'];
const types={contactNameField:['text'],contactEmailField:['email'],contactMessageField:['textarea'],contactConsentField:['checkbox']};
const safeName=v=>typeof v==='string'&&/^[a-zA-Z][\w-]{0,60}$/.test(v)&&!/(?:password|secret|nonce|token|authorization)/i.test(v);
const label=v=>typeof v==='string'&&v.length<=80&&!/@|https?:|[a-zA-Z0-9_-]{24}|password|secret|nonce|token/i.test(v)?v:'';

// This projection is an allowlist, never a serialization of discovery or profile.
// Raw HTML, field values, account data, cookies and mail destinations stay local.
export function preparationEvidence(config,profile,discovery){
 const c=validateConfig(config),a=discovery.automation??{};
 const forms=(a.public?.forms??[]).map((f,index)=>({ref:'form-'+index,fields:(f.fields??[]).map((field,i)=>({ref:'field-'+i,name:safeName(field.name)?field.name:'redacted',type:field.type,required:field.required,label:label(a.public?.fieldLabels?.find(l=>l.formId===f.formId&&l.name===field.name)?.label)})),controls:(a.public?.formControls??[]).filter(x=>x.formId===f.formId&&x.path===f.path).map((x,i)=>({ref:'control-'+i,label:label(x.label),type:x.type})),hasSubmit:!!f.submitSelector,hasResponse:!!f.responseSelector,hasFeedbackEndpoint:!!f.restPath}));
 const admin=Object.entries(a.admin??{}).flatMap(([group,rows])=>rows.map((r,i)=>({ref:`admin-${group}-${i}`,group,control:safeName(r.id)?r.id:'setting',value:typeof r.expected==='boolean'?r.expected:typeof r.expected==='string'&&/^(?:\d{1,8}|posts|page|\/[\w%/.-]{0,100})$/.test(r.expected)?r.expected:null})));
 const generated=applyAutomationPlan(c,profile,discovery),candidates=[];
 for(const old of c.checks.filter(x=>x.kind==='unconfigured')){
  const next=generated.checks.find(x=>x.id===old.id);
  if(next&&!['unconfigured','human-review'].includes(next.kind)&&!preparationReason(next,c))candidates.push({ref:'candidate-'+candidates.length,targetId:old.id,check:next});
 }
 // Search can be exercised by its observed GET form even without a submit button.
 if(c.checks.some(x=>x.id==='coverage-navigation'&&x.kind==='unconfigured')&&!candidates.some(x=>x.targetId==='coverage-navigation')&&a.public?.search){
  const check={id:'coverage-navigation',title:'取得した検索フォーム・メニューの操作',suite:'delivery',kind:'discovered-public',required:true,options:{area:'navigation',path:profile.sitePath||'/',search:a.public.search,...(a.public.menu?{menu:a.public.menu}:{})}};
  validateConfig({...c,checks:[check]});if(!preparationReason(check,c))candidates.push({ref:'candidate-'+candidates.length,targetId:check.id,check});
 }
 for(const candidate of candidates){
  const old=c.checks.find(x=>x.id===candidate.targetId);candidate.check.required=old.required;
  candidate.residual=generated.manual?.find(x=>x.id==='discovery-scope-'+candidate.targetId.replace('coverage-',''))??{id:'discovery-scope-'+candidate.targetId.replace('coverage-',''),title:'自動補完した検査の確認範囲',required:true,reason:'取得した構造・宣言の整合性と操作を検査します。業務上の期待結果、検索内容や未取得の導線の妥当性は別途確認が必要です。'};
 }
 return {local:{candidates,forms:a.public?.forms??[]},projection:{version:1,observedAt:a.observedAt??null,adminAuthenticated:discovery.authenticated===true,forms,admin,public:{hasSearch:!!a.public?.search,hasMenu:!!a.public?.menu,sitemapCount:a.public?.sitemaps?.length??0,hasRobots:!!a.public?.robots},existingBindings:keys.filter(k=>profile[k]!==undefined),selectedFormRefs:forms.filter((f,i)=>(!profile.contactFormId||profile.contactFormId===a.public.forms[i].formId)&&(!profile.contactPath||profile.contactPath===a.public.forms[i].path)).map(f=>f.ref),permissions:{writes:profile.writes===true,submit:profile.submit===true,bankOrder:profile.bankOrder===true},candidates:candidates.map(x=>({ref:x.ref,targetId:x.targetId,kind:x.check.kind,area:x.check.options.area??null})),pending:c.checks.filter(x=>x.kind==='unconfigured').map(x=>({id:x.id,suite:x.suite}))}};
}
export const evidenceSchema={type:'object',additionalProperties:false,required:['bindings','selections','controls'],properties:{controls:{type:'array',items:{type:'object',additionalProperties:false,required:['formRef','controlRef','nextControlRef'],properties:{formRef:{type:'string'},controlRef:{type:'string'},nextControlRef:{type:'string',description:'Observed final submit control after confirmation, or empty string'}}}},bindings:{type:'array',items:{type:'object',additionalProperties:false,required:['key','formRef','fieldRef'],properties:{key:{type:'string',enum:keys},formRef:{type:'string'},fieldRef:{type:'string'}}}},selections:{type:'array',items:{type:'string'}}}};
export function applyEvidenceDecision(config,profile,discovery,decision){
 const evidence=preparationEvidence(config,profile,discovery);
 if(!decision||Object.keys(decision).some(k=>!['bindings','selections','controls'].includes(k))||!Array.isArray(decision.bindings)||!Array.isArray(decision.selections)||decision.bindings.length>4||new Set(decision.selections).size!==decision.selections.length)throw Error('取得根拠に対するAI補完形式が不正です');
 const p=structuredClone(profile),c=structuredClone(config),bound=new Set(),d=structuredClone(discovery);
 if(decision.controls!==undefined&&(!Array.isArray(decision.controls)||decision.controls.length>20))throw Error('操作候補が不正です');
 const selectedForms=new Set();
 for(const item of decision.controls??[]){
  if(!item||Object.keys(item).some(k=>!['controlRef','formRef','nextControlRef'].includes(k))||selectedForms.has(item.formRef))throw Error('操作候補が不正です');selectedForms.add(item.formRef);
  const index=evidence.projection.forms.findIndex(f=>f.ref===item.formRef),form=d.automation?.public?.forms?.[index];
  const ci=evidence.projection.forms[index]?.controls.findIndex(x=>x.ref===item.controlRef);
  const control=d.automation?.public?.formControls?.filter(x=>x.formId===form?.formId&&x.path===form?.path)[ci];
  if(!form||form.submitSelector||!control||!label(control.label))throw Error('取得した操作候補とAIの参照が一致しません');
  if(!/確認|送信|submit|confirm|send|次へ|next/i.test(control.label)||/削除|購入|決済|取消|delete|purchase|pay|cancel/i.test(control.label))throw Error('送信・確認以外の操作は採用できません');
  form.submitSelector=control.selector;
  if(item.nextControlRef){
   const nextIndex=evidence.projection.forms[index].controls.findIndex(x=>x.ref===item.nextControlRef);
   const next=d.automation.public.formControls.filter(x=>x.formId===form.formId&&x.path===form.path)[nextIndex];
   if(!next||next.selector===control.selector||!/送信|submit|send/i.test(next.label)||/削除|購入|決済|取消|delete|purchase|pay|cancel/i.test(next.label))throw Error('取得した最終送信候補がありません');
   form.nextSubmitSelector=next.selector;
  }
  for(const check of [...c.checks,...(p.automation?.additionalChecks??[])].filter(x=>x.kind==='discovered-public'&&preparationReason(x,c))){for(const f of check.options.forms??[])if(f.formId===form.formId&&f.path===form.path&&!f.submitSelector){f.submitSelector=control.selector;if(form.nextSubmitSelector)f.nextSubmitSelector=form.nextSubmitSelector;}}
 }

 for(const b of decision.bindings){
  if(!b||Object.keys(b).sort().join(',')!=='fieldRef,formRef,key'||!keys.includes(b.key)||bound.has(b.key))throw Error('補完対象が不正です');bound.add(b.key);
  const fi=evidence.projection.forms.findIndex(f=>f.ref===b.formRef),form=evidence.local.forms[fi],fieldIndex=evidence.projection.forms[fi]?.fields.findIndex(f=>f.ref===b.fieldRef),field=form?.fields[fieldIndex];
  if(!form||!field||!types[b.key].includes(field.type)||!safeName(field.name))throw Error('取得した項目とAIの参照が一致しません');
  const eligible=evidence.local.forms.filter(f=>(!p.contactFormId||p.contactFormId===f.formId)&&(!p.contactPath||p.contactPath===f.path));
  if(eligible.length!==1||eligible[0]!==form)throw Error('複数フォームの送信先は利用者が選択してください');
  if(p[b.key]!==undefined&&p[b.key]!==field.name)throw Error('入力済みの期待値は上書きできません');
  p[b.key]=field.name;p.contactFormId=form.formId;p.contactPath=form.path;
 }
 for(const ref of decision.selections){const candidate=evidence.local.candidates.find(x=>x.ref===ref);if(!candidate)throw Error('取得根拠のない検査は採用できません');const index=c.checks.findIndex(x=>x.id===candidate.targetId&&x.kind==='unconfigured');if(index<0)throw Error('準備状態が変更されています');c.checks[index]=candidate.check;c.manual??=[];if(!c.manual.some(x=>x.id===candidate.residual.id))c.manual.push(candidate.residual);}
 validateConfig(c);
 return {config:c,discovery:d,controlRefs:structuredClone(decision.controls??[]),profile:resolveAutomationProfile(p,d),adopted:decision.selections.length,adoptedIds:decision.selections.map(ref=>evidence.local.candidates.find(c=>c.ref===ref).targetId),bindingRefs:structuredClone(decision.bindings),bindings:decision.bindings.length};
}
export function unresolvedPreparation(config,profile){
 return config.checks.filter(c=>preparationReason(c,config)).map(c=>{
  const k=c.id.replace('coverage-','');let category='discovery',message='サイトから判定条件を取得できませんでした。担当者の技術入力ではなく、取得方法・対応機能の確認が必要です。';
  if(['publishing','scheduled','cache'].includes(k)){category='permission';message='検証環境でテスト投稿の作成・回収を許可するか選択してください。';}
  if(k==='contact-success'){category='input';message=profile.submit?'テスト用メールアドレスと送信対象フォームを確認してください。':'検証環境で問い合わせのテスト送信を許可するか選択してください。';}
  if(k==='performance'){category='input';message='合否判定が必要な場合のみ、合意した読込時間の上限を入力してください。参考測定は実行できます。';}
  if(['roles','membership'].includes(k)){category='credentials';message='管理者以外のテスト用アカウントと、アクセスを許可する範囲が必要です。';}
  if(['notification','autoreply','order-notification'].includes(k)){category='integration';message='通知先の受信箱を照合できる接続が必要です。完了画面だけではメール到達を判定できません。';}
  if(['order','order-record','order-cleanup'].includes(k)){category='input';message='ECがある場合のみ、テスト注文の許可・商品・配送条件・合計の期待値を確認してください。';}
  if(['update','restore'].includes(k)){category='integration';message='隔離された検証先と更新・復元の実行手段が必要です。運用担当者による準備が必要です。';}
  if(k==='analytics'){category='input';message='計測の合否判定が必要な場合は、取得すべきイベントと同意条件を確認してください。';}
  if(['publishing','cache'].includes(k)&&profile.writes){category='implementation';message='投稿操作の許可は登録済みです。既存の標準検査との紐付けと、未対応の投稿型・一覧・検索等の取得・検査実装を確認します。';}
  if(k==='scheduled'&&profile.writes){category='mixed';message='予約投稿の許可は登録済みです。予約投稿の検査結果を紐付け、その他の定期処理は対象ジョブ・実行間隔・成功条件を利用者が指定する必要があります。';}
  if(['order','order-record','order-cleanup'].includes(k)&&profile.bankOrder){category='implementation';message='注文検査の許可は登録済みです。既存の受注・取消検査との紐付け、および残る送料・在庫条件の取得と検査実装が必要です。期待金額の承認は推測しません。';}
  if(c.kind!=='unconfigured'){category='implementation';message='検査形式は生成済みですが、実行条件が不足しています。'+(/form.submitSelector/.test(preparationReason(c,config))?'送信・確認ボタンの操作を特定できません。独自フォームへの対応が必要です。':'取得処理と実行器の対応を確認します。');}
  const owner=['discovery','implementation'].includes(category)?'tool':category==='mixed'?'shared':'user';
  return {id:c.id,title:c.title,category,owner,message};
 });
}

export function requiredRegistrationInputs(profile,discovery){
 if(!profile.submit)return [];
 const forms=discovery.automation?.public?.forms??[];
 const eligible=forms.filter(f=>(!profile.contactFormId||profile.contactFormId===f.formId)&&(!profile.contactPath||profile.contactPath===f.path));
 if(eligible.length!==1)return [{key:'contactFormId',label:'テスト送信する問い合わせフォーム',choices:forms.map(f=>({value:f.formId,label:f.path+' のフォーム '+f.formId})),message:forms.length?'複数の候補から、テスト送信するフォームを選んでください。':'フォームを取得できませんでした。取得方法の確認が必要です。項目名を推測して入力する必要はありません。'}];
 return keys.slice(0,3).filter(k=>!profile[k]).map(k=>({key:k,label:{contactNameField:'担当者名を入力する欄',contactEmailField:'メールアドレスを入力する欄',contactMessageField:'問い合わせ本文を入力する欄'}[k],message:'取得できた項目から用途を選んでください。',choices:eligible[0].fields.filter(f=>types[k].includes(f.type)).map(f=>({value:f.name,label:discovery.automation.public.fieldLabels?.find(l=>l.formId===eligible[0].formId&&l.name===f.name)?.label||f.name}))}));
}
