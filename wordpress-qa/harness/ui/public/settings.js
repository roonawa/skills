import {initCoverage} from './coverage-editor.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const input=(key,label,value='',type='text')=>`<label>${label}<input data-key="${key}" type="${type}" value="${esc(value)}"></label>`;
const check=(key,label,value=true)=>`<label class="check-line"><input data-key="${key}" type="checkbox" ${value?'checked':''}>${label}</label>`;
const select=(key,label,values,value)=>`<label>${label}<select data-key="${key}">${values.map(([id,title])=>`<option value="${id}" ${id===value?'selected':''}>${title}</option>`).join('')}</select></label>`;
export function initSettings({api,currentProject,onSaved}) {
  let editing=null,version=null,original={},editable=true,saving=false,loginId=null,loginReady=false,loginBusy=false,loginOwned=true;
  const dialog=document.createElement('dialog');dialog.className='settings-dialog';
  dialog.innerHTML=`<form id="site-editor"><header><span class="alert-emblem" aria-hidden="true">⚠</span><div><span class="classified-label">RESTRICTED ACCESS // CONFIGURATION</span><h2 id="editor-heading">サイトを登録</h2><p>検査対象と期待する状態を登録します。</p></div><button type="button" id="editor-close" aria-label="設定画面を閉じる">×</button></header>
    <div class="editor-body"><p id="editor-mode" class="editor-note"></p><div id="editor-error" class="notice error" role="alert" hidden></div>
    <section><h3>サイト情報</h3><div class="editor-grid" id="site-fields">${input('name','サイト名')}${input('baseURL','サイトURL（例：https://example.jp）','','url')}${select('environment','環境',[['staging','検証環境'],['production','本番環境'],['local','ローカル']], 'staging')}</div></section>
    <section><div class="editor-section-title"><h3>公開ページの検査</h3><button type="button" id="add-page">ページを追加</button></div><p>検索エンジンへの公開可否、正規URLなどの期待値を登録します。</p><div id="page-editors"></div></section>
    <section><div class="editor-section-title"><h3>管理設定の検査</h3><button type="button" id="add-admin">項目を追加</button></div><p>値の種類も一致させて判定します。チェック状態は「真偽値」を選び、true または false を入力してください。</p><div id="admin-editors"></div></section>
    <section id="credentials-section"><h3>認証情報</h3><p>このWindowsユーザーで復号できる形式で保存します。未入力なら保存済みの情報を維持します。実サイトはHTTPSを使用してください。</p>
      <h4>REST APIの認証</h4><p id="rest-state"></p><div class="editor-grid"><label>WordPressユーザー名<input id="auth-user" autocomplete="off"></label><label>アプリケーションパスワード<input id="auth-password" type="password" autocomplete="new-password"></label></div><label class="check-line"><input id="clear-rest" type="checkbox">保存済みREST認証を削除</label>
      <h4>管理画面へのログイン</h4><p id="browser-state"></p><p>専用ブラウザーでWordPressにログインしてください。二段階認証もその画面で操作できます。確認後、この設定画面の「保存」で認証を登録します。</p><div class="editor-grid"><label>ログインページのパス<input id="login-path" value="/wp-login.php"></label><label>管理画面のパス<input id="admin-path" value="/wp-admin/"></label></div><div class="login-actions"><button type="button" id="login-start">WordPressにログイン</button><button type="button" id="login-verify" hidden>ログインを確認</button><button type="button" id="login-cancel" hidden>ログインをキャンセル</button></div><p id="login-status" role="status"></p><details><summary>セッションファイルから取り込む（任意）</summary><label>セッションファイル<input id="auth-state" type="file" accept=".json,application/json"></label></details><label class="check-line"><input id="clear-browser" type="checkbox">保存済みセッションを削除</label>
    </section>
    <section><details><summary>その他の検査（詳細設定）</summary><p>既存ハーネスの形式でJSON配列を編集できます。操作テストのコード登録は外部設定ファイルで管理します。</p><label>URL応答・公開方針（policies）<textarea id="edit-policies" rows="5" spellcheck="false"></textarea></label><label>表示・アクセシビリティ（visuals）<textarea id="edit-visuals" rows="5" spellcheck="false"></textarea></label><label>手動確認（manual）<textarea id="edit-manual" rows="5" spellcheck="false"></textarea></label></details></section>
    </div><footer><button type="button" id="editor-cancel">キャンセル</button><button type="button" id="editor-copy" hidden>新規サイトとして複製</button><button class="primary" type="submit" id="editor-save">保存</button></footer></form>`;
  document.body.append(dialog);
  const $=s=>dialog.querySelector(s),fields=$('#site-fields');
  const coverageSection=document.createElement('section');$('#credentials-section').before(coverageSection);const coverage=initCoverage(coverageSection);
  const rolesSection=document.createElement('div');rolesSection.innerHTML='<h4>ロール別の認証</h4><p>ロール名は検査options.roleと一致させます。値は再表示しません。</p><div id="role-editors"></div><button type="button" id="add-role">ロールを追加</button><label>ログインするロール<select id="login-role"><option value="">既定の管理者</option></select></label>';$('#credentials-section').append(rolesSection);
  let loginRole='';
  function refreshRoles(){const previous=$('#login-role').value;$('#login-role').replaceChildren(new Option('既定の管理者',''));for(const e of dialog.querySelectorAll('[data-role-name]'))if(e.value.trim())$('#login-role').add(new Option(e.value.trim(),e.value.trim()));$('#login-role').value=previous;}
  function roleRow(name='',status={}){const row=document.createElement('fieldset');row.className='role-row';row.innerHTML=`<legend>ロール認証</legend><label>ロール名<input data-role-name value="${esc(name)}" pattern="[a-z][a-z0-9_-]*" required></label><p>REST: ${status.rest?'登録済み':'未登録'} / ブラウザー: ${status.browser?'登録済み':'未登録'}</p><div class="editor-grid"><label>ユーザー名<input data-role-user autocomplete="off"></label><label>アプリケーションパスワード<input data-role-password type="password" autocomplete="new-password"></label></div><label class="check-line"><input type="checkbox" data-role-clear-rest>保存済みREST認証を削除</label><label class="check-line"><input type="checkbox" data-role-clear-browser>保存済みブラウザー認証を削除</label>`;row.querySelector('[data-role-name]').oninput=refreshRoles;$('#role-editors').append(row);refreshRoles();}
  $('#add-role').onclick=()=>roleRow();
  function loginControls(){
    $('#login-start').disabled=loginBusy||!!loginId||!editable;
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
  function populate(config,credentials={}) {
    original=config;loginId=null;loginRole='';loginReady=false;loginBusy=false;loginOwned=true;$('#login-status').textContent='';$('#login-path').value='/wp-login.php';$('#admin-path').value='/wp-admin/';
    coverage.populate(config);$('#role-editors').replaceChildren();for(const [name,status] of Object.entries(credentials.roles??{}))roleRow(name,status);refreshRoles();$('#login-role').value='';
    for(const e of fields.querySelectorAll('[data-key]'))e.value=config[e.dataset.key]??'';
    $('#page-editors').replaceChildren();$('#admin-editors').replaceChildren();
    (config.pages??[]).forEach(p=>row('page',p));(config.admin??[]).forEach(p=>row('admin',p));
    for(const k of ['policies','visuals','manual'])$('#edit-'+k).value=JSON.stringify(config[k]??[],null,2);
    $('#rest-state').textContent=credentials.rest?'登録済み（値は表示しません）':'未登録';$('#browser-state').textContent=credentials.browser?'登録済み（値は表示しません）':'未登録';
    $('#auth-user').value='';$('#auth-password').value='';$('#auth-state').value='';$('#clear-rest').checked=false;$('#clear-browser').checked=false;
    $('#editor-heading').textContent=editing?'サイト設定を編集':'サイトを登録';
    $('#editor-mode').textContent=editable?'保存しても検査は自動実行されません。保存後に検査範囲を選んで実行してください。':'このサイトは外部ファイルで管理されています。複製すると操作テスト・認証参照・メール連携を除いた新しい登録を作成します。';
    $('#editor-copy').hidden=editable;$('#editor-save').hidden=!editable;
    for(const e of dialog.querySelectorAll('.editor-body input,.editor-body select,.editor-body textarea,.editor-body button'))e.disabled=!editable;
    loginControls();
  }
  async function open(id){
    error('');editing=id;version=null;editable=!id;
    try{
      const data=id?await api(`/api/projects/${encodeURIComponent(id)}/settings`):{config:{name:'',baseURL:'',environment:'staging',pages:[{id:'home',path:'/',canonical:'',indexable:false}],admin:[]},managed:true};
      editable=data.managed;version=data.version;populate(data.config,data.credentials);
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
    }catch(e){alert(e.message);}
  }
  async function close(){if(saving||loginBusy)return;try{if(loginOwned)await cancelLogin();else{loginId=null;loginReady=false;}}catch(e){error(e.message);return;}dialog.close();$('#auth-password').value='';$('#auth-user').value='';$('#auth-state').value='';for(const e of dialog.querySelectorAll('[data-role-password],[data-role-user]'))e.value='';}
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
      const config={...original};delete config.headersEnv;delete config.mailpit;config.journeys=[];
      Object.assign(config,coverage.read());
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
      const auth={clearRest:$('#clear-rest').checked,clearBrowser:$('#clear-browser').checked};
      auth.roleCredentials=[...dialog.querySelectorAll('.role-row')].map(row=>{const name=row.querySelector('[data-role-name]').value.trim(),username=row.querySelector('[data-role-user]').value,password=row.querySelector('[data-role-password]').value;return {name,clearRest:row.querySelector('[data-role-clear-rest]').checked,clearBrowser:row.querySelector('[data-role-clear-browser]').checked,...(username||password?{rest:{username,password}}:{})};});
      if(loginId){auth.browserLoginId=loginId;if(loginRole)auth.browserLoginRole=loginRole;}
      if($('#auth-user').value||$('#auth-password').value)auth.rest={username:$('#auth-user').value,password:$('#auth-password').value};
      const file=$('#auth-state').files[0];if(file){if(file.size>800000)throw new Error('セッションファイルは800KB以下にしてください');try{auth.browser=JSON.parse(await file.text());}catch{throw new Error('セッションファイルのJSONを確認してください');}}
      saving=true;$('#editor-save').disabled=true;
      const result=await api(editing?`/api/projects/${encodeURIComponent(editing)}/settings`:'/api/projects',{method:'POST',body:JSON.stringify({version,config,auth})});
      saving=false;loginId=null;loginReady=false;await close();await onSaved(result.id);
    }catch(e){error(e.message);}finally{saving=false;loginControls();}
  };
  document.querySelector('#new-site').onclick=()=>open(null);
  document.querySelector('#edit-site').onclick=()=>open(currentProject());
}
