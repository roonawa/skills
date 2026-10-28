import {validateAutomationInput} from './public/automation-inputs.js';

// Discovery supplies structure, never authorization or business-policy approval.
export function resolveAutomationProfile(input, discovery={}) {
 const p=structuredClone(input), forms=discovery.automation?.public?.forms??[];
 const candidates=forms.filter(f=>(!p.contactFormId||p.contactFormId===f.formId)&&(!p.contactPath||p.contactPath===f.path));
 if(candidates.length===1){
  const f=candidates[0], unique=type=>{const a=f.fields.filter(x=>x.type===type);return a.length===1?a[0].name:undefined;};
  if(p.contactExpectedFields===undefined&&p.automation?.useObservedBaselines!==false){
   // The public declaration is an explicit consistency check against the admin
   // editor, not an invented requirement that every text field must be required.
   const declared=f.fields.filter(x=>typeof x.required==='boolean'&&['text','email','tel','url','number','date','textarea','select','file'].includes(x.type));
   if(declared.length)p.contactExpectedFields=declared.map(({name,type,required})=>({name,type,required}));
  }
  for(const [key,value] of Object.entries({contactFormId:f.formId,contactPath:f.path,contactNameField:unique('text'),contactEmailField:unique('email'),contactMessageField:unique('textarea'),contactConsentField:unique('checkbox')}))if(p[key]===undefined&&value!==undefined)p[key]=value;
 }
 p.automation=validateAutomationInput(p.automation);
 return p;
}

