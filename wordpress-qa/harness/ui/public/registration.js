import {createAutomationEditor} from './automation-inputs.js';
import {createInteractionEditor,validateInteractionPermissions,preparationSummary,renderPreparationSummary} from './interaction-profile.js';
import {generateCases} from './case-generator.js';

export function registrationTarget(value,loginPath='/wp-login.php',adminPath='/wp-admin/'){
 let url;try{url=new URL(value);}catch{throw Error('サイトURLを https:// から入力してください');}
 if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol))throw Error('サイトURLには認証情報・クエリ・フラグメントを含めないでください');
 const sitePath=url.pathname.replace(/\/+$/,'')+'/';
 return {baseURL:url.origin,sitePath,loginPath:loginPath==='/wp-login.php'?sitePath+'wp-login.php':loginPath,adminPath:adminPath==='/wp-admin/'?sitePath+'wp-admin/':adminPath};
}
export function initRegistration({api,onSaved}){
 const trigger=document.querySelector('#new-site'),advanced=trigger.onclick;
 const dialog=document.createElement('dialog');dialog.className='settings-dialog';dialog.id='registration-dialog';
 dialog.innerHTML=`<form id="registration-form"><header><h2>サイトを登録して検査を準備</h2></header><div class="editor-body"><p>管理画面にログインし、期待する状態を登録します。公開URLと標準検査を自動生成し、次回から「検査を実行」で再検査・報告書生成まで進めます。</p><section><h3>1. サイトと認証</h3><div class="editor-grid"><label>サイト名<input name="name" required></label><label>サイトURL<input name="baseURL" type="url" required placeholder="https://example.jp"></label><label>環境<select name="environment"><option value="staging">検証環境</option><option value="production">本番環境</option><option value="local">ローカル</option></select></label><label>ログインパス<input name="loginPath" value="/wp-login.php" required></label><label>管理画面パス<input name="adminPath" value="/wp-admin/" required></label><label>サイト閲覧パスワード（閲覧保護がある場合）<input name="publicPassword" type="password" autocomplete="new-password"></label></div><button type="button" id="registration-login">管理画面にログイン</button><p id="registration-login-state" role="status">未ログイン。画像認証は専用ブラウザーで操作してください。</p></section><section><h3>2. 期待値と機能</h3><div class="editor-grid"><label>タイムゾーン<input name="timezone" value="Asia/Tokyo" required></label><label>言語<input name="language" value="ja" required></label><label>記事URL構造（任意）<input name="permalink" placeholder="/archives/%post_id%"></label><label>CF7フォームID（利用時）<input name="contactFormId" type="number" min="1" placeholder="自動取得（複数フォーム時のみ指定）"></label><label>問い合わせページ<input name="contactPath" placeholder="自動取得（複数フォーム時のみ指定）"></label><label>テスト用メールアドレス<input name="testEmail" type="email"></label><label>名前のフォーム項目名<input name="contactNameField" placeholder="自動取得（複数フォーム時のみ指定）"></label><label>メールのフォーム項目名<input name="contactEmailField" placeholder="自動取得（複数フォーム時のみ指定）"></label><label>本文のフォーム項目名<input name="contactMessageField" placeholder="自動取得（複数フォーム時のみ指定）"></label><label>同意のフォーム項目名（任意）<input name="contactConsentField" placeholder="自動取得（複数フォーム時のみ指定）"></label><label>URL取得上限<input name="maxPages" type="number" value="200" min="1" max="500"></label><label>トップページ読込の上限ms（合意済みの場合）<input name="performanceMs" type="number" min="1" max="120000"></label></div><label class="check-line"><input name="indexable" type="checkbox">検索エンジンへの公開を期待する</label><label class="check-line"><input name="writes" type="checkbox">検証環境でテスト投稿の作成・公開・予約公開・削除を実行する</label><label class="check-line"><input name="submitContact" type="checkbox">検証環境で、指定したCF7フォームをテスト送信する（通知先のテスト設定済み）</label><p id="registration-policy">本番環境ではテスト投稿を作成しません。</p></section><section><h3>3. 銀行振込注文（Welcart・検証環境）</h3><label class="check-line"><input name="bankOrder" type="checkbox">注文確定・取消を含める</label><div class="editor-grid"><label>テスト商品パス<input name="productPath" placeholder="/archives/123"></label><label>カートパス<input name="cartPath" value="/usces-cart"></label><label>配送先都道府県<input name="customerPrefecture" value="長野県"></label><label>銀行振込の表示名<input name="bankPaymentLabel" value="銀行振込"></label><label>送料込みの期待合計（円）<input name="expectedTotal" type="number" min="1"></label></div><p>上のテストメールを購入者連絡先として使用します。金額・決済方法・取消手順を確認できない場合は注文を確定しません。</p></section><section><h3>登録時に確認する範囲</h3><p>標準対応：公開URL、管理設定、表示・画像比較・アクセシビリティ、CMS一覧、CF7設定、テスト投稿・予約公開。初回の画像基準と、内容・運用方針は確認待ちとして残します。</p><p>問い合わせ送信は上で指定したCF7フォームが対象です。銀行振込注文は対応するWelcart画面と取消操作を確認できる場合に実行します。受信箱への到着・別ロールの権限・バックアップ復元は「自動取得と追加条件」で連携条件を登録できます。実行に必要な条件や認証が揃わない項目は未確認として報告します。</p><button type="button" id="registration-advanced">詳細な検査設定を開く</button></section><p id="registration-error" role="alert"></p><p id="registration-status" role="status"></p></div><footer><button type="button" id="registration-cancel">キャンセル</button><button type="submit" id="registration-save">ログインを確認して登録・検査を準備</button></footer></form>`;
 document.body.append(dialog);const form=dialog.querySelector('form'),q=s=>dialog.querySelector(s),field=n=>form.elements.namedItem(n);let loginId=null,busy=false;
 const interactionSection=document.createElement('section');q('#registration-error').before(interactionSection);const interactions=createInteractionEditor(interactionSection);
 const automationSection=document.createElement('section');automationSection.id='registration-automation';interactionSection.before(automationSection);const automation=createAutomationEditor(automationSection);
 const roleSection=document.createElement('section');roleSection.id='registration-role';automationSection.after(roleSection);
 roleSection.innerHTML='<h3>追加のロール認証（任意・1件）</h3><p>権限・会員検査で使うロールを登録できます。ロール名を追加条件の options.role と合わせてください。REST認証は wp-authz、セッションファイルは browser-flow の roleEnv で参照します（subscriber の例：WPQA_ROLE_SUBSCRIBER_STATE）。認証情報はプロフィールに含めず、暗号化して保存します。追加のロールは登録後の設定画面で登録できます。</p><div class="editor-grid"><label>ロール名<input name="roleName" placeholder="subscriber" autocomplete="off"></label><label>RESTユーザー名<input name="roleUser" autocomplete="off"></label><label>アプリケーションパスワード<input name="rolePassword" type="password" autocomplete="new-password"></label><label>このロールのブラウザーセッションJSON<input name="roleState" type="file" accept=".json,application/json"></label></div><p>RESTのユーザー名とパスワード、または対象サイトにログイン済みのセッションファイルを指定してください。両方も指定できます。パスワードとファイル内容は下書きに保存しません。再読み込み後は再入力・再選択してください。</p>';
 async function readRoleCredentials(){
  const name=field('roleName').value.trim(),username=field('roleUser').value.trim(),password=field('rolePassword').value,file=field('roleState').files[0];
  if(!name&&!username&&!password&&!file)return [];
  const role={name};if(username||password)role.rest={username,password};
  if(file){
   try{if(file.size>800000)throw Error();role.browser=JSON.parse(await file.text());if(!role.browser||!Array.isArray(role.browser.cookies)||!Array.isArray(role.browser.origins))throw Error();}
   catch{markField('roleState','cookies と origins を含む800KB以下のセッションJSONを指定してください。');throw Error('ロールのセッションファイルを確認してください。');}
  }
  return [role];
 }
 const preparation=document.createElement('section');preparation.id='registration-preparation';preparation.setAttribute('aria-live','polite');interactionSection.after(preparation);
 function preview(){
  try{
   const profile={interactions:interactions.read()};
   for(const n of ['contactFormId','contactPath','testEmail','productPath','cartPath','customerPrefecture','bankPaymentLabel','expectedTotal'])profile[n]=field(n).value.trim();
   profile.writes=field('writes').checked;profile.submit=field('submitContact').checked;profile.bankOrder=field('bankOrder').checked;
   let sitePath='/';try{sitePath=registrationTarget(field('baseURL').value).sitePath;}catch{}
   profile.sitePath=sitePath;
   const config=generateCases({baseURL:field('baseURL').value,environment:field('environment').value,pages:[{id:'home',path:sitePath}]});
   renderPreparationSummary(preparation,preparationSummary(config,profile));
   const note=document.createElement('p');note.textContent='公開ページの件数・検査範囲は登録時のURL取得後に確定します。表示・画像比較・アクセシビリティも生成され、初回画像基準と内容の妥当性は確認が必要です。必要な機能だけ選択し、不足する共通操作の条件は上の各設定欄で入力できます。';preparation.append(note);
  }catch(e){preparation.textContent='実行準備を更新できません：'+e.message;}
 }
 form.addEventListener('input',preview);form.addEventListener('change',preview);
 form.noValidate=true;
 const draftKey='wpqa.registration.draft.v1';let loginTargetKey=null;
 const identity=()=>JSON.stringify({...registrationTarget(field('baseURL').value,field('loginPath').value,field('adminPath').value),environment:field('environment').value});
 function saveDraft(open=dialog.open){
  const values={};for(const el of form.elements)if(el.name&&!['password','file'].includes(el.type))values[el.name]=el.type==='checkbox'?el.checked:el.value;
  try{sessionStorage.setItem(draftKey,JSON.stringify({values,open,loginId,loginTargetKey}));}catch{q('#registration-status').textContent='ブラウザーの保存領域が使えないため、再読み込み時に入力を復元できません。';}
 }
 function discardDraft(){try{sessionStorage.removeItem(draftKey);}catch{}}
 async function restoreLogin(){
  if(!loginId)return;
  const {login}=await api('/api/logins/current');
  if(!login||login.id!==loginId||login.projectId||login.role){loginId=null;loginTargetKey=null;q('#registration-login-state').textContent='ログインは終了または期限切れです。入力内容は復元しました。管理画面に再ログインしてください。';saveDraft();return;}
  if(identity()!==loginTargetKey){q('#registration-login-state').textContent='ログイン後にサイトの接続先が変更されています。再ログインしてください。';return;}
  q('#registration-login-state').textContent=login.phase==='verified'?'確認済みのログインを引き継ぎました。そのまま登録を再試行できます。':'ログイン状態を引き継ぎました。専用ブラウザーでログイン後、登録を続けてください。';
 }
 form.addEventListener('input',()=>saveDraft());form.addEventListener('change',()=>saveDraft());
 const pause=document.createElement('button');pause.type='button';pause.id='registration-pause';pause.textContent='閉じて後で続ける';form.querySelector('footer').prepend(pause);
 pause.onclick=()=>{if(!busy){saveDraft(false);dialog.close();}};
 q('#registration-cancel').textContent='入力を破棄して終了';
 const draftNotice=document.createElement('p');draftNotice.textContent='入力はこのタブに自動保存され、再読み込み後に復元できます。パスワード・セッションファイルは保存しません。ログインはサーバー稼働中の有効期限内で引き継ぎます。';form.querySelector('.editor-body').prepend(draftNotice);
 const summary=document.createElement('p');summary.id='registration-validation';summary.setAttribute('role','alert');summary.tabIndex=-1;form.querySelector('.editor-body').prepend(summary);
 function clearField(el){el.removeAttribute('aria-invalid');el.removeAttribute('aria-describedby');q('#registration-field-'+el.name)?.remove();}
 function markField(name,message){const el=field(name);if(!el)return;clearField(el);el.setAttribute('aria-invalid','true');const note=document.createElement('span');note.id='registration-field-'+name;note.className='registration-field-error';note.textContent=message;el.closest('label').append(note);el.setAttribute('aria-describedby',note.id);}
 function validateInputs(loginOnly=false){
  for(const el of form.elements)if(el.name)clearField(el);
  const errors=new Map(),add=(n,m)=>{if(!errors.has(n))errors.set(n,m);};
  const names=loginOnly?['baseURL','loginPath','adminPath']:Array.from(form.elements).filter(el=>el.name).map(el=>el.name);
  for(const n of names){const el=field(n);if(el.disabled)continue;if(el.required&&!el.value.trim())add(n,'必須項目です。入力してください。');else if(!el.validity.valid)add(n,el.validationMessage);}
  let target;try{target=registrationTarget(field('baseURL').value,field('loginPath').value,field('adminPath').value);}catch(e){add('baseURL',e.message);}
  if(target){
   const u=new URL(target.baseURL);if(u.protocol!=='https:'&&!(field('environment').value==='local'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))add('baseURL','HTTPSのサイトURLを入力してください。');
   for(const n of ['loginPath','adminPath']){try{const v=new URL(target[n],u);if(v.origin!==u.origin||v.username||v.password||v.hash||(n==='adminPath'&&(v.search||!/^\/(?:[a-zA-Z0-9_-]+\/)*wp-admin\/$/.test(v.pathname))))throw Error();}catch{add(n,'同じサイト内の正しいパスを入力してください。管理画面は /wp-admin/ で終わるパスです。');}}
  }
  if(!loginOnly){
   const roleName=field('roleName').value.trim(),roleUser=field('roleUser').value.trim(),rolePassword=field('rolePassword').value,roleFile=field('roleState').files[0];
   if(roleName||roleUser||rolePassword||roleFile){
    if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(roleName)||['constructor','prototype'].includes(roleName))add('roleName','小文字英数字とハイフンで有効なロール名を入力してください。');
    if(roleUser||rolePassword){if(!roleUser||roleUser.includes(':'))add('roleUser','コロンを含まないRESTユーザー名を入力してください。');if(!rolePassword.trim())add('rolePassword','アプリケーションパスワードを入力してください。');}
    if(!roleUser&&!rolePassword&&!roleFile)add('rolePassword','REST認証またはブラウザーセッションを指定してください。');
    if(roleFile?.size>800000)add('roleState','セッションファイルは800KB以下にしてください。');
   }
   try{automation.read();}catch(e){add('automation-additionalChecks',e.message);}
   try{validateInteractionPermissions(interactions.read(),field('environment').value,field('writes').checked);}catch(e){add('interaction-sitePath',e.message);}
   try{new Intl.DateTimeFormat('ja',{timeZone:field('timezone').value});}catch{add('timezone','有効なタイムゾーンを入力してください（例：Asia/Tokyo）。');}
   const contact=field('submitContact').checked&&!field('submitContact').disabled,bank=field('bankOrder').checked&&!field('bankOrder').disabled;
   const required=[...(contact?['testEmail']:[]),...(bank?['testEmail','productPath','cartPath','customerPrefecture','bankPaymentLabel','expectedTotal']:[])];
   for(const n of required)if(!field(n).value.trim())add(n,'選択した操作テストに必要です。入力してください。');
   if((contact||bank)&&!field('writes').checked)add('writes','送信・注文検査には検証環境の操作許可が必要です。');
   for(const n of ['contactFormId','maxPages','performanceMs','expectedTotal'])if(field(n).value&&!Number.isInteger(Number(field(n).value)))add(n,'整数を入力してください。');
   for(const n of [...(contact?['contactPath']:[]),...(bank?['productPath','cartPath']:[])])if(field(n).value&&!/^\/(?!\/)[^?#]*$/.test(field(n).value))add(n,'/ から始まるサイト内のパスを入力してください。');
   if(contact)for(const n of ['contactNameField','contactEmailField','contactMessageField','contactConsentField'])if(field(n).value&&!/^[a-zA-Z][\w-]{0,99}$/.test(field(n).value))add(n,'半角英字で始まるフォーム項目名を入力してください。');
  }
  for(const [n,m] of errors)markField(n,m);
  summary.textContent=errors.size?`入力内容を確認してください。赤く表示した${errors.size}項目に不足・不正があります。`:'';
  if(errors.size){const el=field(errors.keys().next().value);el.focus();el.scrollIntoView({block:'center'});return false;}return true;
 }
 form.addEventListener('input',e=>{if(e.target.name)clearField(e.target);});
 function registrationFailure(error){
  const message=error.message;q('#registration-error').textContent=message;q('#registration-status').textContent='登録は完了していません：'+message;summary.textContent='登録できませんでした：'+message;
  if(/閲覧パスワード/.test(message)){markField('publicPassword',message);field('publicPassword').focus();field('publicPassword').scrollIntoView({block:'center'});}
  else {summary.focus();summary.scrollIntoView({block:'center'});}
 }
 function controls(){for(const e of form.querySelectorAll('button'))e.disabled=busy;for(const name of ['writes','submitContact','bankOrder'])field(name).disabled=busy||field('environment').value==='production';}
 function policy(){if(field('environment').value==='production'){field('writes').checked=false;field('submitContact').checked=false;field('bankOrder').checked=false;}controls();preview();}
 async function cancel(){if(loginId)await api(`/api/logins/${loginId}/cancel`,{method:'POST',body:'{}'});loginId=null;loginTargetKey=null;discardDraft();form.reset();policy();dialog.close();}
 trigger.onclick=()=>{q('#registration-error').textContent='';q('#registration-status').textContent='';dialog.showModal();saveDraft();void restoreLogin().catch(registrationFailure);};
 field('environment').onchange=policy;
 q('#registration-cancel').onclick=()=>{if(!busy)cancel().catch(e=>q('#registration-error').textContent=e.message);};dialog.oncancel=e=>{e.preventDefault();if(!busy)cancel().catch(e=>q('#registration-error').textContent=e.message);};
 q('#registration-advanced').onclick=async()=>{await cancel();advanced();};
 q('#registration-login').onclick=async()=>{if(busy)return;if(!validateInputs(true))return;busy=true;controls();q('#registration-error').textContent='';q('#registration-login-state').textContent='専用ブラウザーを起動中です。別ウィンドウで開きます…';try{const target=registrationTarget(field('baseURL').value,field('loginPath').value,field('adminPath').value);if(loginId)await api(`/api/logins/${loginId}/cancel`,{method:'POST',body:'{}'});loginId=null;const r=await api('/api/logins',{method:'POST',body:JSON.stringify({baseURL:target.baseURL,environment:field('environment').value,loginPath:target.loginPath,adminPath:target.adminPath})});loginId=r.id;loginTargetKey=identity();saveDraft();q('#registration-login-state').textContent='専用ブラウザー「Google Chrome for Testing」を別ウィンドウで開きました。見当たらない場合はタスクバーを確認してください。ログイン後、この画面の登録ボタンを押してください。';}catch(e){q('#registration-error').textContent=e.message;q('#registration-login-state').textContent='起動できませんでした：'+e.message;}finally{busy=false;controls();}};
 form.onsubmit=async e=>{e.preventDefault();if(busy)return;if(!validateInputs()){q('#registration-status').textContent='登録は完了していません。赤い項目を修正してください。';return;}busy=true;controls();q('#registration-error').textContent='';try{
 const roleCredentials=await readRoleCredentials();
 await restoreLogin();if(!loginId)throw Error('管理画面にログインしてください。');if(identity()!==loginTargetKey)throw Error('接続先が変更されています。管理画面に再ログインしてください。');q('#registration-status').textContent='認証確認・公開URL取得・検査ケース生成中…';await api(`/api/logins/${loginId}/verify`,{method:'POST',body:'{}'});
 const target=registrationTarget(field('baseURL').value,field('loginPath').value,field('adminPath').value);const profile={sitePath:target.sitePath,timezone:field('timezone').value,language:field('language').value,indexable:field('indexable').checked,writes:field('writes').checked,adminPath:target.adminPath,maxPages:Number(field('maxPages').value)};
 profile.interactions=interactions.read();profile.automation=automation.read();
 for(const n of ['contactFormId','performanceMs'])if(field(n).value)profile[n]=Number(field(n).value);if(field('permalink').value)profile.permalink=field('permalink').value;
 for(const n of ['contactPath','contactNameField','contactEmailField','contactMessageField','contactConsentField'])if(field(n).value)profile[n]=field(n).value;
 if(field('submitContact').checked){profile.submit=true;for(const n of ['contactPath','testEmail'])if(field(n).value)profile[n]=field(n).value;}
 if(field('bankOrder').checked){profile.bankOrder=true;profile.testEmail=field('testEmail').value;for(const n of ['productPath','cartPath','customerPrefecture','bankPaymentLabel'])profile[n]=field(n).value;profile.expectedTotal=Number(field('expectedTotal').value);}
 const r=await api('/api/registration',{method:'POST',body:JSON.stringify({name:field('name').value,baseURL:target.baseURL,environment:field('environment').value,loginId,profile,...(roleCredentials.length?{roleCredentials}:{}),publicPassword:field('publicPassword').value})});loginId=null;loginTargetKey=null;discardDraft();field('publicPassword').value='';field('rolePassword').value='';field('roleState').value='';dialog.close();await onSaved(r.id);
 }catch(error){saveDraft();registrationFailure(error);}finally{busy=false;controls();}};
 try{
  const saved=JSON.parse(sessionStorage.getItem(draftKey)||'null');
  if(saved?.values&&typeof saved.values==='object'){
   for(const el of form.elements)if(el.name&&!['password','file'].includes(el.type)&&Object.hasOwn(saved.values,el.name)){const value=saved.values[el.name];if(el.type==='checkbox'&&typeof value==='boolean')el.checked=value;else if(el.type!=='checkbox'&&typeof value==='string')el.value=value;}
   loginId=typeof saved.loginId==='string'?saved.loginId:null;loginTargetKey=typeof saved.loginTargetKey==='string'?saved.loginTargetKey:null;policy();
   if(saved.open)dialog.showModal();q('#registration-status').textContent='入力内容を復元しました。閲覧パスワードが必要な場合は再入力してください。';
   busy=true;controls();void restoreLogin().catch(registrationFailure).finally(()=>{busy=false;controls();});
  }
 }catch{discardDraft();}
 preview();
}





