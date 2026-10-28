import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';

export function loginTarget({baseURL,environment,loginPath='/wp-login.php',adminPath='/wp-admin/'}) {
  const base=new URL(baseURL);
  if(base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('サイトURLはorigin形式で入力してください');
  if(base.protocol!=='https:'&&!(base.protocol==='http:'&&environment==='local'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw new Error('ログインにはHTTPSが必要です（ローカルテストのみHTTP可）');
  const login=new URL(loginPath,base),admin=new URL(adminPath,base);
  if(login.origin!==base.origin||admin.origin!==base.origin||login.username||login.password||admin.username||admin.password||login.hash||admin.hash||admin.search||!admin.pathname.endsWith('/wp-admin/'))throw new Error('同じサイトのログインURLと /wp-admin/ パスを指定してください');
  return {baseURL:base.origin,loginURL:login.href,profileURL:new URL('profile.php',admin).href};
}
export function scopeState(state,baseURL) {
  const host=new URL(baseURL).hostname;
  return {cookies:state.cookies.filter(c=>{const d=c.domain.replace(/^\./,'');return d===host||(c.domain.startsWith('.')&&host.endsWith('.'+d));}).map(c=>({...c,domain:host})),origins:state.origins.filter(o=>o.origin===baseURL)};
}
export class BrowserLogin {
  constructor({launch=()=>chromium.launch({headless:false}),ttlMs=10*60*1000,resume}={}){
    this.launch=launch;this.ttlMs=ttlMs;this.session=null;
    // Trusted server-side recovery only. Never accept a snapshot from an HTTP request.
    if(resume){
      const target=loginTarget(resume);
      if(resume.phase!=='verified'||!resume.id||resume.projectId||resume.role)throw Error('確認済みの新規登録セッションだけを復元できます');
      const state=scopeState(resume.state,target.baseURL);
      if(!state.cookies.some(c=>c.name.startsWith('wordpress_logged_in_')&&c.value))throw Error('復元する認証情報がありません');
      const s={...target,id:resume.id,environment:resume.environment,projectId:null,role:null,phase:'verified',state};this.session=s;
      s.timer=setTimeout(()=>{void this.cancel(s.id);},ttlMs);s.timer.unref();
    }
  }
  get busy(){return !!this.session;}
  status(){const s=this.session;return s?{id:s.id,projectId:s.projectId,baseURL:s.baseURL,environment:s.environment,phase:s.phase,...(s.role?{role:s.role}:{})}:null;}
  get(id){if(!this.session||this.session.id!==id)throw new Error('ログインが終了または期限切れです。再度ログインしてください');return this.session;}
  async start(options){
    if(this.busy)throw new Error('別のログインが進行中です。完了またはキャンセルしてください');
    if(options.role!=null&&(typeof options.role!=='string'||!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(options.role)||['constructor','prototype'].includes(options.role)))throw new Error('ロール名が不正です');
    const target=loginTarget(options),s={id:randomUUID(),projectId:options.projectId??null,role:options.role??null,environment:options.environment,...target,phase:'opening'};this.session=s;
    s.timer=setTimeout(()=>{void this.cancel(s.id);},this.ttlMs);s.timer.unref();
    try{
      const browser=await this.launch();s.browser=browser;
      if(this.session!==s){await browser.close();throw new Error('cancelled');}
      browser.on('disconnected',()=>{if(this.session===s&&s.phase!=='verified')void this.cancel(s.id);});
      s.context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});
      const page=await s.context.newPage();await page.goto(s.loginURL,{waitUntil:'domcontentloaded',timeout:30000});
      if(this.session!==s)throw new Error('cancelled');s.phase='waiting';
      return {id:s.id,baseURL:s.baseURL,phase:s.phase,...(s.role?{role:s.role}:{}),expiresInSeconds:this.ttlMs/1000};
    }catch{await this.cancel(s.id);throw new Error('ログイン用ブラウザーを開けませんでした。URLと接続先を確認してください');}
  }
  async verify(id){
    const s=this.get(id);if(s.phase==='verified')return {id,phase:'verified'};
    if(s.phase!=='waiting')throw new Error('ログイン確認中です');s.phase='checking';let probe;
    try{
      const state=scopeState(await s.context.storageState(),s.baseURL);
      if(!state.cookies.some(c=>c.name.startsWith('wordpress_logged_in_')&&c.value))throw new Error('not signed in');
      // Verify that the captured session, rather than the displayed login tab, works.
      probe=await s.browser.newContext({storageState:state,javaScriptEnabled:false,serviceWorkers:'block'});
      await probe.route('**/*',route=>{
        const req=route.request(),u=new URL(req.url());
        return req.method()==='GET'&&u.origin===s.baseURL&&(req.resourceType()==='document'?u.href===s.profileURL:['image','stylesheet','font'].includes(req.resourceType()))?route.continue():route.abort();
      });
      const page=await probe.newPage();const response=await page.goto(s.profileURL,{timeout:15000,waitUntil:'domcontentloaded'});
      if(response?.status()!==200||page.url()!==s.profileURL||!await page.locator('#wpadminbar').isVisible()||!await page.locator('#your-profile').isVisible())throw new Error('not authenticated');
      if(this.session!==s)throw new Error('cancelled');
      s.state=state;s.phase='verified';await probe.close();probe=null;await s.browser.close();s.browser=null;
      return {id,phase:'verified'};
    }catch{if(this.session===s)s.phase='waiting';throw new Error('ログインを確認できません。専用ブラウザーでログイン・追加認証を完了してから、もう一度確認してください');}
    finally{await probe?.close().catch(()=>{});}
  }
  save(id,{baseURL,projectId,role},persist){
    const s=this.get(id);
    if(s.phase!=='verified'||s.baseURL!==new URL(baseURL).origin||s.projectId!==(projectId??null)||(s.role??null)!==(role??null))throw new Error('確認済みログインと保存先が一致しません。再度ログインしてください');
    const result=persist(s.state);clearTimeout(s.timer);this.session=null;return result;
  }
  async cancel(id){
    const s=this.session;if(!s||s.id!==id)return;
    this.session=null;clearTimeout(s.timer);s.state=null;await s.browser?.close().catch(()=>{});
  }
  async close(){if(this.session)await this.cancel(this.session.id);}
}
