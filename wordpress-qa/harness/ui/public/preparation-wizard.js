// Japanese preparation recipes. Discovery provides targets, not permissions or business expectations.
export const profilePreparation={
 'coverage-publishing':['writes'], 'coverage-scheduled':['writes'], 'coverage-cache':['writes'],
 'coverage-contact-success':['writes','submit','testEmail'],
 'coverage-order':['writes','bankOrder','testEmail','productPath','cartPath','customerPrefecture','bankPaymentLabel','expectedTotal'],
 'coverage-order-record':['writes','bankOrder','testEmail','productPath','cartPath','customerPrefecture','bankPaymentLabel','expectedTotal'],
 'coverage-order-cleanup':['writes','bankOrder','testEmail','productPath','cartPath','customerPrefecture','bankPaymentLabel','expectedTotal']
};
export function preparationError(check){
 if(!check||check.kind==='unconfigured')return '';
 const o=check.options??{};
 if(check.kind==='performance-navigation'&&!Object.values(o.budgets??{}).some(v=>typeof v==='number'&&v>0))return '「許容値」に、合格とする読込み時間などの上限を入力してください。';
 if(check.kind==='browser-flow'&&!o.steps?.some(s=>s.action?.startsWith('assert')||s.action==='waitForMail'))return '「操作手順」に「表示された文字を確認」「移動先のURLを確認」など、結果を確認する操作を追加してください。';
 if(check.kind==='operation-drill'&&(!o.before?.bodyIncludes||!o.after?.bodyIncludes))return '「実行前」「実行後」の「期待文字列」を入力してください。何が変わったら成功とするかを確認します。';
 if(check.kind==='wp-authz'&&!o.expectedRoles?.length)return '「期待ロール」に、検査する利用者が持つべき役割を入力してください。';
 return '';
}
export function preparationChoices(check,config,profile={}){
 const path=profile.sitePath||config.pages?.[0]?.path||'/';
 const restPath=(profile.adminPath||'/wp-admin/').replace(/wp-admin\/$/,'wp-json/wp/v2');
 const forms=config.checks?.flatMap(c=>c.kind==='discovered-public'?c.options?.forms??[]:[])??[];
 const form=forms.find(f=>f.formId===profile.contactFormId)||forms[0];
 const choice=(label,kind,options,note='')=>({label,kind,options,note});
 const browser=label=>choice(label,'browser-flow',{steps:[{action:'goto',url:path}]},'操作を追加し、最後に「表示された文字を確認」などの期待結果を入力してください。');
 const mail=()=>{
  if(!form?.submitSelector)return [browser('フォームへの入力・送信と受信を確認')];
  const steps=[{action:'goto',url:form.path}];
  for(const f of form.fields){
   const selector=form.formSelector+' [name="'+f.name.replaceAll('"','\\"')+'"]';
   if(['text','email','textarea'].includes(f.type)||f.required&&['tel','url','number','date'].includes(f.type))steps.push({action:'fill',selector,value:f.type==='email'?profile.testEmail??'':f.type==='textarea'?'動作確認 {{token}}':f.type==='text'?'動作確認 {{token}}':''});
   if(f.type==='checkbox'&&(f.required||f.name===profile.contactConsentField))steps.push({action:'check',selector});
  }
  steps.push({action:'click',selector:form.submitSelector},{action:'waitForMail',source:{url:''},expected:{to:'',textIncludes:'{{token}}',count:1}});
  return [choice('問い合わせを送り、同じテストのメール到着を確認','browser-flow',{steps},'フォームと入力欄をサイトから取得しました。空欄のテスト入力値・受信サービスのURL・宛先を入力してください。実際に送信するため、検証環境での変更許可が必要です。識別用文字列はそのまま残してください。')];
 };
 const id=check.id.replace(/^coverage-/,'');
 if(['notification','autoreply'].includes(id))return mail();
 if(id==='performance')return [choice('ページの読込み時間を確認','performance-navigation',{path,samples:3,cache:'cold',budgets:{}},'許容する時間は担当者が決めて入力します。現在の測定値を合格基準にはしません。')];
 if(id==='update'||id==='restore')return [choice(id==='restore'?'バックアップからの復元を確認':'更新後の動作を確認','operation-drill',{adapter:'',operation:id==='restore'?'restore':'update',before:{url:path,status:200},after:{url:path,status:200}},'実行担当者から、登録済みの処理名を受け取ってください。復元は隔離された検証環境で行います。')];
 if(id==='roles')return [choice('別の利用者の閲覧・編集権限を確認','wp-authz',{restPath,storageStateEnv:'WPQA_UI_ADMIN_STATE',role:'',expectedRoles:[],readStatus:403,readCode:'rest_cannot_read',updateStatus:403,updateCode:'rest_cannot_edit'},'検査する利用者のログインを「認証情報」で登録してください。閲覧・編集を拒否する例を表示しています。業務上の権限に合わせて確認してください。')];
 if(id==='crawl')return [choice('サイトマップの掲載ページを確認','seo-sitemap',{path:'',requiredUrls:[],excludedUrls:[]},'取得できなかったサイトマップURLと掲載すべきURLを指定します。robotsや転送は別の検査として追加してください。'),choice('検索エンジン向けの巡回ルールを確認','seo-robots',{path:'/robots.txt',rules:[]}),choice('古いページからの転送を確認','redirect',{path:'',status:301,location:''})];
 if(id==='analytics')return [browser('同意操作と計測サービスへの送信を確認')];
 if(id==='order-notification')return [browser('注文操作と同じ注文の通知メールを確認')];
 if(check.suite==='compatibility')return [choice('別のブラウザーで表示を確認','compatibility-screen',{path,engine:'firefox',viewport:{width:1280,height:800},visible:[]})];
 if(check.suite==='accessibility')return [choice('キーボードの移動順を確認','keyboard-sequence',{path,steps:[]})];
 return [browser(check.suite==='membership'?'会員画面の操作と結果を確認':'画面の操作と結果を確認')];
}

