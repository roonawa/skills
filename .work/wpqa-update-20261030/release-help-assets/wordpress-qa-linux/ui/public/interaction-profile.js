// Shared by registration, the settings editor and Node. Keep this module browser-safe.
const operations = [
 ['all-links','公開ページの全リンク','delivery'],
 ['search-product','商品検索','delivery'],['search-empty','検索結果なし','delivery'],['search-special','特殊文字の検索','delivery'],
 ['menu','メニュー開閉','delivery'],['menu-navigation','メニューからの移動','delivery'],
 ['contact-validation','問い合わせの入力検証','delivery'],['server-validation','問い合わせのサーバー検証','delivery'],
 ['network-failure','問い合わせの通信失敗','delivery'],['keyboard','キーボード操作','accessibility'],
 ['firefox','Firefoxでの表示','compatibility'],['performance','ページ読込の計測','performance'],
 ['public-discovery','公開URLの探索','seo'],['cart-limit','カート数量上限','commerce'],['customer-empty','購入者の必須入力','commerce']
];
const defaults = ['all-links','firefox','performance','public-discovery'];
const writeOperations = ['server-validation','cart-limit','customer-empty'];
const groups = {
 search: {openSelector:'検索を開くボタン',inputSelector:'検索入力欄',submitSelector:'検索ボタン',term:'商品を検索する語句',resultSelector:'検索結果の要素',emptyTerm:'結果がない検索語句',specialTerm:'特殊文字を含む検索語句',emptyText:'結果なしの期待文言',resultHeadingSelector:'検索結果の見出し'},
 menu: {buttonSelector:'開閉ボタン',panelSelector:'メニューパネル',stateSelector:'状態を確認する要素',stateAttribute:'状態の属性名',openedValue:'開いた状態の属性値',closedValue:'閉じた状態の属性値',linkSelector:'移動するリンク',targetPath:'移動先パス',targetSelector:'移動先の確認要素'},
 contact: {path:'問い合わせページのパス',formId:'フォームID',restPath:'フォームのRESTパス',nameField:'名前の項目名',emailField:'メールの項目名',messageField:'本文の項目名',consentField:'同意の項目名',submitSelector:'送信ボタン',formSelector:'フォーム要素',responseSelector:'応答メッセージの要素',keyboardSelectors:'キーボードで確認する要素（1行に1つ）'},
 commerce: {productPath:'テスト商品のパス',cartPath:'カートのパス',addSelector:'カートに追加するボタン',quantitySelector:'数量入力欄',updateSelector:'カート数量を更新するボタン',limitQuantity:'上限検証に使う数量',rejectionText:'数量超過の期待文言',customerSelector:'購入者情報へ進むボタン',nextSelector:'購入者情報から次へ進むボタン',requiredSelector:'必須入力欄',errorText:'必須入力エラーの期待文言',confirmSelector:'確認画面の要素',forbiddenTotalText:'表示されてはいけない合計文言'},
 inventory: {postTypes:'照合する投稿タイプ（1行に1つ）',supplementalPaths:'追加で照合するパス（1行に1つ）',componentRedirects:'部品の転送先（JSON配列：postType と path）'}
};
const groupLabels={search:'検索',menu:'メニュー',contact:'問い合わせ・キーボード',commerce:'カート・購入者情報',inventory:'CMS公開URLの照合範囲'};
const arrays=new Set(['paths','representativePaths','keyboardSelectors','postTypes','supplementalPaths']);
const numbers=new Set(['formId','limitQuantity','scrollSteps','scrollStepPx']);
const pathKeys=new Set(['sitePath','path','restPath','targetPath','productPath','cartPath']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
// Pure contract shared with catalog/runtime callers. Keys refer to editor fields.
export function interactionMissingConditions(operation, settings={}) {
 const required=[],need=(...keys)=>required.push(...keys),s=settings??{},op=operation;
 if(defaults.includes(op)&&(!Array.isArray(s.paths)||!s.paths.length||s.paths.some(p=>typeof p!=='string'||!p.trim())))need('paths');
 if(![...defaults,'server-validation'].includes(op))need('mainSelector');
 if(op?.startsWith('search-')){
  need('sitePath','search.openSelector','search.inputSelector','search.submitSelector','search.resultHeadingSelector');
  need(op==='search-product'?'search.term':op==='search-empty'?'search.emptyTerm':'search.specialTerm',op==='search-product'?'search.resultSelector':'search.emptyText');
 }
 if(op?.startsWith('menu')){
  need('sitePath','menu.buttonSelector','menu.panelSelector','menu.stateSelector','menu.stateAttribute','menu.openedValue','menu.closedValue','menu.linkSelector');
  if(op==='menu-navigation')need('menu.targetPath','menu.targetSelector');
 }
 if(['contact-validation','server-validation','network-failure','keyboard'].includes(op))need('contact.path');
 if(['contact-validation','network-failure'].includes(op))need('contact.emailField','contact.consentField','contact.submitSelector');
 if(['server-validation','network-failure'].includes(op))need('contact.formId','contact.restPath','contact.nameField','contact.emailField','contact.messageField','contact.consentField','contact.formSelector');
 if(op==='network-failure')need('contact.responseSelector');
 if(op==='keyboard'&&(!Array.isArray(s.contact?.keyboardSelectors)||s.contact.keyboardSelectors.length<3||s.contact.keyboardSelectors.some(v=>typeof v!=='string'||!v.trim())))need('contact.keyboardSelectors');
 if(['cart-limit','customer-empty'].includes(op)){
  need('commerce.productPath','commerce.cartPath','commerce.addSelector','commerce.customerSelector');
  need(...(op==='cart-limit'?['commerce.updateSelector','commerce.quantitySelector','commerce.limitQuantity','commerce.rejectionText','commerce.forbiddenTotalText']:['commerce.nextSelector','commerce.requiredSelector','commerce.errorText','commerce.confirmSelector']));
 }
 const missing=[...new Set(required)].filter(key=>{
  if(['paths','contact.keyboardSelectors'].includes(key))return true;
  const value=key.split('.').reduce((v,k)=>v?.[k],s);
  return !(typeof value==='string'||(['contact.formId','commerce.limitQuantity'].includes(key)&&typeof value==='number'))||!String(value).trim();
 });
 if(op==='cart-limit'&&(!Number.isInteger(Number(s.commerce?.limitQuantity))||Number(s.commerce?.limitQuantity)<2))missing.push('commerce.limitQuantity');
 if(['server-validation','network-failure'].includes(op)&&s.contact?.restPath){
  try{
   const endpoint=new URL(s.contact.restPath,'https://preview.invalid');
   if(!/^\d+$/.test(String(s.contact.formId))||!endpoint.pathname.endsWith(`/wp-json/contact-form-7/v1/contact-forms/${s.contact.formId}/feedback`)||endpoint.search||endpoint.hash)missing.push('contact.restPath');
  }catch{missing.push('contact.restPath');}
 }
 return [...new Set(missing)];
}

function conditionLabel(key){
 const [group,field]=key.split('.');
 return ({mainSelector:'本文の要素',sitePath:'公開サイトの起点パス',paths:'検査するパス',writes:'検証環境の操作許可',environment:'検証環境またはローカル環境',testEmail:'テスト用メールアドレス',contactFormId:'CF7フォームID',contactPath:'問い合わせページ',productPath:'テスト商品パス',expectedTotal:'送料込みの期待合計',cartPath:'カートパス',customerPrefecture:'配送先都道府県',bankPaymentLabel:'銀行振込の表示名','commerce.limitQuantity':'上限検証に使う数量（2以上の整数）','contact.restPath':'フォームのRESTパス（CF7フォームIDと一致する feedback パス）'}[key]??(groups[group]?.[field]?`${groupLabels[group]}：${groups[group][field]}`:key))+(key==='contact.keyboardSelectors'?'（3つ以上）':'');
}

// A preparation preview is not a test result or an applicability decision.
export function preparationSummary(config={},profile,settings=profile?.interactions) {
 const automatic=[],additional=[],manual=[];
 const add=(id,title,missing=[],instructions='')=>(missing.length?additional:automatic).push({id,title,missing,instructions});
 const supplied=settings??{},sitePath=supplied.sitePath??profile?.sitePath??config.sitePath??'/';
 const resolved={...supplied,sitePath,paths:supplied.paths??(config.pages?.length?config.pages.map(p=>p.path):[sitePath])};
 for(const [op,title] of operations)if((supplied.enabled??defaults).includes(op)){
  const operationSettings=['firefox','performance','public-discovery'].includes(op)?{...resolved,paths:supplied.representativePaths??resolved.paths.slice(0,3)}:resolved;
  const missing=interactionMissingConditions(op,operationSettings);
  if(writeOperations.includes(op)){
   if(!['staging','local'].includes(config.environment))missing.push('environment');
   if(!(profile?profile.writes:config.allowTestWrites))missing.push('writes');
  }
  add('interaction-'+op,title,missing);
 }
 for(const check of config.checks??[]){
  if(check.kind==='site-interaction'&&operations.some(([op])=>check.id==='interaction-'+op))continue;
  if(check.kind==='unconfigured'||check.preparationRequired)additional.push({id:check.id,title:check.title,missing:[],instructions:check.options?.instructions||'対象・期待値・必要な認証を設定してください。'});
  else if(check.kind==='human-review')manual.push({id:check.id,title:check.title});
  else if(check.kind==='standard-public')add(check.id,check.title);
 }
 if(profile){
  add('profile-inventory','CMS公開URL照合（管理者認証が必要）');
  if(profile.contactFormId)add('profile-contact-schema','問い合わせ設定');
  for(const [flag,id,title,fields] of [
   ['writes','post-lifecycle','投稿の作成・公開・更新・回収',[]],['writes','scheduled','予約公開・回収',[]],
   ['submit','contact-submit','問い合わせ送信（受信箱到達とは別判定）',['contactFormId','contactPath','testEmail']],
   ['bankOrder','bank-order','銀行振込注文・取消',['productPath','cartPath','testEmail','customerPrefecture','bankPaymentLabel','expectedTotal']]
  ])if(profile[flag]){
   const missing=fields.filter(k=>!profile[k]);
   if(!profile.writes)missing.push('writes');
   if(!['local','staging'].includes(config.environment))missing.push('environment');
   add('profile-'+id,title,missing);
  }
 }
 for(const item of config.manual??[])if(!manual.some(row=>row.id===item.id))manual.push({id:item.id,title:item.title});
 // These obligations are supplied by the explicitly selected profile operations.
 // Partial public checks (for example tag discovery) never discharge business expectations.
 const covered=new Set();
 for(const item of automatic){
  const mapping={'profile-inventory':['inventory'],'profile-post-lifecycle':['publishing'],'profile-scheduled':['scheduled'],'profile-contact-submit':['contact-success'],'profile-bank-order':['order','order-record','order-cleanup']};
  for(const key of mapping[item.id]??[])covered.add('coverage-'+key);
 }
 return {automatic,additional:additional.filter(item=>!covered.has(item.id)||!/対象・期待値が未確定|登録時に自動確定できない範囲/.test(item.instructions)),manual};
}

export function renderPreparationSummary(container,summary){
 container.replaceChildren();
 const heading=document.createElement('h3');heading.textContent='保存前の実行準備';container.append(heading);
 const note=document.createElement('p');note.textContent='自動検査の候補と、追加条件・人手確認が必要な範囲を表示しています。認証・接続・実画面は実行時に確認します。すべての観点が自動実行されるわけではありません。未準備・未選択は合格や対象外を意味しません。';container.append(note);
 for(const [key,label] of [['automatic','自動検査の候補'],['additional','追加条件が必要'],['manual','人手で確認']]){
  const section=document.createElement('div');section.dataset.preparation=key;
  const title=document.createElement('h4');title.textContent=`${label}（${summary[key].length}件）`;section.append(title);
  const list=document.createElement('ul');
  for(const item of summary[key]){
   const row=document.createElement('li');row.dataset.preparationId=item.id;row.textContent=item.title;
   if(item.missing?.length)row.append(document.createTextNode(' — 必要な条件：'+item.missing.map(conditionLabel).join('、')));
   if(item.instructions)row.append(document.createTextNode(' — '+item.instructions));
   list.append(row);
  }
  section.append(list);container.append(section);
 }
}
function requireValue(ok, key) { if(!ok)throw new Error(`操作テストの設定が不正です: ${key}`); }
function path(value,key){
 requireValue(typeof value==='string'&&/^\/(?!\/)/.test(value)&&!/[\\\s#]/.test(value)&&!/%(?:2e|2f|5c)/i.test(value)&&!value.split(/[/?]/).some(v=>v==='.'||v==='..'),key);
}
function strings(value,key){requireValue(Array.isArray(value)&&value.every(v=>typeof v==='string'&&v.trim().length>0),key);}

export function validateInteractionSettings(value) {
 if(value===undefined)return undefined;
 requireValue(object(value),'interactions');
 const allowed=['enabled','sitePath','mainSelector','paths','representativePaths','scrollSteps','scrollStepPx','admin',...Object.keys(groups)];
 for(const key of Object.keys(value))requireValue(allowed.includes(key),key);
 if(value.enabled!==undefined){strings(value.enabled,'enabled');requireValue(value.enabled.every(v=>operations.some(([name])=>name===v))&&new Set(value.enabled).size===value.enabled.length,'enabled');}
 for(const [key,v] of Object.entries(value)){
  if(key==='enabled')continue;
  if(key==='scrollSteps'){requireValue(Number.isInteger(v)&&v>=0&&v<=30,key);continue;}
  if(key==='scrollStepPx'){requireValue(Number.isInteger(v)&&v>=100&&v<=1000,key);continue;}
  if(key==='admin'){
   requireValue(Array.isArray(v),key);
   const ids=new Set();
   for(const entry of v){
    requireValue(object(entry)&&Object.keys(entry).every(k=>['id','title','path','selector','read','expected'].includes(k)),'admin');
    for(const k of ['id','title','path','selector'])requireValue(typeof entry[k]==='string'&&entry[k].trim().length>0,`admin.${k}`);
    requireValue(/^[a-z][a-z0-9-]{0,63}$/.test(entry.id)&&!ids.has(entry.id),'admin.id');ids.add(entry.id);
    requireValue(['text','value','checked'].includes(entry.read),'admin.read');
    requireValue(typeof entry.expected===(entry.read==='checked'?'boolean':'string'),'admin.expected');
    requireValue(!/^[a-z]+:/i.test(entry.path),'admin.path');path(entry.path.startsWith('/')?entry.path:'/'+entry.path,'admin.path');
   }
  }
  else if(key==='paths'||key==='representativePaths'){strings(v,key);v.forEach(p=>path(p,key));}
  else if(key==='sitePath')path(v,key);
  else if(key==='mainSelector')requireValue(typeof v==='string',key);
  else {
   requireValue(object(v),key);
   for(const [field,item] of Object.entries(v)){
    const label=`${key}.${field}`;requireValue(Object.hasOwn(groups[key],field),label);
    if(field==='componentRedirects'){
     requireValue(Array.isArray(item),label);
     for(const entry of item){requireValue(object(entry)&&Object.keys(entry).every(k=>['postType','path'].includes(k))&&typeof entry.postType==='string'&&/^[a-zA-Z][\w-]*$/.test(entry.postType),label);path(entry.path,label);}
    }else if(arrays.has(field)){
     strings(item,label);
     if(field==='supplementalPaths')item.forEach(p=>path(p,label));
     if(field==='postTypes')requireValue(item.every(p=>/^[a-zA-Z][\w-]*$/.test(p)),label);
    }else if(numbers.has(field))requireValue(Number.isSafeInteger(item)&&item>0,label);
    else if(pathKeys.has(field))path(item,label);
    else requireValue(typeof item==='string',label);
   }
  }
 }
 return structuredClone(value);
}

export function validateInteractionPermissions(settings, environment, writes) {
 if(settings?.enabled?.some(name=>writeOperations.includes(name))&&(!['local','staging'].includes(environment)||writes!==true))
  throw new Error('サーバー検証・カート検査には検証環境の操作許可が必要です');
}

export function generateInteractionChecks(config, profile={}) {
 const result=structuredClone(config);
 const supplied=validateInteractionSettings(profile.interactions);
 const settings={...supplied,enabled:supplied?.enabled??[...defaults],sitePath:supplied?.sitePath??profile.sitePath??config.sitePath??'/',paths:supplied?.paths??(config.pages?.length?config.pages.map(p=>p.path):[supplied?.sitePath??profile.sitePath??config.sitePath??'/'])};
 settings.representativePaths=supplied?.representativePaths??(config.pages?.length?config.pages.map(p=>p.path):settings.paths).slice(0,3);
 validateInteractionSettings(settings);
 validateInteractionPermissions(settings,config.environment,profile.writes===true&&config.allowTestWrites===true);
 // Only checks with our exact kind/operation/ID tuple belong to this generator.
 result.checks=(result.checks??[]).filter(c=>!(c.kind==='site-interaction'&&operations.some(([op])=>c.id===`interaction-${op}`&&c.options?.operation===op)));
 for(const [operation,title,suite] of operations){
  const id=`interaction-${operation}`;
  if(settings.enabled.includes(operation)&&!result.checks.some(c=>c.id===id))result.checks.push({id,title,suite,kind:'site-interaction',required:true,timeoutMs:operation==='all-links'?900000:300000,options:{operation,settings:structuredClone({...settings,paths:['firefox','performance','public-discovery'].includes(operation)?settings.representativePaths:settings.paths})}});
 }
 if(settings.admin?.length){
  const adminPath=profile.adminPath??settings.sitePath.replace(/\/?$/,'/')+'wp-admin/';
  path(adminPath,'adminPath');
  result.admin??=[];
  for(const entry of settings.admin){
   const index=result.admin.findIndex(a=>a.id===entry.id);
   const target=entry.path.startsWith('/wp-admin/')?adminPath+entry.path.slice('/wp-admin/'.length):entry.path.startsWith('/')?entry.path:adminPath+entry.path;
   requireValue(target.startsWith(adminPath),'admin.path: 管理画面の配下を指定してください');
   const previous=index<0?{}:result.admin[index];
   const updated={...entry,path:target,source:'browser',authenticatedSelector:'#wpadminbar',storageStateEnv:'WPQA_UI_ADMIN_STATE',...(previous.required!==undefined?{required:previous.required}:{}),...(previous.sensitive!==undefined?{sensitive:previous.sensitive}:{})};
   if(index<0)result.admin.push(updated);else result.admin[index]=updated;
  }
 }
 return result;
}

// Named inputs also participate in the registration form's existing draft storage.
export function createInteractionEditor(container) {
 container.innerHTML=`<h3>共通の操作テスト</h3><p>リンク・Firefox・読込計測・公開URL探索は初期選択です。ほかの検査は必要な対象・期待値を入力して選択してください。未設定の期待値は自動で補いません。</p><div data-interaction-operations></div><p>サーバー検証とカート検査には検証環境の操作許可が必要です。ほかのフォーム検査は実行時に書き込みを遮断します。</p><div class="editor-grid" data-interaction-common></div>`;
 const controls=[];
 function add(parent,key,label){
  const field=key.split('.').at(-1),array=arrays.has(field),json=['componentRedirects','admin'].includes(field);
  const wrap=document.createElement('label');wrap.textContent=label;
  const el=document.createElement(array||json?'textarea':'input');el.name='interaction-'+key;el.dataset.interactionKey=key;
  if(array||json){el.rows=json?4:3;el.spellcheck=false;}else if(numbers.has(field)){el.type='number';el.min=field==='scrollSteps'?'0':'1';el.step='1';}
  wrap.append(el);parent.append(wrap);controls.push({key,field,el,array,json});
 }
 for(const [op,title] of operations){const label=document.createElement('label');label.className='check-line';const el=document.createElement('input');el.type='checkbox';el.name='interaction-enabled-'+op;el.dataset.interactionOperation=op;el.defaultChecked=defaults.includes(op);label.append(el,document.createTextNode(title));container.querySelector('[data-interaction-operations]').append(label);}
 const common=container.querySelector('[data-interaction-common]');
 add(common,'sitePath','公開サイトの起点パス（空欄ならサイト設定）');add(common,'mainSelector','本文の要素（検索・メニュー・フォーム等の操作で必要）');add(common,'paths','検査するパス（空欄なら公開ページ一覧・1行に1つ）');
 add(common,'representativePaths','Firefox・性能計測・公開情報調査の代表パス（空欄なら公開ページの先頭3件・1行に1つ）');
 add(common,'scrollSteps','フォーム操作前のスクロール回数（遅延表示がある場合・0〜30）');add(common,'scrollStepPx','1回のスクロール量px（100〜1000、初期450）');
 for(const [group,fields] of Object.entries(groups)){
  const details=document.createElement('details'),summary=document.createElement('summary'),grid=document.createElement('div');summary.textContent=groupLabels[group];grid.className='editor-grid';details.append(summary,grid);container.append(details);
  for(const [key,label] of Object.entries(fields))add(grid,`${group}.${key}`,label+(key.endsWith('Selector')?'（CSSセレクター）':''));
 }
 const adminDetails=document.createElement('details'),adminSummary=document.createElement('summary');adminSummary.textContent='追加の管理設定（詳細JSON）';adminDetails.append(adminSummary);container.append(adminDetails);
 add(adminDetails,'admin','管理設定の配列（id, title, path, selector, read, expected）。read は text/value/checked。path は管理画面からの相対パスも使用できます。同じIDの管理設定は更新し、指定していないIDは維持します。');
 let original={};
 function populate(settings){
  original=validateInteractionSettings(settings)??{};
  for(const el of container.querySelectorAll('[data-interaction-operation]'))el.checked=(original.enabled??defaults).includes(el.dataset.interactionOperation);
  for(const {key,el,array,json} of controls){const value=key.split('.').reduce((v,k)=>v?.[k],original);el.value=value===undefined?'':json?JSON.stringify(value,null,2):array?value.join('\n'):String(value);}
 }
 function read(){
  const settings={enabled:[...container.querySelectorAll('[data-interaction-operation]:checked')].map(el=>el.dataset.interactionOperation)};
  for(const {key,field,el,array,json} of controls){
   if(!el.value.trim()){
    // Empty expected attribute/text values can be intentional, and must survive editing.
    const old=key.split('.').reduce((v,k)=>v?.[k],original);
    if(old!==''&&!Array.isArray(old))continue;
   }
   let value;
   try{value=json?JSON.parse(el.value||'[]'):array?el.value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean):numbers.has(field)?Number(el.value):el.value;}catch{throw new Error(key+' はJSON配列で入力してください');}
   const parts=key.split('.');if(parts.length===1)settings[key]=value;else(settings[parts[0]]??={})[field]=value;
  }
  return validateInteractionSettings(settings);
 }
 populate();return {populate,read};
}
