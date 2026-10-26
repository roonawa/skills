import fs from 'node:fs';
import path from 'node:path';
import {protect} from './project-store.mjs';
export class ExternalAuth {
 constructor(directory,{codec=protect}={}){this.directory=directory;this.codec=codec;}
 file(id){if(!/^[a-f0-9]{12}$/.test(id))throw Error('Invalid external project id');return path.join(this.directory,id+'.json');}
 read(id,config){const file=this.file(id);if(!fs.existsSync(file))return null;const r=JSON.parse(fs.readFileSync(file));if(r.baseURL!==config.baseURL)throw Error('保存済み認証のサイトURLが異なります。再登録してください');return r;}
 status(id,config){const r=this.read(id,config);return {browser:!!r,savedAt:r?.savedAt??null};}
 save(id,config,state){
  const host=new URL(config.baseURL).hostname;
  if(!state||!Array.isArray(state.cookies)||!Array.isArray(state.origins)||state.cookies.some(c=>c.domain.replace(/^\./,'')!==host)||state.origins.some(o=>o.origin!==config.baseURL))throw Error('認証状態が対象サイトと一致しません');
  if(!state.cookies.some(c=>c.name.startsWith('wordpress_logged_in_')&&c.value))throw Error('WordPressの認証情報がありません');
  const value={baseURL:config.baseURL,savedAt:new Date().toISOString(),sealed:this.codec(JSON.stringify(state))};fs.mkdirSync(this.directory,{recursive:true});const f=this.file(id);fs.writeFileSync(f+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(f+'.tmp',f);
 }
 prepare(id,config){
  const r=this.read(id,config);if(!r)return {env:{}};
  const state=JSON.parse(this.codec(r.sealed,true)),env={};
  for(const a of config.admin??[])if(a.source==='browser'&&a.storageStateEnv)env[a.storageStateEnv]=JSON.stringify(state);
  // Public-site checks receive only the site-viewing gate, never WordPress admin cookies.
  const gate=state.cookies.filter(c=>/password_protected/.test(c.name)&&c.name!=='password_protected_cookie_test');
  if(config.headersEnv&&gate.length)env[config.headersEnv]=JSON.stringify({Cookie:gate.map(c=>`${c.name}=${c.value}`).join('; ')});
  return {env};
 }
}