export function showPreparationWizard({row,config,profile,profileFields,onProfileChange}){
 const key=row.querySelector('[data-c=id]').value;
 const check=config.checks.find(c=>c.id===key);
 if(!check||check.kind!=='unconfigured')return;
 const wizard=document.createElement('section');wizard.className='preparation-wizard';
 const title=document.createElement('h3');title.textContent=check.title+'：かんたん設定';wizard.append(title);
 const note=document.createElement('p');note.textContent='取得できたURL・入力欄は補っています。宛先・期待する結果・操作の許可は確認して入力してください。保存後も、実行して結果を確認するまでは合格になりません。';wizard.append(note);
 const controls=[...row.children];for(const child of controls)child.hidden=true;
 row._simplePreparation=true;
 row._preparationTargets=[];
 const seenTargets=new Set();for(const c of config.checks??[])for(const form of c.kind==='discovered-public'?c.options?.forms??[]:[]){
  const add=(value,label)=>{if(value&&!seenTargets.has(value)){seenTargets.add(value);row._preparationTargets.push({value,label});}};
  for(const field of form.fields){const label={email:'メールアドレス欄',textarea:'お問い合わせ本文欄',text:'名前などの文字入力欄',tel:'電話番号欄',checkbox:'同意などのチェック欄'}[field.type]??'入力欄';add(form.formSelector+' [name="'+field.name.replaceAll('"','\\"')+'"]',form.path+'：'+label+'（'+field.name+'）');}
  add(form.submitSelector,form.path+'：送信ボタン');add(form.responseSelector,form.path+'：送信結果の案内');
 }
 row.prepend(wizard);
 const keys=profilePreparation[key];
 if(keys&&profile){
  for(const fieldKey of keys){const original=profileFields(fieldKey);if(!original)continue;
   const label=document.createElement('label');label.textContent=original.closest('label')?.childNodes[0]?.textContent||({writes:'検証環境でテストデータの作成・変更・削除を許可',submit:'テストの問い合わせ送信を許可',bankOrder:'テスト注文の確定・取消を許可'}[fieldKey]??fieldKey);
   if(!label.textContent.trim())label.textContent=original.closest('label').textContent;
   const input=original.cloneNode(true);input.removeAttribute('id');input.removeAttribute('data-key');input.disabled=original.disabled;input.value=original.value;input.checked=original.checked;
   input.oninput=()=>{if(original.type==='checkbox')original.checked=input.checked;else original.value=input.value;original.dispatchEvent(new Event('input',{bubbles:true}));original.dispatchEvent(new Event('change',{bubbles:true}));onProfileChange();};
   label.append(input);wizard.append(label);
  }
  const info=document.createElement('p');info.textContent='上の許可・条件を保存すると、対応する標準検査を準備します。問い合わせページとフォーム情報は自動取得したものを使います。';wizard.append(info);
 }else{
  const choices=preparationChoices(check,config,profile),purpose=document.createElement('select'),label=document.createElement('label');label.textContent='確認したいこと';
  choices.forEach((c,i)=>purpose.add(new Option(c.label,String(i))));label.append(purpose);wizard.append(label);
  const explanation=document.createElement('p');wizard.append(explanation);
  const setup=()=>{const c=choices[Number(purpose.value)];row.querySelector('[data-c=kind]').value=c.kind;row.querySelector('[data-c=options]').value=JSON.stringify(c.options,null,2);row.querySelector('[data-c=options]').dispatchEvent(new Event('input',{bubbles:true}));explanation.textContent=c.note;row.querySelector('.options-form').hidden=false;};
  purpose.onchange=setup;setup();
  // Native validation stays beside the Japanese fields; no JSON knowledge needed.
  const required={path:'確認するページを入力してください',adapter:'実行担当者から案内された処理名を入力してください',role:'検査する利用者の役割を入力してください'};
  for(const input of row.querySelectorAll('[data-option]')){
   const key=input.dataset.option;
   if(required[key]||/source.url$|expected.to$/.test(key))input.required=true;
   if(/durationMs$|samples$|expected.count$/.test(key)){input.min='1';}
  }
 }
 const advanced=document.createElement('button');advanced.type='button';advanced.textContent='担当者向けの詳細設定を表示';advanced.onclick=()=>{for(const child of controls)child.hidden=false;};wizard.append(advanced);
 return wizard;
}
