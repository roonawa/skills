import {unresolvedPreparation} from './evidence-preparation.mjs';

// 結果画面の「次にやること」と「まだ確認していないもの」の振り分け。保存済みの設定だけから計算し、何も書き換えない。
export const ITEM_CHECKS={writes:['coverage-publishing','coverage-cache','coverage-scheduled'],submit:['coverage-contact-success'],performance:['coverage-performance'],sensitivePaths:['auto-security-exposure']};
export const COMMERCE_PLUGINS=['usc-e-shop','woocommerce','easy-digital-downloads','wp-e-commerce','wp-easycart','ecwid-shopping-cart','jigoshop','surecart','wp-simple-pay','stripe-payments','shopp'];
// 通販プラグインは会員（購入者アカウント）機能も持つため、会員の判定にも含める。
export const MEMBERSHIP_PLUGINS=['wp-members','simple-membership','paid-memberships-pro','ultimate-member','memberpress','s2member','restrict-content','restrict-content-pro','buddypress','profile-builder','wp-user-frontend','user-registration','armember-membership','indeed-membership-pro','woocommerce-memberships','theme-my-login','usc-e-shop','woocommerce','easy-digital-downloads','surecart'];
const ORDER_CHECKS=['coverage-order','coverage-order-record','coverage-order-cleanup','coverage-order-notification'],PRODUCTION_CHECKS=[...ITEM_CHECKS.writes,...ITEM_CHECKS.submit];
const MESSAGES={
 discovery:'サイトから判定に必要な情報を取得できませんでした。ツールの取得方法を確認します。',
 permission:'テスト投稿を作ってよいかの許可が必要です。',
 input:'合否を決めるための条件がまだ決まっていません（技術担当が準備）。',
 integration:'結果を確かめるための外部とのつなぎ込みが必要です（技術担当が準備）。',
 credentials:'管理者以外のテスト用アカウントと、確認してよい範囲の取り決めが必要です（技術担当が準備）。',
 implementation:'この検査を自動で動かすための対応が必要です（技術担当が対応）。',
 mixed:'一部は動かせますが、残りは対象と成功の条件を決める必要があります（技術担当と相談）。',
 notRelevant:'このサイトでは確認しなくてよいと判断しました。判断の根拠を確かめてください。'
};
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
export function notApplicableChecks(config,profile){
 const ids=new Set(config.checks.map(c=>c.id)),out={},inv=profile.automation?.pluginInventory,overrides=new Set(profile.automation?.relevantOverrides??[]);
 const set=(list,reason)=>{for(const id of list)if(ids.has(id)&&!overrides.has(id))out[id]=reason;};
 if(inv?.observed===true){
  const has=list=>inv.slugs.some(s=>list.includes(s)),why=name=>`有効なプラグインに${name}機能が見つからないため対象外（登録時の取得）`;
  if(!has(COMMERCE_PLUGINS))set(ORDER_CHECKS,why('通販'));
  if(!has(MEMBERSHIP_PLUGINS))set(['coverage-membership'],why('会員'));
 }
 if(config.environment==='production')for(const id of PRODUCTION_CHECKS)if(ids.has(id))out[id]='本番環境ではテスト投稿・フォーム送信を実行しないため対象外';
 return out;
}
export function triage(config,profile){
 const prep=unresolvedPreparation(config,profile),na=notApplicableChecks(config,profile),required=new Set(prep.map(x=>x.id)),prod=config.environment==='production';
 const items=[
  {key:'writes',show:!prod&&profile.writes!==true,label:'テスト投稿の作成・公開・削除を許可する',effect:'「QA」で始まるテスト投稿を作り、確認したあとに削除します。サイトの監視や通知の設定によっては、投稿の公開が知らされる場合があります。',input:{type:'checkbox',current:false}},
  {key:'submit',show:!prod&&!!(profile.contactPath||profile.contactFormId)&&!(profile.submit===true&&profile.testEmail),label:'問い合わせフォームの実際の送信を許可し、テスト用のメールアドレスを入れる',effect:'問い合わせフォームから実際に送信します。サイトの通知先にもメールが届きます。顧客の監視に検知される場合があります。',input:{type:'email+checkbox',current:{submit:profile.submit===true,testEmail:profile.testEmail??''}}},
  {key:'performance',show:!profile.performanceMs,label:'トップページの表示にかかる時間の上限（秒）',effect:'顧客と合意した秒数を入れてください。表示にこの秒数より長くかかると不合格になります。',input:{type:'seconds'}},
  {key:'sensitivePaths',show:config.allowSensitivePaths!==true,label:'機密ファイルが外から見えないかの確認を許可する',effect:'設定ファイルやバックアップなど、公開されてはいけないファイルのURLを読み取りだけで確認します。顧客の監視に検知される場合があります。',input:{type:'checkbox',current:false}}
 ];
 const todo=items.filter(x=>x.show).map(({show,...x})=>({...x,checkIds:ITEM_CHECKS[x.key],count:ITEM_CHECKS[x.key].filter(id=>required.has(id)&&!na[id]).length})).filter(x=>x.count>0);
 const inTodo=new Set(todo.flatMap(x=>x.checkIds)),toolGap=[],technical=[];
 for(const x of prep)if(!inTodo.has(x.id)&&!na[x.id])(x.category==='discovery'?toolGap:technical).push({id:x.id,title:x.title,message:plainMessage(x.id,x.category)});
 const notRelevant=config.checks.filter(c=>na[c.id]).map(c=>({id:c.id,title:c.title,message:plainMessage(c.id,'notRelevant'),reason:na[c.id],revertible:!(prod&&PRODUCTION_CHECKS.includes(c.id))}));
 return {todo,toolGap,technical,notRelevant};
}
