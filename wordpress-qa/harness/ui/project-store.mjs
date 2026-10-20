import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {validateConfig} from '../lib/config.mjs';

export function protect(value,decode=false) {
  if(process.platform!=='win32')throw new Error('認証情報の保存はWindowsのユーザー暗号化に対応しています');
  const command="[void][Reflection.Assembly]::LoadWithPartialName('System.Security'); $inputText=[Console]::In.ReadToEnd(); "+(decode
    ? "[Console]::Out.Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputText),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))"
    : "[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($inputText),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))");
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); "+command],{input:value,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:2*1024*1024});
  if(r.error||r.status!==0)throw new Error('認証情報を暗号化・復号できません。同じWindowsユーザーで実行してください');
  return r.stdout;
}
function stateForOrigin(state,baseURL) {
  const host=new URL(baseURL).hostname;
  if(!state||!Array.isArray(state.cookies)||!Array.isArray(state.origins))throw new Error('storageStateのcookiesとoriginsが必要です');
  for(const c of state.cookies) {
    if(typeof c.domain!=='string'||c.domain.replace(/^\./,'')!==host||typeof c.name!=='string'||typeof c.value!=='string'||typeof c.path!=='string')throw new Error('Cookieは対象サイトのホストに限定してください');
  }
  for(const o of state.origins)if(o.origin!==baseURL||!Array.isArray(o.localStorage))throw new Error('storageStateのoriginが対象サイトと異なります');
  return state;
}
export class ProjectStore {
  constructor(directory,{codec=protect,trustedAdapters={}}={}){this.directory=path.resolve(directory);this.codec=codec;this.trustedAdapters=structuredClone(trustedAdapters);fs.mkdirSync(this.directory,{recursive:true});}
  ids(){return fs.readdirSync(this.directory).filter(x=>/^[a-f0-9-]{36}\.json$/.test(x)).map(x=>x.slice(0,-5));}
  file(id){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('サイトIDが不正です');return path.join(this.directory,id+'.json');}
  record(id){return JSON.parse(fs.readFileSync(this.file(id),'utf8'));}
  view(id){const r=this.record(id);return {config:r.config,version:r.version,credentials:r.credentials,managed:true};}
  context(id){const r=this.record(id),dir=path.join(this.directory,id),config=validateConfig({...r.config,trustedAdapters:structuredClone(this.trustedAdapters)});return {config,trustedAdapters:config.trustedAdapters,configHash:createHash('sha256').update(JSON.stringify(config)).digest('hex'),configPath:path.join(dir,'site.json'),configDir:dir,outputDir:config.outputDir,baselineDir:config.baselineDir};}
  save({id,version,config,auth={}}){
    const old=id?this.record(id):null;
    if(old&&old.version!==version)throw new Error('別の画面で設定が更新されました。閉じてから再度開いてください');
    id??=randomUUID();const dir=path.join(this.directory,id);
    // UI can edit test data, never introduce executable modules or arbitrary output paths.
    if((config.journeys??[]).length)throw new Error('UI登録サイトの操作テストには案件用コードが必要です。外部設定ファイルを利用してください');
    for(const key of ['headersEnv','mailpit'])if(config[key]!==undefined)throw new Error('認証・メール連携はこの編集画面では設定できません');
    config=validateConfig({...config,trustedAdapters:structuredClone(this.trustedAdapters),outputDir:path.join(dir,'runs'),baselineDir:path.join(dir,'baselines')});
    const roles=auth.roleCredentials??[];
    if(!Array.isArray(roles))throw new Error('roleCredentialsは配列で指定してください');
    const names=new Set();
    for(const role of roles){
      if(!role||typeof role.name!=='string'||!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(role.name)||['constructor','prototype'].includes(role.name)||names.has(role.name))throw new Error('ロール名は重複のない小文字英数字とハイフンで指定してください');
      names.add(role.name);
      if((role.clearRest&&role.rest)||(role.clearBrowser&&role.browser))throw new Error('同じ認証情報の削除と登録は同時に指定できません');
    }
    if((auth.clearRest&&auth.rest)||(auth.clearBrowser&&auth.browser))throw new Error('同じ認証情報の削除と登録は同時に指定できません');
    if(old&&old.config.baseURL!==config.baseURL&&(old.credentials.rest||old.credentials.browser)&&!(auth.clearRest&&auth.clearBrowser))throw new Error('URL変更前に保存済み認証を両方削除してください');
    if(old&&old.config.baseURL!==config.baseURL)for(const [name,credential] of Object.entries(old.credentials.roles??{})){
      const clearing=roles.find(r=>r.name===name);
      if((credential.rest&&!clearing?.clearRest)||(credential.browser&&!clearing?.clearBrowser))throw new Error('URL変更前に保存済みロール認証をすべて削除してください');
    }
    let secrets=old?.sealed?JSON.parse(this.codec(old.sealed,true)):{};
    if(auth.clearRest)delete secrets.rest;if(auth.clearBrowser)delete secrets.browser;
    if(auth.rest){
      if(typeof auth.rest.username!=='string'||!auth.rest.username.trim()||auth.rest.username.includes(':')||typeof auth.rest.password!=='string'||!auth.rest.password.trim())throw new Error('REST認証のユーザー名とパスワードを入力してください');
      secrets.rest=auth.rest;
    }
    if(auth.browser)secrets.browser=stateForOrigin(auth.browser,config.baseURL);
    secrets.roles??={};
    for(const role of roles){
      const secret=Object.hasOwn(secrets.roles,role.name)?secrets.roles[role.name]:{};
      if(role.clearRest)delete secret.rest;if(role.clearBrowser)delete secret.browser;
      if(role.rest){
        if(typeof role.rest.username!=='string'||!role.rest.username.trim()||role.rest.username.includes(':')||typeof role.rest.password!=='string'||!role.rest.password.trim())throw new Error('REST認証のユーザー名とパスワードを入力してください');
        secret.rest={username:role.rest.username,password:role.rest.password};
      }
      if(role.browser)secret.browser=stateForOrigin(role.browser,config.baseURL);
      if(secret.rest||secret.browser)secrets.roles[role.name]=secret;else delete secrets.roles[role.name];
    }
    if((secrets.rest||secrets.browser||Object.keys(secrets.roles).length)&&new URL(config.baseURL).protocol!=='https:'&&config.environment!=='local')throw new Error('認証付きの実サイトはHTTPSで登録してください');
    config.admin=(config.admin??[]).map(a=>{
      const {headersEnv,storageStateEnv,...clean}=a;
      return {...clean,...(a.source==='rest'&&secrets.rest?{headersEnv:'WPQA_UI_ADMIN_HEADERS'}:{}),...(a.source==='browser'&&secrets.browser?{storageStateEnv:'WPQA_UI_ADMIN_STATE'}:{})};
    });
    config=validateConfig(config);
    const credentials={rest:!!secrets.rest,browser:!!secrets.browser,roles:Object.fromEntries(Object.entries(secrets.roles).map(([name,value])=>[name,{rest:!!value.rest,browser:!!value.browser}]))};
    const record={version:randomUUID(),config,credentials,sealed:credentials.rest||credentials.browser||Object.keys(credentials.roles).length?this.codec(JSON.stringify(secrets)):null};
    const file=this.file(id),temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(record,null,2),{mode:0o600});fs.renameSync(temp,file);
    return id;
  }
  prepare(id){
    const ctx=this.context(id),r=this.record(id),secrets=r.sealed?JSON.parse(this.codec(r.sealed,true)):{};
    fs.mkdirSync(ctx.configDir,{recursive:true});fs.writeFileSync(ctx.configPath,JSON.stringify(ctx.config,null,2));
    const env={WPQA_UI_ADMIN_HEADERS:'',WPQA_UI_ADMIN_STATE:''};
    if(secrets.rest)env.WPQA_UI_ADMIN_HEADERS=JSON.stringify({Authorization:'Basic '+Buffer.from(secrets.rest.username+':'+secrets.rest.password).toString('base64')});
    if(secrets.browser)env.WPQA_UI_ADMIN_STATE=JSON.stringify(secrets.browser);
    for(const [name,value] of Object.entries(secrets.roles??{})){
      const prefix='WPQA_ROLE_'+name.toUpperCase().replaceAll('-','_');
      env[prefix+'_HEADERS']=value.rest?JSON.stringify({Authorization:'Basic '+Buffer.from(value.rest.username+':'+value.rest.password).toString('base64')}):'';
      env[prefix+'_STATE']=value.browser?JSON.stringify(value.browser):'';
    }
    return {env,configPath:ctx.configPath};
  }
}