export function applyAutomationPlan(input, profile, discovery={}) {
 const c=structuredClone(input), a=discovery.automation, settings=validateAutomationInput(profile.automation);
 const pending=id=>c.checks.find(x=>x.id===id&&['unconfigured','human-review'].includes(x.kind));
 const remove=id=>{c.checks=c.checks.filter(x=>x.id!==id);};
 const replace=(key,title,suite,options)=>{
  const id='coverage-'+key;if(!pending(id))return;
  remove(id);c.checks.push({id,title,suite,kind:'discovered-public',required:true,timeoutMs:180000,options});
 };
 const note=(key,title,reason)=>{const id='discovery-scope-'+key;if(!c.manual.some(x=>x.id===id))c.manual.push({id,title,reason,required:true});};
 if(profile.writes&&c.environment!=='production'&&pending('coverage-cache')){
  remove('coverage-cache');
  c.checks.push({id:'coverage-cache',title:'投稿更新反映・非公開キャッシュ漏洩（作成から回収）',suite:'cache',kind:'wp-cache',required:true,timeoutMs:180000,options:{restPath:(profile.adminPath||'/wp-admin/').replace(/wp-admin\/$/,'wp-json/wp/v2'),storageStateEnv:'WPQA_UI_ADMIN_STATE'}});
  note('cache','更新反映の確認範囲','今回作成したテスト投稿の公開URLで、管理者の非公開閲覧後の匿名漏洩、公開・更新の反映を3回、非公開への戻しと回収を検査します。一覧・検索・別ロールの固有条件は追加設定が必要です。');
 }
 for(const [group,key] of [['reading','admin-reading'],['discussion','admin-discussion'],['permalink','admin-permalink'],['plugins','admin-plugins']])if(c.admin.some(row=>row.id.startsWith('observed-'+group+'-'))&&pending('coverage-'+key))remove('coverage-'+key);
 if(a){
  if(settings.useObservedBaselines)for(const [group,key,label] of [['reading','admin-reading','表示設定'],['discussion','admin-discussion','コメント設定'],['permalink','admin-permalink','記事URL構造'],['plugins','admin-plugins','有効プラグイン']]){
   const rows=a.admin?.[group]??[];
   if(!rows.length)continue;
   for(const row of rows){
    if(group==='permalink'&&c.admin.some(x=>x.id==='permalinks'))continue;
    const id=('observed-'+group+'-'+row.id.replaceAll('_','-')).slice(0,64);
    if(!c.admin.some(x=>x.id===id))c.admin.push({...row,id,title:`${label}・登録時からの変更検知: ${row.title}`,source:'browser',authenticatedSelector:'#wpadminbar',storageStateEnv:'WPQA_UI_ADMIN_STATE'});
   }
   if(pending('coverage-'+key))remove('coverage-'+key);
   note(key,label+'の運用方針',`管理画面から取得した現在値（${a.observedAt}）を回帰基準として検査します。設定の運用上の妥当性、追加プラグインの要否は担当者の判断が必要です。既に入力した期待値は優先します。${group==='plugins'?'プラグインは取得時の各プラグインが有効のまま存在することを検査します。追加・バージョン・個別プラグイン設定の正しさは別の条件が必要です。':''}`);
  }
  const pub=a.public??{},path=profile.sitePath||'/';
  if(pub.search?.submitSelector||pub.menu)replace('navigation','自動取得した検索・メニューの操作','delivery',{area:'navigation',path,...(pub.search?.submitSelector?{search:pub.search}:{}),...(pub.menu?{menu:pub.menu}:{})});
  if(pub.search||pub.menu)note('navigation','検索・メニューの確認範囲','取得できた検索フォームのGET導線と、状態属性を確認できたメニューの開閉を検査します。検索結果の業務上の正しさ、未検出のメニューや実機操作は追加の期待値が必要です。');
  if(pub.forms?.length){
   replace('contact-errors','フォームの宣言済み必須・メール形式のエラー表示','delivery',{area:'contact-errors',path,forms:pub.forms});
   replace('contact-retry','問い合わせ通信失敗時の表示・再操作（送信遮断）','delivery',{area:'contact-retry',path,forms:pub.forms});
   note('contact-errors','フォームの固有仕様', '検出した入力項目と宣言済みの必須・形式を検査します。独自の文字数上限・添付制限・サーバー検証の仕様は追加条件で指定してください。通信失敗検査は送信を遮断し、実メールを送りません。');
   note('contact-retry','送信成功時の重複防止','通信失敗後の再操作を検査します。成功時の二重登録・重複メールの防止は、送信許可と受注・受信箱等の照合条件が必要です。');
  }
  if(pub.robots||pub.sitemaps?.length){
   replace('crawl','robots・サイトマップの取得と構造・参照先の整合性','seo',{area:'crawl',path,...(pub.robots?{robots:pub.robots}:{}),sitemaps:pub.sitemaps??[]});
   note('crawl','SEO・移行の運用方針','robots・サイトマップの機械的な整合性を検査します。bot別公開方針・旧URLの転送対応表・掲載すべきURLの完全性は運用条件として追加してください。');
  }
 }
 // Existing common operations are genuine execution, not a second placeholder.
 if(c.checks.some(x=>x.id==='interaction-firefox'&&x.kind==='site-interaction')&&pending('coverage-browsers')){
  remove('coverage-browsers');note('browsers','ブラウザー検査の対象','Chromiumの表示検査とFirefoxの共通操作検査を実行します。他の端末・ブラウザーの保証範囲は別途指定してください。');
 }
 for(const check of settings.additionalChecks){
  // Full option/schema validation is performed by validateConfig before saving.
  remove(check.id);c.checks.push({...check,title:check.title||check.id,required:check.required??true});
 }
 const instructions={
  'contact-success':'送信許可とテスト用メールアドレスを登録してください。フォームID・ページ・項目名は一意に検出できる場合は自動取得します。',
  notification:'受信確認APIと宛先が必要です。送信と同じ識別子を使う browser-flow の送信→waitForMail を追加条件に指定してください。',
  autoreply:'自動返信の受信確認API・テスト宛先を指定し、同じ browser-flow 内の送信と受信を照合してください。',
  publishing:'検証環境でのテスト投稿の作成・公開・削除を登録画面で許可すると標準検査が実行されます。',
  scheduled:'検証環境でのテスト投稿を許可すると予約公開・回収の検査を実行します。',
  order:'検証環境の注文許可・テスト商品・配送条件・期待合計を指定してください。価格の現在値を正しい請求額と自動承認しません。',
  'order-record':'銀行振込注文を設定すると受注登録の照合まで標準検査で実行します。',
  'order-cleanup':'銀行振込注文を設定すると今回の識別子に一致するテスト注文だけを取消します。',
  'order-notification':'注文と同じ識別子を含む通知の受信確認API・宛先・照合手順を追加条件に指定してください。',
  roles:'対象ロールの認証と他者データへの読取・更新の許可／拒否を追加条件に指定してください。管理者認証だけでは別ロールを検査できません。',
  cache:'検証環境の投稿操作を許可すると、テスト投稿の更新反映・非公開キャッシュ漏洩・回収を自動検査します。一覧・検索・別ロールまで確認する場合のみ追加条件を指定してください。',
  update:'更新対象・許可と、サーバー側の信頼済み更新アダプター・前後の確認条件が必要です。',
  restore:'隔離した復元先と信頼済み復元アダプター、復元前後のデータ照合条件が必要です。',
  performance:'合意したトップページ読込上限msを登録すると予算の合否を検査します。現在の実測値を合格基準として自動採用しません。',
  analytics:'期待イベント名・値・回数・同意条件が必要です。タグの検出は実行済みですがイベント配送の合否とは区別します。',
  membership:'会員用認証・対象画面・期待する表示と他者データ拒否の条件を追加してください。'
 };
 for(const row of c.checks)if(row.kind==='unconfigured'&&instructions[row.id.replace('coverage-','')])row.options.instructions=instructions[row.id.replace('coverage-','')];
 return c;
}

// Existing expected values and custom checks survive rediscovery. Only unresolved
// generated placeholders can be replaced by a newly available executable check.
export function mergeAutomationConfig(existing, generated){
 const c=structuredClone(existing);
 for(const key of ['admin','checks','manual','journeys','pages','visuals']){
  const incoming=generated[key]??[],byId=new Map(incoming.map(x=>[x.id,x]));
  c[key]=(c[key]??[]).flatMap(old=>{
   const next=byId.get(old.id);byId.delete(old.id);
   if(key==='checks'&&old.kind==='unconfigured'&&old.id.startsWith('coverage-'))return next?[next]:[];
   if(key==='checks'&&old.kind==='discovered-public'&&next?.kind===old.kind&&old.options.area===next.options.area){
    const options={...next.options,...old.options};
    for(const field of ['forms','sitemaps'])if(next.options[field]){
     const identity=x=>field==='forms'?x.path+'#'+x.formId:x.path;
     const prior=old.options[field]??[];
     options[field]=[...prior,...next.options[field].filter(x=>!prior.some(y=>identity(y)===identity(x)))];
    }
    return [{...old,options}];
   }
   return [old];
  });
  c[key].push(...byId.values());
 }
 return c;
}
