import {unresolvedPreparation} from './evidence-preparation.mjs';
import {ORDER_CHECKS,MEMBERSHIP_CHECKS,PRODUCTION_CHECKS,autoJudgeable} from '../lib/auto-not-applicable.mjs';

// 結果画面の「次にやること」と「まだ確認していないもの」の振り分け。保存済みの設定だけから計算し、何も書き換えない。
export const ITEM_CHECKS={writes:['coverage-publishing','coverage-cache','coverage-scheduled'],submit:['coverage-contact-success'],performance:['coverage-performance'],sensitivePaths:['auto-security-exposure']};
export const COMMERCE_PLUGINS=['usc-e-shop','woocommerce','easy-digital-downloads','wp-e-commerce','wp-easycart','ecwid-shopping-cart','jigoshop','surecart','wp-simple-pay','stripe-payments','shopp'];
// 通販プラグインは会員（購入者アカウント）機能も持つため、会員の判定にも含める。
export const MEMBERSHIP_PLUGINS=['wp-members','simple-membership','paid-memberships-pro','ultimate-member','memberpress','s2member','restrict-content','restrict-content-pro','buddypress','profile-builder','wp-user-frontend','user-registration','armember-membership','indeed-membership-pro','woocommerce-memberships','theme-my-login','sfwd-lms','lifterlms','tutor','learnpress','bbpress','wpforo','wp-user-manager','peepso-core','usc-e-shop','woocommerce','easy-digital-downloads','surecart'];
// フォルダー名の変更・版付き（woocommerce-8.5.1）や拡張だけが見える場合も通販ありとみなす。
const COMMERCE_PREFIXES=['woocommerce','wc-','usc-e-shop','wcex','welcart'];
const MESSAGES={
 discovery:'サイトから判定に必要な情報を取得できませんでした。ツールの取得方法を確認します。',
 permission:'テスト投稿を作ってよいかの許可が必要です。',
 input:'合否を決めるための条件がまだ決まっていません（技術担当が準備）。',
 integration:'結果を確かめるための外部とのつなぎ込みが必要です（技術担当が準備）。',
 credentials:'管理者以外のテスト用アカウントと、確認してよい範囲の取り決めが必要です（技術担当が準備）。',
 implementation:'この検査を自動で動かすための対応が必要です（技術担当が対応）。',
 mixed:'一部は動かせますが、残りは対象と成功の条件を決める必要があります（技術担当と相談）。',
 notRelevant:'このサイトでは確認しなくてよいと判断しました。判断の根拠を確かめてください。',
 adminLogin:'管理画面のログインを保存すると検査できます（技術担当が準備）。',
 noProfile:'このサイトは標準操作テストが未登録です。設定画面で「WordPressの標準操作テストを登録する」を有効にし、タイムゾーン・言語などを入れると準備できます（技術担当が準備）。'
};
// 保存時の validateProfile が送信の許可に求める項目。ひとつでも欠ければ保存が失敗する。
const SUBMIT_FIELDS=['contactFormId','contactPath','contactNameField','contactEmailField','contactMessageField'];
const BY_CHECK={
 notification:'送信したメールが届いたかを確かめる仕組みが必要です（技術担当が準備）。',
 autoreply:'自動返信メールが届いたかを確かめる仕組みが必要です（技術担当が準備）。',
 'order-notification':'注文のお知らせメールが届いたかを確かめる仕組みが必要です（技術担当が準備）。',
 update:'更新を安全に試せる検証用の環境と、更新を行う手段が必要です（技術担当が準備）。',
 restore:'復元を安全に試せる検証用の環境と、復元を行う手段が必要です（技術担当が準備）。',
 analytics:'計測で送られるべき内容と、同意の条件を決める必要があります（技術担当が準備）。',
 'order:input':'テスト注文に使う商品・配送先・期待する合計金額と、注文の許可が必要です（技術担当が準備）。',
 'order-record:input':'テスト注文が受注として正しく記録されたかを確かめるには、テスト注文の準備が必要です（技術担当が準備）。',
 'order-cleanup:input':'テスト注文を取り消して元に戻すには、テスト注文の準備が必要です（技術担当が準備）。',
 'contact-success:input':'フォームの実際の送信を確かめるには、送信するフォームの特定が必要です（技術担当が準備）。',
 'scheduled:mixed':'予約公開の確認は動かせます。そのほかの定期処理は、対象と成功の条件を決める必要があります（技術担当と相談）。'
};
// 画面に出す文言はここだけで決める。内部の理由文（results.json・CLI 用）は使わない。
export function plainMessage(checkId,category){
 if(category==='discovery'||category==='notRelevant')return MESSAGES[category];
 const k=String(checkId).replace(/^coverage-/,'');
 return BY_CHECK[k+':'+category]??BY_CHECK[k]??MESSAGES[category]??MESSAGES.implementation;
}
const observedDate=(at,timeZone)=>{try{return new Intl.DateTimeFormat('sv-SE',{timeZone:timeZone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}catch{return at.slice(0,10);}};
export function notApplicableChecks(config,profile){
 const judgeable=new Set(config.checks.filter(c=>autoJudgeable(c,config.environment)).map(c=>c.id)),out={},inv=profile.automation?.pluginInventory,overrides=new Set(profile.automation?.relevantOverrides??[]);
 const set=(list,reason)=>{for(const id of list)if(judgeable.has(id)&&!overrides.has(id))out[id]=reason;};
 if(inv?.observed===true){
  const commerce=inv.slugs.some(s=>COMMERCE_PLUGINS.includes(s)||COMMERCE_PREFIXES.some(p=>s.startsWith(p))),why=name=>`有効なプラグインに${name}機能が見つからないため対象外（登録時の取得${inv.observedAt?'：'+observedDate(inv.observedAt,profile.timezone):''}）`;
  // 担当者が注文ありと登録した場合は、取得結果より申告を優先する。
  if(!commerce&&profile.bankOrder!==true)set(ORDER_CHECKS,why('通販'));
  if(!commerce&&!inv.slugs.some(s=>MEMBERSHIP_PLUGINS.includes(s)))set(MEMBERSHIP_CHECKS,why('会員'));
 }
 if(config.environment==='production')for(const id of PRODUCTION_CHECKS)if(judgeable.has(id))out[id]='本番環境ではテスト投稿・フォーム送信を実行しないため対象外';
 return out;
}
// adminLogin：管理画面のログインが保存済みか（投稿・送信の検査に必要）。notApplicable：保存済みの自動の対象外（一覧と同じ値を使うとき）。
// profile が無い（標準操作テスト未登録の）サイトでは、投稿・送信・表示上限はタイムゾーン等の登録が先に要るため「次にやること」に出さない。
export function triage(config,stored,{adminLogin=false,notApplicable}={}){
 const registered=!!stored,profile=stored??{},needsProfile=new Set([...ITEM_CHECKS.writes,...ITEM_CHECKS.submit,...ITEM_CHECKS.performance]);
 const prep=unresolvedPreparation(config,profile),na=notApplicable??notApplicableChecks(config,profile),required=new Set(prep.map(x=>x.id)),prod=config.environment==='production',form=SUBMIT_FIELDS.every(k=>profile[k]);
 const items=[
  {key:'writes',show:registered&&!prod&&adminLogin&&profile.writes!==true,label:'テスト投稿の作成・公開・削除を許可する',effect:'「QA」で始まるテスト投稿を作り、確認したあとに削除します。サイトの監視や通知の設定によっては、投稿の公開が知らされる場合があります。',input:{type:'checkbox',current:false}},
  {key:'submit',show:registered&&!prod&&adminLogin&&form&&!(profile.submit===true&&profile.testEmail),label:'問い合わせフォームの実際の送信を許可し、テスト用のメールアドレスを入れる',effect:'問い合わせフォームから実際に送信します。サイトの通知先にもメールが届きます。顧客の監視に検知される場合があります。',input:{type:'email+checkbox',current:{submit:profile.submit===true,testEmail:profile.testEmail??''}}},
  {key:'performance',show:registered&&!profile.performanceMs,label:'トップページの表示にかかる時間の上限（秒）',effect:'顧客と合意した秒数を入れてください。表示にこの秒数より長くかかると不合格になります。',input:{type:'seconds'}},
  {key:'sensitivePaths',show:config.allowSensitivePaths!==true,label:'機密ファイルが外から見えないかの確認を許可する',effect:'設定ファイルやバックアップなど、公開されてはいけないファイルのURLを読み取りだけで確認します。顧客の監視に検知される場合があります。',input:{type:'checkbox',current:false}}
 ];
 const todo=items.filter(x=>x.show).map(({show,...x})=>({...x,checkIds:ITEM_CHECKS[x.key],count:ITEM_CHECKS[x.key].filter(id=>required.has(id)&&!na[id]).length})).filter(x=>x.count>0);
 const inTodo=new Set(todo.flatMap(x=>x.checkIds)),toolGap=[],technical=[];
 const message=x=>!registered&&needsProfile.has(x.id)?MESSAGES.noProfile:ITEM_CHECKS.submit.includes(x.id)&&!form?plainMessage(x.id,'input'):!prod&&!adminLogin&&[...ITEM_CHECKS.writes,...ITEM_CHECKS.submit].includes(x.id)?MESSAGES.adminLogin:plainMessage(x.id,x.category);
 for(const x of prep)if(!inTodo.has(x.id)&&!na[x.id])(x.category==='discovery'?toolGap:technical).push({id:x.id,title:x.title,message:message(x)});
 const notRelevant=config.checks.filter(c=>na[c.id]).map(c=>({id:c.id,title:c.title,message:plainMessage(c.id,'notRelevant'),reason:na[c.id],revertible:!(prod&&PRODUCTION_CHECKS.includes(c.id))}));
 return {todo,toolGap,technical,notRelevant};
}
