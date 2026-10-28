import {createAutomationEditor} from './automation-inputs.js';
import {showPreparationWizard,preparationError} from './preparation-wizard.js';
import {generateCases,linkRegistrationCoverage} from './case-generator.js';
import {initCoverage} from './coverage-editor.js';
import {createInteractionEditor,generateInteractionChecks,validateInteractionPermissions,preparationSummary,renderPreparationSummary} from './interaction-profile.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const input=(key,label,value='',type='text')=>`<label>${label}<input data-key="${key}" type="${type}" value="${esc(value)}"></label>`;
const check=(key,label,value=true)=>`<label class="check-line"><input data-key="${key}" type="checkbox" ${value?'checked':''}>${label}</label>`;
const select=(key,label,values,value)=>`<label>${label}<select data-key="${key}">${values.map(([id,title])=>`<option value="${id}" ${id===value?'selected':''}>${title}</option>`).join('')}</select></label>`;
export function initSettings({api,currentProject,onSaved,shared=false}) {
  let rediscoveryDirty=false,rediscovering=false;
  let editing=null,version=null,original={},operationProfile=null,initialInteractions={},editable=true,saving=false,loginId=null,loginReady=false,loginBusy=false,loginOwned=true;
  const dialog=document.createElement('dialog');dialog.className='settings-dialog';
  dialog.innerHTML=`<form id="site-editor"><header><span class="alert-emblem" aria-hidden="true">⚠</span><div><span class="classified-label">RESTRICTED ACCESS // CONFIGURATION</span><h2 id="editor-heading">サイトを登録</h2><p>検査対象と期待する状態を登録します。</p></div><button type="button" id="editor-close" aria-label="設定画面を閉じる">×</button></header>
    <div class="editor-body"><p id="editor-mode" class="editor-note"></p><label class="check-line"><input id="refresh-automation" type="checkbox">保存時に共通自動検査を追加・更新（独自設定は維持）</label><div id="editor-error" class="notice error" role="alert" hidden></div>
    <section><h3>サイト情報</h3><div class="editor-grid" id="site-fields">${input('name','サイト名')}${input('baseURL','サイトURL（例：https://example.jp）','','url')}${select('environment','環境',[['staging','検証環境'],['production','本番環境'],['local','ローカル']], 'staging')}</div></section>
    <section><div class="editor-section-title"><h3>公開ページの検査</h3><button type="button" id="add-page">ページを追加</button></div><p>検索エンジンへの公開可否、正規URLなどの期待値を登録します。</p><div id="page-editors"></div></section>
    <section><div class="editor-section-title"><h3>管理設定の検査</h3><button type="button" id="add-admin">項目を追加</button></div><p>値の種類も一致させて判定します。チェック状態は「真偽値」を選び、true または false を入力してください。</p><div id="admin-editors"></div></section>
    <section id="credentials-section"><h3>認証情報</h3><p>このWindowsユーザーで復号できる形式で保存します。未入力なら保存済みの情報を維持します。実サイトはHTTPSを使用してください。</p>
      <h4>REST APIの認証</h4><p id="rest-state"></p><div class="editor-grid"><label>WordPressユーザー名<input id="auth-user" autocomplete="off"></label><label>アプリケーションパスワード<input id="auth-password" type="password" autocomplete="new-password"></label></div><label class="check-line"><input id="clear-rest" type="checkbox">保存済みREST認証を削除</label>
      <h4>管理画面へのログイン</h4><p id="browser-state"></p><p>${shared?'共有版では担当者が用意した対象サイト専用のPlaywrightセッションJSONを取り込みます。セッションにはログイン権限が含まれるため、報告書やチャットには添付しないでください。':'専用ブラウザーでWordPressにログインしてください。二段階認証もその画面で操作できます。確認後、この設定画面の「保存」で認証を登録します。'}</p><div class="editor-grid"><label>ログインページのパス<input id="login-path" value="/wp-login.php"></label><label>管理画面のパス<input id="admin-path" value="/wp-admin/"></label></div><div class="login-actions"><button type="button" id="login-start">WordPressにログイン</button><button type="button" id="login-verify" hidden>ログインを確認</button><button type="button" id="login-cancel" hidden>ログインをキャンセル</button></div><p id="login-status" role="status"></p><details><summary>セッションファイルから取り込む（任意）</summary><label>セッションファイル<input id="auth-state" type="file" accept=".json,application/json"></label></details><label class="check-line"><input id="clear-browser" type="checkbox">保存済みセッションを削除</label>
    </section>
    <section><details><summary>その他の検査（詳細設定）</summary><p>既存ハーネスの形式でJSON配列を編集できます。操作テストのコード登録は外部設定ファイルで管理します。</p><label>URL応答・公開方針（policies）<textarea id="edit-policies" rows="5" spellcheck="false"></textarea></label><label>表示・アクセシビリティ（visuals）<textarea id="edit-visuals" rows="5" spellcheck="false"></textarea></label><label>手動確認（manual）<textarea id="edit-manual" rows="5" spellcheck="false"></textarea></label></details></section>
    </div><footer><button type="button" id="editor-cancel">キャンセル</button><button type="button" id="editor-copy" hidden>新規サイトとして複製</button><button class="primary" type="submit" id="editor-save">保存</button></footer></form>`;
  document.body.append(dialog);
  const $=s=>dialog.querySelector(s),fields=$('#site-fields');
  const profileFields=[
    ['sitePath','公開サイトの起点パス','/'],
    ['timezone','期待するタイムゾーン（例：Asia/Tokyo）'],
    ['language','期待する言語（例：ja）'],
    ['adminPath','管理画面のパス','/wp-admin/'],
    ['contactFormId','CF7フォームID（空欄で設定を解除）','','number'],
    ['contactPath','問い合わせページのパス','/contact'],
    ['testEmail','テスト用メールアドレス','','email'],
    ['contactNameField','名前のフォーム項目名','contact-name'],
    ['contactEmailField','メールのフォーム項目名','contact-email'],
    ['contactMessageField','本文のフォーム項目名','contact-message'],
    ['contactConsentField','同意のフォーム項目名（任意）','contact-accept'],
    ['productPath','テスト商品のパス'],['cartPath','カートのパス','/usces-cart'],
    ['customerPrefecture','配送先の都道府県','長野県'],
    ['bankPaymentLabel','銀行振込の表示名','銀行振込'],
    ['expectedTotal','送料込みの期待合計（円）','','number']
  ];
  const profileSection=document.createElement('section');profileSection.id='operation-profile-section';profileSection.hidden=true;
  profileSection.innerHTML=`<details><summary>登録済みの操作テスト・閲覧パスワード</summary><p>操作の許可と対象を変更できます。管理設定や公開ページの期待値は、それぞれの検査欄で編集してください。</p><fieldset id="operation-profile-fields"><legend>操作テストの条件</legend>${check('writes','検証環境でテストデータの作成・変更・削除を許可する',false)}${check('submit','指定したCF7フォームをテスト送信する（通知先のテスト設定済み）',false)}${check('bankOrder','銀行振込注文の確定・取消を検査する',false)}<p id="operation-profile-policy" role="status"></p><div class="editor-grid">${profileFields.map(([key,label,value,type])=>input(key,label,value,type)).join('')}</div></fieldset><p>送信・注文検査には操作の許可が必要です。受信箱への到着は別の確認が必要です。</p><h4>サイト閲覧パスワード</h4><p>管理者ログインとは別の閲覧保護用です。未入力なら保存済みの値を維持し、値は再表示しません。</p><label>新しい閲覧パスワード<input id="profile-public-password" type="password" autocomplete="new-password"></label><label class="check-line"><input id="profile-clear-public-password" type="checkbox">保存済みの閲覧パスワードを削除する</label></details>`;
  $('#credentials-section').before(profileSection);
  const enableProfile=document.createElement('label');enableProfile.className='check-line';enableProfile.innerHTML='<input id="enable-operation-profile" type="checkbox">WordPressの標準操作テストを登録する（CMS照合・フォーム・投稿・予約公開・銀行振込）';profileSection.prepend(enableProfile);
  $('#operation-profile-fields').prepend(document.createRange().createContextualFragment(check('indexable','検索エンジンへの公開を期待する',false)));
  const interactionSection=document.createElement('section');interactionSection.id='interaction-profile-section';$('#credentials-section').before(interactionSection);const interactions=createInteractionEditor(interactionSection);
  const automationSection=document.createElement('section');automationSection.id='settings-automation';interactionSection.before(automationSection);const automation=createAutomationEditor(automationSection);
  const automationNote=document.createElement('p');automationNote.textContent='この条件を保存するには「WordPressの標準操作テストを登録する」を選択してください。';automationSection.append(automationNote);
  const rediscoverButton=document.createElement('button');rediscoverButton.type='button';rediscoverButton.id='rediscover-automation';rediscoverButton.textContent='保存済みの条件でサイトを再取得';
  const rediscoverStatus=document.createElement('p');rediscoverStatus.id='rediscover-status';rediscoverStatus.setAttribute('role','status');
  automationSection.append(rediscoverButton,rediscoverStatus);
  function rediscoveryControls(){
    rediscoverButton.hidden=!editing||!editable;
    rediscoverButton.disabled=rediscovering||saving||loginBusy||!!loginId||!operationProfile||rediscoveryDirty;
    if(!rediscovering)rediscoverStatus.textContent=rediscoveryDirty?'未保存の変更があります。保存して設定を開き直すと再取得できます。':'保存済みの管理者認証で公開ページ・管理画面を読み取り、検査条件を追加して保存します。同じIDの設定・基準値と操作許可は維持します。';
  }
  for(const event of ['input','change'])$('#site-editor').addEventListener(event,()=>{rediscoveryDirty=true;rediscoveryControls();});
  $('#site-editor').addEventListener('click',e=>{if(e.target.closest('#add-page,#add-admin,.remove-setting,[data-remove],[data-add-check],[data-add-plan],#add-role')){rediscoveryDirty=true;rediscoveryControls();}});
  rediscoverButton.onclick=async()=>{
    if(rediscoverButton.disabled||!editing||!editable)return;
    rediscovering=true;saving=true;error('');rediscoveryControls();
    const states=[...dialog.querySelectorAll('input,select,textarea,button')].map(el=>[el,el.disabled]);for(const [el] of states)el.disabled=true;
    rediscoverStatus.textContent='保存済み認証で読み取り中です。対象サイトへの送信・更新操作は実行しません。';
    let message;
    try{
      const result=await api(`/api/projects/${encodeURIComponent(editing)}/rediscover`,{method:'POST',body:JSON.stringify({version})});
      const data=await api(`/api/projects/${encodeURIComponent(editing)}/settings`);
      version=data.version;populate(data.config,data.credentials,data.profile);
      message=`再取得して保存しました。公開ページ ${result.pages}件。${(result.warnings??[]).join(' ')}`;
      await onSaved(result.id);
    }catch(e){error(e.message);message='再取得を完了できませんでした：'+e.message;}
    finally{for(const [el,disabled] of states)if(el.isConnected)el.disabled=disabled;rediscovering=false;saving=false;profilePolicy();loginControls();rediscoveryControls();rediscoverStatus.textContent=message;}
  };
  for(const event of ['input','change'])automationSection.addEventListener(event,()=>{$('#refresh-automation').checked=true;});
  interactionSection.addEventListener('change',()=>{$('#refresh-automation').checked=true;});
  interactionSection.addEventListener('input',()=>{$('#refresh-automation').checked=true;});
  for(const event of ['input','change','click'])$('#admin-editors').addEventListener(event,()=>{$('#refresh-automation').checked=true;});
  const profileField=key=>profileSection.querySelector(`[data-key="${key}"]`);
  function profilePolicy(){
    const production=fields.querySelector('[data-key=environment]').value==='production';
    const enabled=$('#enable-operation-profile').checked;
    automationNote.hidden=enabled;
    for(const el of automationSection.querySelectorAll('input,textarea'))el.disabled=!editable||!enabled;
    for(const el of profileSection.querySelectorAll('[data-key]'))el.disabled=!editable||!enabled;
    for(const key of ['writes','submit','bankOrder']){
      if(production)profileField(key).checked=false;
      profileField(key).disabled=!editable||!enabled||production;
    }
    if(production)setWritePermission(false);
    coverageSection.querySelector('[data-writes]').disabled=!editable||production;
    $('#operation-profile-policy').textContent=production?'本番環境では投稿作成・フォーム送信・注文確定を許可できません。これらの許可を解除して保存します。':'操作の許可は自動では戻りません。必要な検査を選択してください。';
    $('#profile-public-password').disabled=!editable||!enabled||$('#profile-clear-public-password').checked;
    $('#profile-clear-public-password').disabled=!editable||!enabled;
  }
  fields.querySelector('[data-key=environment]').addEventListener('change',profilePolicy);
  $('#profile-clear-public-password').onchange=()=>{if($('#profile-clear-public-password').checked)$('#profile-public-password').value='';profilePolicy();};
  profileField('adminPath').oninput=()=>{$('#admin-path').value=profileField('adminPath').value;};
  function readProfile(){
    if(!$('#enable-operation-profile').checked)return undefined;
    profilePolicy();
    const profile={...operationProfile};
    profile.indexable=profileField('indexable').checked;
    profile.interactions=interactions.read();
    if(!operationProfile||operationProfile.automation!==undefined||automation.changed())profile.automation=automation.read();
    for(const key of ['writes','submit','bankOrder'])profile[key]=profileField(key).checked;
    for(const [key,label,,type] of profileFields){
      const value=profileField(key).value.trim();
      if(!value){delete profile[key];continue;}
      if(type==='number'){
        if(!Number.isSafeInteger(Number(value))||Number(value)<1)throw new Error(label+'は正の整数で入力してください');
        profile[key]=Number(value);
      }else profile[key]=value;
    }
    if(!profile.adminPath)throw new Error('操作テストの管理画面パスを入力してください');
    if(!profile.timezone||!profile.language)throw new Error('標準操作テストのタイムゾーンと言語を入力してください');
    if(profile.contactFormId&&['name','email','message'].some(k=>!(profile.interactions.contact?.[k+'Field']||profile['contact'+k[0].toUpperCase()+k.slice(1)+'Field'])))throw new Error('CF7設定検査の名前・メール・本文の項目名を入力してください');
    try{new Intl.DateTimeFormat('ja',{timeZone:profile.timezone});}catch{throw new Error('タイムゾーンが不正です');}
    if((profile.submit||profile.bankOrder)&&!profile.writes)throw new Error('送信・注文検査にはテストデータの操作許可が必要です');
    validateInteractionPermissions(profile.interactions,fields.querySelector('[data-key=environment]').value,profile.writes);
    return profile;
  }
  const coverageSection=document.createElement('section');$('#credentials-section').before(coverageSection);const coverage=initCoverage(coverageSection);
  const preparation=document.createElement('section');preparation.id='settings-preparation';preparation.setAttribute('aria-live','polite');coverageSection.before(preparation);
  function preview(){
    try{
      const config={...original,...coverage.read(),environment:fields.querySelector('[data-key=environment]').value};
      let profile;
      if($('#enable-operation-profile').checked){
        profile={};for(const [key] of profileFields)profile[key]=profileField(key).value.trim();
        for(const key of ['writes','submit','bankOrder'])profile[key]=profileField(key).checked;
      }
      const refresh=$('#refresh-automation').checked;
      const stored=config.checks.filter(c=>c.kind==='site-interaction');
      const settings=refresh?interactions.read():{...(stored[0]?.options?.settings??{}),enabled:stored.map(c=>c.options?.operation)};
      renderPreparationSummary(preparation,preparationSummary(config,profile,settings));
      const note=document.createElement('p');note.textContent=refresh?'共通操作は現在の入力で更新する予定です。独自検査・ページ・管理設定の詳細は各設定欄で確認してください。':'共通自動検査の更新は選択されていません。保存済みの共通操作を表示しています。';preparation.append(note);
    }catch(e){preparation.textContent='実行準備を更新できません：'+e.message;}
  }
  for(const event of ['input','change','click'])$('#site-editor').addEventListener(event,preview);
  function setWritePermission(allowed){
    profileField('writes').checked=allowed;coverageSection.querySelector('[data-writes]').checked=allowed;
    if(!allowed){
      profileField('submit').checked=false;profileField('bankOrder').checked=false;
      for(const op of ['server-validation','cart-limit','customer-empty'])interactionSection.querySelector(`[data-interaction-operation="${op}"]`).checked=false;
    }
    $('#refresh-automation').checked=true;
  }
  profileField('writes').onchange=()=>setWritePermission(profileField('writes').checked);
  coverageSection.querySelector('[data-writes]').onchange=e=>setWritePermission(e.target.checked);
  $('#enable-operation-profile').onchange=()=>{profilePolicy();$('#refresh-automation').checked=true;};
  const rolesSection=document.createElement('div');rolesSection.innerHTML='<h4>ロール別の認証</h4><p>ロール名は検査options.roleと一致させます。値は再表示しません。</p><div id="role-editors"></div><button type="button" id="add-role">ロールを追加</button><label>ログインするロール<select id="login-role"><option value="">既定の管理者</option></select></label>';$('#credentials-section').append(rolesSection);
  let loginRole='';
  function refreshRoles(){const previous=$('#login-role').value;$('#login-role').replaceChildren(new Option('既定の管理者',''));for(const e of dialog.querySelectorAll('[data-role-name]'))if(e.value.trim())$('#login-role').add(new Option(e.value.trim(),e.value.trim()));$('#login-role').value=previous;}
  function roleRow(name='',status={}){const row=document.createElement('fieldset');row.className='role-row';row.innerHTML=`<legend>ロール認証</legend><label>ロール名<input data-role-name value="${esc(name)}" pattern="[a-z][a-z0-9_-]*" required></label><p>REST: ${status.rest?'登録済み':'未登録'} / ブラウザー: ${status.browser?'登録済み':'未登録'}</p><div class="editor-grid"><label>ユーザー名<input data-role-user autocomplete="off"></label><label>アプリケーションパスワード<input data-role-password type="password" autocomplete="new-password"></label></div><label class="check-line"><input type="checkbox" data-role-clear-rest>保存済みREST認証を削除</label><label class="check-line"><input type="checkbox" data-role-clear-browser>保存済みブラウザー認証を削除</label>`;row.querySelector('[data-role-name]').oninput=refreshRoles;$('#role-editors').append(row);refreshRoles();}
  $('#add-role').onclick=()=>roleRow();
  function loginControls(){
    $('#login-start').disabled=shared||loginBusy||!!loginId||!editable;
    if(shared){$('#login-start').hidden=true;$('#login-status').textContent='共有版ではREST認証またはセッションファイルを登録してください。専用ログインウィンドウはサーバーでは開きません。';}
    $('#login-verify').hidden=!loginId||loginReady||!loginOwned;$('#login-verify').disabled=loginBusy;
    $('#login-cancel').hidden=!loginId;$('#login-cancel').disabled=loginBusy;
    $('#editor-copy').disabled=!!loginId;
    $('#editor-save').disabled=loginBusy||(!!loginId&&!loginReady)||saving;
    $('#login-role').disabled=loginBusy||!!loginId||!editable;
  }
  async function cancelLogin(){
    if(loginId)await api('/api/logins/'+encodeURIComponent(loginId)+'/cancel',{method:'POST',body:'{}'});
    loginId=null;loginReady=false;loginOwned=true;$('#login-status').textContent='';loginControls();
  }
  function error(message){$('#editor-error').textContent=message;$('#editor-error').hidden=!message;}
  function row(kind,data={}) {
    const box=document.createElement('fieldset');box.className='setting-row';box.dataset.kind=kind;box._original=data;
    box.innerHTML=`<legend>${kind==='page'?'ページ':'管理設定'}</legend><button type="button" class="remove-setting" aria-label="項目を削除">削除</button><div class="editor-grid">`+
    (kind==='page'?input('id','ID',data.id)+input('path','ページパス',data.path??'/')+input('canonical','正規URL（canonical）',data.canonical)+input('title','ページタイトル（任意）',data.title)+check('indexable','検索エンジンへの公開を期待',data.indexable??true)+check('links','内部リンクを検査',data.links??true)+check('required','必須',data.required??true):
    input('id','ID',data.id)+input('title','項目名',data.title)+select('source','取得方法',[['rest','REST API'],['browser','管理画面']],data.source??'rest')+input('path','設定のURLパス',data.path??'/wp-json/wp/v2/settings')+
    `<div class="rest-fields">${input('field','JSONフィールド',data.field??'timezone')}</div><div class="browser-fields">${input('selector','設定項目のセレクター',data.selector)}${input('authenticatedSelector','ログイン済みの目印',data.authenticatedSelector??'#wpadminbar')}${select('read','読み取り方',[['value','入力値'],['checked','チェック状態'],['text','表示テキスト']],data.read??'value')}</div>`+
    select('expectedType','期待値の種類',[['string','文字列'],['number','数値'],['boolean','真偽値']],typeof(data.expected??'') )+input('expected','期待値',data.expected??'')+check('required','必須',data.required??true)+check('sensitive','結果の値を非表示にする',data.sensitive??false))+'</div>';
    box.querySelector('.remove-setting').onclick=()=>box.remove();
    if(kind==='admin'){
      const update=()=>{const rest=box.querySelector('[data-key=source]').value==='rest';box.querySelector('.rest-fields').hidden=!rest;box.querySelector('.browser-fields').hidden=rest;};
      box.querySelector('[data-key=source]').onchange=update;update();
    }
    $(kind==='page'?'#page-editors':'#admin-editors').append(box);
  }
  function populate(config,credentials={},profile=null) {
    rediscoveryDirty=false;original=config;loginId=null;loginRole='';loginReady=false;loginBusy=false;loginOwned=true;$('#login-status').textContent='';$('#login-path').value='/wp-login.php';$('#admin-path').value='/wp-admin/';
    coverage.populate(config);$('#role-editors').replaceChildren();for(const [name,status] of Object.entries(credentials.roles??{}))roleRow(name,status);refreshRoles();$('#login-role').value='';
    for(const e of fields.querySelectorAll('[data-key]'))e.value=config[e.dataset.key]??'';
    operationProfile=editable&&profile?{...profile}:null;
    automation.populate(operationProfile?.automation);
    const interactionChecks=config.checks?.filter(c=>c.kind==='site-interaction')??[];
    const fullScope=interactionChecks.find(c=>c.options?.operation==='all-links');
    const storedInteractions=fullScope?.options?.settings??interactionChecks[0]?.options?.settings;
    interactions.populate(operationProfile?.interactions??(storedInteractions?{...storedInteractions,...(!fullScope&&config.pages?.length?{paths:config.pages.map(p=>p.path)}:{})}:undefined));
    initialInteractions=interactions.read();
    profileSection.hidden=false;profileSection.querySelector('details').open=false;
    $('#enable-operation-profile').checked=!!operationProfile;
    for(const [key,,fallback] of profileFields)profileField(key).value=operationProfile?.[key]??(operationProfile?'':fallback??'');
    profileField('indexable').checked=operationProfile?.indexable===true;
    for(const key of ['writes','submit','bankOrder'])profileField(key).checked=operationProfile?.[key]===true;
    $('#profile-public-password').value='';$('#profile-clear-public-password').checked=false;
    if(operationProfile?.adminPath)$('#admin-path').value=operationProfile.adminPath;
    $('#page-editors').replaceChildren();$('#admin-editors').replaceChildren();
    (config.pages??[]).forEach(p=>row('page',p));(config.admin??[]).forEach(p=>row('admin',p));
    for(const k of ['policies','visuals','manual'])$('#edit-'+k).value=JSON.stringify(config[k]??[],null,2);
    $('#rest-state').textContent=credentials.rest?'登録済み（値は表示しません）':'未登録';$('#browser-state').textContent=credentials.browser?'登録済み（値は表示しません）':'未登録';
    $('#auth-user').value='';$('#auth-password').value='';$('#auth-state').value='';$('#clear-rest').checked=false;$('#clear-browser').checked=false;
    $('#editor-heading').textContent=editing?'サイト設定を編集':'サイトを登録';
    $('#editor-mode').textContent=editable?'新規登録時は基本観点のテストケースを自動生成します。追加条件が必要な観点は準備待ちで残り、すべてが自動実行されるわけではありません。保存前の実行準備を確認してください。':'このサイトは外部ファイルで管理されています。複製すると操作テスト・認証参照・メール連携を除いた新しい登録を作成します。';
    $('#editor-copy').hidden=editable;$('#editor-save').hidden=!editable;
    for(const e of dialog.querySelectorAll('.editor-body input,.editor-body select,.editor-body textarea,.editor-body button'))e.disabled=!editable;
    $('#enable-operation-profile').disabled=!editable||!!operationProfile;
    profilePolicy();loginControls();preview();
  }
  async function open(id,target){
    dialog.classList.remove('preparation-mode');dialog.dataset.preparationCheck=target?.checkId??'';
    error('');for(const note of dialog.querySelectorAll('.preparation-discovery-note'))note.remove();editing=id;version=null;editable=!id;
    try{
      const data=id?await api(`/api/projects/${encodeURIComponent(id)}/settings`):{config:{name:'',baseURL:'',environment:'staging',pages:[{id:'home',path:'/',canonical:'',indexable:false}],admin:[]},managed:true};
      let preparationNotice='';
      if(target?.checkId&&data.managed&&data.profile&&data.credentials?.browser){
        try{const preview=await api(`/api/projects/${encodeURIComponent(id)}/rediscover`,{method:'POST',body:JSON.stringify({version:data.version,preview:true})});data.config=preview.config;data.profile=preview.profile;preparationNotice='サイト・管理画面から情報を取得して入力しました。保存するまで設定は変更されません。'+(preview.warnings??[]).join(' ');}
        catch(e){preparationNotice='最新情報を取得できなかったため、保存済みの情報を使います。'+e.message;}
      }
      editable=data.managed;version=data.version;$('#refresh-automation').checked=!id;populate(id?data.config:generateCases(data.config),data.credentials,data.profile);
      const pending=(await api('/api/logins/current')).login;
      if(pending){
        loginId=pending.id;
        loginRole=pending.role??'';if(loginRole&&!Array.from($('#login-role').options).some(o=>o.value===loginRole))roleRow(loginRole);$('#login-role').value=loginRole;
        if(!editing&&!pending.projectId&&!fields.querySelector('[data-key=baseURL]').value){
          fields.querySelector('[data-key=baseURL]').value=pending.baseURL;
          fields.querySelector('[data-key=environment]').value=pending.environment??'staging';
          fields.querySelector('[data-key=baseURL]').dispatchEvent(new Event('change'));
        }
        loginOwned=pending.projectId===(editing??null)&&pending.baseURL===fields.querySelector('[data-key=baseURL]').value;
        loginReady=loginOwned&&pending.phase==='verified';
        $('#login-status').textContent=!loginOwned?'別のサイトのログインが進行中です。続ける場合はそのサイトの設定を開き、終了する場合はキャンセルしてください。':loginReady?'ログイン確認済み。「保存」で認証を登録できます。':'ログインが進行中です。専用ブラウザーで完了後に確認してください。';loginControls();
      }
      dialog.showModal();$('.editor-body').scrollTop=0;
      if(preparationNotice){const info=document.createElement('p');info.className='preparation-discovery-note';info.textContent=preparationNotice;$('#editor-mode').after(info);}
      if(target?.checkId){
        const row=[...dialog.querySelectorAll('.coverage-row')].find(r=>r.querySelector('[data-c=id]')?.value===target.checkId);
        if(row){
          const wizard=showPreparationWizard({row,config:data.config,profile:data.profile,profileFields:profileField,onProfileChange:()=>{$('#refresh-automation').checked=true;}});
          if(wizard){dialog.classList.add('preparation-mode');row.classList.add('settings-target');const all=document.createElement('button');all.type='button';all.textContent='認証情報や他の設定も表示';all.onclick=()=>dialog.classList.remove('preparation-mode');wizard.append(all);row.scrollIntoView({block:'start'});wizard.querySelector('input,select,button')?.focus({preventScroll:true});return;}
          row.classList.add('settings-target');
          const note=document.createElement('p');note.className='settings-target-note';note.textContent='準備待ちの対象項目です。「検査方法」を選択し、ひな形の対象・期待値をこのサイトに合わせて設定してください。';row.prepend(note);
          const guide=document.createElement('div');guide.className='settings-target-guide';
          for(const field of target.fields??[]){const p=document.createElement('p');const title=document.createElement('strong');title.textContent=field.label+'：';p.append(title,document.createTextNode(field.value));guide.append(p);}
          const hint=document.createElement('p');hint.textContent='「対象・期待値を入力」の日本語フォームからも入力できます。JSONのキー名は案内との対応用です。';guide.append(hint);note.after(guide);
          row.scrollIntoView({block:'start'});row.querySelector('[data-c=kind]').focus({preventScroll:true});
        }else error('取得した情報でこの項目の標準検査を準備できた可能性があります。実行準備の一覧を確認し、保存してください。過去の結果は再実行後に更新されます。');
      }
    }catch(e){alert(e.message);}
  }
  async function close(){if(saving||loginBusy)return;try{if(loginOwned)await cancelLogin();else{loginId=null;loginReady=false;}}catch(e){error(e.message);return;}dialog.close();$('#auth-password').value='';$('#auth-user').value='';$('#auth-state').value='';$('#profile-public-password').value='';$('#profile-clear-public-password').checked=false;for(const e of dialog.querySelectorAll('[data-role-password],[data-role-user]'))e.value='';}
  $('#login-start').onclick=async()=>{
    if(loginBusy||loginId)return;error('');loginBusy=true;loginControls();
    $('#login-status').textContent='専用ブラウザーを開いています…';
    try{
      loginRole=$('#login-role').value;
      const result=await api('/api/logins',{method:'POST',body:JSON.stringify({projectId:editing,baseURL:fields.querySelector('[data-key=baseURL]').value.trim(),environment:fields.querySelector('[data-key=environment]').value,loginPath:$('#login-path').value,adminPath:$('#admin-path').value,...(loginRole?{role:loginRole}:{})})});
      loginId=result.id;loginReady=false;loginOwned=true;$('#clear-browser').checked=false;$('#auth-state').value='';
      $('#login-status').textContent=result.baseURL+' の専用ブラウザーでログイン後、「ログインを確認」を押してください（10分以内）。';
    }catch(e){error(e.message);$('#login-status').textContent='ログインを開始できませんでした';}finally{loginBusy=false;loginControls();}
  };
  $('#login-verify').onclick=async()=>{
    if(!loginId||loginBusy)return;loginBusy=true;error('');loginControls();
    try{await api('/api/logins/'+encodeURIComponent(loginId)+'/verify',{method:'POST',body:'{}'});loginReady=true;$('#login-status').textContent='ログイン確認済み。「保存」でこのサイトに認証を登録します。';}
    catch(e){error(e.message);}finally{loginBusy=false;loginControls();}
  };
  $('#login-cancel').onclick=async()=>{if(loginBusy)return;loginBusy=true;try{await cancelLogin();}catch(e){error(e.message);}finally{loginBusy=false;loginControls();}};
  $('#editor-close').onclick=close;$('#editor-cancel').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  $('#editor-copy').onclick=()=>{editing=null;version=null;editable=true;populate({...original,name:original.name+'（コピー）',journeys:[],headersEnv:undefined,mailpit:undefined,admin:(original.admin??[]).map(({headersEnv,storageStateEnv,...a})=>a)});};
  $('#add-page').onclick=()=>row('page',{id:'page-'+($('#page-editors').children.length+1)});
  $('#add-admin').onclick=()=>row('admin',{id:'setting-'+($('#admin-editors').children.length+1)});
  fields.querySelector('[data-key=baseURL]').addEventListener('change',e=>{
    for(const box of $('#page-editors').children){const canonical=box.querySelector('[data-key=canonical]');if(!canonical.value)try{canonical.value=new URL(box.querySelector('[data-key=path]').value,e.target.value).href;}catch{}}
  });
  $('#site-editor').onsubmit=async e=>{
    e.preventDefault();if(!editable||saving||loginBusy||(loginId&&!loginReady))return;error('');saving=true;$('#editor-save').disabled=true;
    try{
      let config={...original};delete config.headersEnv;delete config.mailpit;
      Object.assign(config,coverage.read());
      if(dialog.dataset.preparationCheck){const message=preparationError(config.checks.find(c=>c.id===dialog.dataset.preparationCheck));if(message){const box=dialog.querySelector('.preparation-wizard');if(box){let notice=box.querySelector('[role=alert]');if(!notice){notice=document.createElement('p');notice.setAttribute('role','alert');notice.className='notice error';box.prepend(notice);}notice.textContent=message;notice.scrollIntoView({block:'center'});}throw new Error(message);}}
      for(const el of fields.querySelectorAll('[data-key]'))config[el.dataset.key]=el.value.trim();
      config.pages=[];config.admin=[];
      for(const box of dialog.querySelectorAll('.setting-row')){
        const data={...box._original};for(const el of box.querySelectorAll('[data-key]'))data[el.dataset.key]=el.type==='checkbox'?el.checked:el.value;
        if(box.dataset.kind==='page'){if(!data.title)delete data.title;config.pages.push(data);}
        else{
          if(data.expectedType==='number'){if(!data.expected.trim()||!Number.isFinite(Number(data.expected)))throw new Error('数値の期待値を入力してください');data.expected=Number(data.expected);}
          if(data.expectedType==='boolean'){if(!['true','false'].includes(data.expected))throw new Error('真偽値は true または false を入力してください');data.expected=data.expected==='true';}
          delete data.expectedType;delete data.headersEnv;delete data.storageStateEnv;if(!data.title)delete data.title;
          if(data.source==='rest'){delete data.selector;delete data.authenticatedSelector;delete data.read;}else delete data.field;
          config.admin.push(data);
        }
      }
      for(const key of ['policies','visuals','manual']){try{config[key]=JSON.parse($('#edit-'+key).value);}catch{throw new Error(key+'のJSON形式を確認してください');}}
      if(!editing) config=generateCases(config);
      const auth={clearRest:$('#clear-rest').checked,clearBrowser:$('#clear-browser').checked};
      const profile=readProfile();
      if(profile&&dialog.dataset.preparationCheck){const prepared=config.checks.find(c=>c.id===dialog.dataset.preparationCheck&&c.kind!=='unconfigured');if(prepared)profile.automation={...profile.automation,additionalChecks:[...(profile.automation?.additionalChecks??[]).filter(c=>c.id!==prepared.id),prepared]};}
      const interactionSettings=profile?.interactions??interactions.read();
      if(interactionSettings.admin){
        const shape=a=>a&&JSON.stringify(['id','title','path','selector','read','expected','source','field'].map(k=>a[k]));
        interactionSettings.admin=interactionSettings.admin.filter(entry=>{
          const old=(original.admin??[]).find(a=>a.id===entry.id),now=config.admin.find(a=>a.id===entry.id);
          if(!old||shape(old)===shape(now))return true;
          const initial=initialInteractions.admin?.find(a=>a.id===entry.id);
          if(JSON.stringify(entry)!==JSON.stringify(initial))throw new Error(entry.id+' は管理設定欄と追加JSONの両方で変更されています。片方の変更を戻して保存してください');
          // An explicit edit/removal in the ordinary admin editor supersedes its stale JSON override.
          return false;
        });
      }
      if($('#refresh-automation').checked){
        config=generateCases(config);
        const interactionProfile=profile??{interactions:interactionSettings,writes:config.allowTestWrites===true};
        if(profile)config.allowTestWrites=profile.writes;
        config=generateInteractionChecks(config,interactionProfile);
        if(profile)config=linkRegistrationCoverage(config,profile);
      }
      if(profile){
        if($('#profile-clear-public-password').checked)auth.publicPassword='';
        else if($('#profile-public-password').value)auth.publicPassword=$('#profile-public-password').value;
      }
      auth.roleCredentials=[...dialog.querySelectorAll('.role-row')].map(row=>{const name=row.querySelector('[data-role-name]').value.trim(),username=row.querySelector('[data-role-user]').value,password=row.querySelector('[data-role-password]').value;return {name,clearRest:row.querySelector('[data-role-clear-rest]').checked,clearBrowser:row.querySelector('[data-role-clear-browser]').checked,...(username||password?{rest:{username,password}}:{})};});
      if(loginId){auth.browserLoginId=loginId;if(loginRole)auth.browserLoginRole=loginRole;}
      if($('#auth-user').value||$('#auth-password').value)auth.rest={username:$('#auth-user').value,password:$('#auth-password').value};
      const file=$('#auth-state').files[0];if(file){if(file.size>800000)throw new Error('セッションファイルは800KB以下にしてください');try{auth.browser=JSON.parse(await file.text());}catch{throw new Error('セッションファイルのJSONを確認してください');}}
      saving=true;$('#editor-save').disabled=true;
      const result=await api(editing?`/api/projects/${encodeURIComponent(editing)}/settings`:'/api/projects',{method:'POST',body:JSON.stringify({version,config,auth,...(profile?{profile}:{})})});
      saving=false;loginId=null;loginReady=false;await close();await onSaved(result.id);
    }catch(e){error(e.message);}finally{saving=false;loginControls();}
  };
  document.querySelector('#new-site').onclick=()=>open(null);
  document.querySelector('#edit-site').onclick=()=>open(currentProject());
  return {open};
}




