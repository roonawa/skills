import {applyAutomationPlan,mergeAutomationConfig,resolveAutomationProfile} from './automation-plan.mjs';
import {preparationEvidence,applyEvidenceDecision,unresolvedPreparation} from './evidence-preparation.mjs';
import {preparationReason} from '../lib/checks/index.mjs';
import {registrationConfig,validateProfile} from './registration.mjs';
import {validateConfig} from '../lib/config.mjs';

export function compilePreparation(input,profile={},discovery={}){
 const c=applyAutomationPlan(input,{...profile,writes:discovery.authenticated===true&&profile.writes===true},discovery);
 c.manual??=[];c.journeys??=[];c.visuals??=[];
 const note=(id,reason)=>{if(!c.manual.some(x=>x.id===id))c.manual.push({id,title:'自動検査後の直接確認',required:true,reason});};
 const links={inventory:['profile-inventory','CMS公開URL照合を実行します。旧URLの完全な移行元一覧と公開範囲の業務判断は別途確認します。'],publishing:['profile-post-lifecycle','標準投稿の作成・公開・更新・回収を検査します。固定ページ・商品・独自投稿型の編集内容は別の検査対象です。'],scheduled:['profile-scheduled','予約投稿の公開・回収を検査します。固有の定期ジョブには対象・間隔・成功条件が必要です。'],'contact-success':['profile-contact-submit','指定フォームの送信・管理保存を検査します。受信箱への到着は別途照合が必要です。'],order:['profile-bank-order','登録された商品の銀行振込注文・受注・取消を検査します。他の商品・地域送料・在庫競合は別の検査対象です。'],'order-record':['profile-bank-order','今回のテスト注文を照合します。任意の注文すべての整合性を保証しません。'],'order-cleanup':['profile-bank-order','今回作成した注文だけを取消します。既存の注文は対象外です。']};
 for(const [key,[journey,scope]] of Object.entries(links)){
  const allowed=['publishing','scheduled'].includes(key)?profile.writes===true:key==='contact-success'?profile.submit===true:key.startsWith('order')?profile.bankOrder===true:true;
  if(allowed&&c.journeys.some(j=>j.id===journey)&&c.checks.some(x=>x.id==='coverage-'+key&&x.kind==='unconfigured')){c.checks=c.checks.filter(x=>x.id!=='coverage-'+key);note('scope-'+key,journey+' に紐付け。'+scope);}
 }
 const human={metadata:['auto-metadata','文言・SEO効果・検索公開方針の妥当性'],keyboard:['auto-keyboard','読み上げの利用感・意味のある操作順'],multilingual:['auto-multilingual','翻訳の意味・言語ごとの掲載方針']};
 for(const [key,[id,scope]] of Object.entries(human)){
  const row=c.checks.find(x=>x.id==='coverage-'+key&&x.kind==='unconfigured');
  const ready=c.checks.find(x=>x.id===id&&!preparationReason(x,c));
  if(row&&ready){row.kind='human-review';row.options={instructions:`構造検査は ${id} の実行結果へ紐付けます。${scope}は直接確認してください。構造検査の合格だけでは完了しません。`};}
 }
 return c;
}

export async function completePreparation(config,profile,discovery,{ai,aiEnabled=false}={}){
 let p=resolveAutomationProfile(profile,discovery),d=structuredClone(discovery),mode='rules',warning=null,controls=[];
 const evidence=preparationEvidence(config,p,d);
 let result=applyEvidenceDecision(config,p,d,{bindings:[],selections:evidence.local.candidates.map(c=>c.ref)});
 const aiNeeded=evidence.local.candidates.length>0||evidence.projection.forms.some(f=>f.controls?.length)||evidence.projection.selectedFormRefs.length===1&&['contactNameField','contactEmailField','contactMessageField','contactConsentField'].some(k=>p[k]===undefined);
 if(aiEnabled&&ai&&aiNeeded){try{result=await ai.resolveEvidence(config,p,d);mode='claude';controls=result.controlRefs??[];}catch{warning='Claude補完が完了しませんでした。取得根拠で確定できる設定のみ採用しました。API設定・利用上限・応答ログを確認してください。';}}
 if(result.rejectedBindings)warning='AIの項目対応付け'+result.rejectedBindings+'件が取得情報と一致しないため除外しました。操作候補は独立して検証しました。';
 p=result.profile;d=result.discovery??d;
 let c=result.config;
 if(d.authenticated===true){
  // Only saved permissions and validated profile values may generate write journeys.
  try{const valid=validateProfile(p,c.environment);const generated=registrationConfig({name:c.name,baseURL:c.baseURL,environment:c.environment,profile:valid,discovery:{...d,pages:d.pages?.length?d.pages:c.pages,warnings:d.warnings??[]}});
   // Do not widen production journey permission when preparing an existing seed/config.
   if(c.environment==='production'&&c.allowProductionJourneys!==true)generated.journeys=[];
   c=mergeAutomationConfig(c,generated);
  }catch{warning=warning??'標準操作の登録条件が不足しています。公開検査だけ補完しました。';}
 }
 c=compilePreparation(c,p,d);c.allowSensitivePaths=config.allowSensitivePaths===true;validateConfig(c);
 const before=unresolvedPreparation(config,profile),after=unresolvedPreparation(c,p),remainingIds=new Set(after.map(x=>x.id));
 const resolvedIds=before.filter(x=>!remainingIds.has(x.id)).map(x=>x.id);
 return {config:c,profile:p,summary:{mode,warning,createdAt:new Date().toISOString(),adopted:resolvedIds.length,adoptedIds:resolvedIds,controlRefs:controls,aiFailure:mode==='rules'?ai?.lastEvidenceFailure??null:null,bindings:result.bindings,remaining:after,verification:'実行前の条件検証済み。操作の合否は検査結果を参照してください。'}};
}

export async function prepareSaved(record,{secrets={},registrationDiscovery,publicDiscovery,ai,aiEnabled=false}={}){
 if(record.profile?.writes===true&&record.config.allowTestWrites!==true)throw Error('保存済みの操作許可が一致しません');
 const first=record.config.pages?.[0]?.path??'/';
 const profile=record.profile??{sitePath:first.endsWith('/')?first:first.slice(0,first.lastIndexOf('/')+1),writes:false};
 let discovery,warning;
 if(record.profile&&secrets.browser){try{discovery=await registrationDiscovery({baseURL:record.config.baseURL,profile:validateProfile(profile,record.config.environment),state:secrets.browser,publicPassword:secrets.publicPassword??''});}catch{warning='管理画面の情報を取得できませんでした。公開ページで取得できる情報を使用しました。';}}
 if(!discovery){const cookies=(secrets.browser?.cookies??[]).filter(c=>/^(?:bid_\d+_)?password_protected_/.test(c.name)&&!/(?:^|_)password_protected_cookie_test$/.test(c.name));discovery={authenticated:false,pages:record.config.pages,warnings:[],automation:await publicDiscovery({baseURL:record.config.baseURL,profile,pages:record.config.pages,publicHeaders:cookies.length?{Cookie:cookies.map(c=>c.name+'='+c.value).join('; ')}:{}})};}
 const result=await completePreparation(record.config,profile,discovery,{ai,aiEnabled});
 result.summary.warning=[warning,result.summary.warning].filter(Boolean).join(' ')||null;
 result.summary.authenticated=discovery.authenticated===true;
 return result;
}
