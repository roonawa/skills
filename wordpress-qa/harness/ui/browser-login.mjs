import {wordpressSessionStatus,isLoggedInCookie} from '../lib/wordpress-session.mjs';
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
// WordPress may live in a subfolder (e.g. /wp/wp-admin/) even when the site is at the root.
// The logged-in browser shows the real admin path, so read it from the open pages.
const ADMIN_PATH=/^(\/(?:[A-Za-z0-9_-]+\/)*wp-admin\/)/;
export function adminPathFrom(urls,baseURL){
  for(const value of urls){
    let u;try{u=new URL(value);}catch{continue;}
    if(u.origin!==baseURL)continue;
    const m=ADMIN_PATH.exec(u.pathname);if(m)return m[1];
  }
  return null;
}
// Login pages that use Google reCAPTCHA need its scripts and frames. Allow only the /recaptcha/
// paths on Google's reCAPTCHA hosts, in addition to the site itself; everything else stays blocked.
const RECAPTCHA_ORIGINS=['https://www.google.com','https://www.gstatic.com','https://www.recaptcha.net'];
export function remoteLoginAllows(value,baseURL){
  let u;try{u=new URL(value);}catch{return false;}
  if(u.username||u.password)return false;
  if(u.origin===baseURL)return true;
  return RECAPTCHA_ORIGINS.includes(u.origin)&&u.pathname.startsWith('/recaptcha/');
}
export class BrowserLogin {
  constructor({launch=()=>chromium.launch({headless:false}),ttlMs=10*60*1000,resume}={}){
    this.launch=launch;this.ttlMs=ttlMs;this.session=null;
    // Trusted server-side recovery only. Never accept a snapshot from an HTTP request.
    if(resume){
      const target=loginTarget(resume);
      if(resume.phase!=='verified'||!resume.id||resume.projectId||resume.role)throw Error('確認済みの新規登録セッションだけを復元できます');
      const state=scopeState(resume.state,target.baseURL);
      if(!state.cookies.some(isLoggedInCookie))throw Error('復元する認証情報がありません');
      const s={...target,id:resume.id,environment:resume.environment,projectId:null,role:null,phase:'verified',state};this.session=s;
      s.timer=setTimeout(()=>{void this.cancel(s.id);},ttlMs);s.timer.unref();
    }
  }
  get busy(){return !!this.session;}
  status(){const s=this.session;return s?{id:s.id,projectId:s.projectId,baseURL:s.baseURL,environment:s.environment,phase:s.phase,...(s.role?{role:s.role}:{})}:null;}
  get(id){if(!this.session||this.session.id!==id)throw new Error('ログインが終了または期限切れです。再度ログインしてください');return this.session;}
  // The admin path found in the logged-in browser, when it differs from the default guess.
  adminPathOf(id){return this.get(id).adminPath??null;}
  async start(options){
    if(this.busy)throw new Error('別のログインが進行中です。完了またはキャンセルしてください');
    if(options.role!=null&&(typeof options.role!=='string'||!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(options.role)||['constructor','prototype'].includes(options.role)))throw new Error('ロール名が不正です');
    const target=loginTarget(options),s={id:randomUUID(),projectId:options.projectId??null,role:options.role??null,environment:options.environment,...target,phase:'opening'};this.session=s;
    s.timer=setTimeout(()=>{void this.cancel(s.id);},this.ttlMs);s.timer.unref();
    try{
      const browser=await this.launch();s.browser=browser;
      if(this.session!==s){await browser.close();throw new Error('cancelled');}
      browser.on('disconnected',()=>{if(this.session===s&&s.phase!=='verified')void this.cancel(s.id);});
      s.context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,...(options.remote?{viewport:{width:1100,height:760}}:{})});
      if(options.remote){
        // A login surface, not an unrestricted remote browser (the site and reCAPTCHA only). External SSO is
        // deliberately unsupported until explicit trusted origins are configured.
        await s.context.route('**/*',route=>{
          return remoteLoginAllows(route.request().url(),s.baseURL)?route.continue():route.abort();
        });
        await s.context.routeWebSocket('**/*',socket=>socket.close());
      }
      const page=await s.context.newPage();s.page=page;
      if(options.remote)s.context.on('page',other=>{if(other!==page)void other.close();});
      await page.goto(s.loginURL,{waitUntil:'domcontentloaded',timeout:30000});
      if(this.session!==s)throw new Error('cancelled');s.phase='waiting';
      return {id:s.id,baseURL:s.baseURL,phase:s.phase,...(s.role?{role:s.role}:{}),expiresInSeconds:this.ttlMs/1000};
    }catch{await this.cancel(s.id);throw new Error('ログイン用ブラウザーを開けませんでした。URLと接続先を確認してください');}
  }
  async verify(id){
    const s=this.get(id);if(s.phase==='verified')return {id,phase:'verified',...(s.adminPath?{adminPath:s.adminPath}:{})};
    if(s.phase!=='waiting')throw new Error('ログイン確認中です');s.phase='checking';let probe,probePage;
    // Japanese reason shown to the user. Never include cookie values, URLs with queries or page text.
    let reason='確認中に問題が起きました';
    try{
      const state=scopeState(await s.context.storageState(),s.baseURL);
      reason='このサイトのログイン用のクッキーが見つかりません';
      if(!state.cookies.some(isLoggedInCookie))throw new Error('not signed in');
      const detected=adminPathFrom(s.context.pages().map(p=>p.url()),s.baseURL);
      if(detected){s.adminPath=detected;s.profileURL=new URL(detected+'profile.php',s.baseURL).href;}
      // Verify that the captured session, rather than the displayed login tab, works.
      probe=await s.browser.newContext({storageState:state,javaScriptEnabled:false,serviceWorkers:'block'});
      await probe.route('**/*',route=>{
        const req=route.request(),u=new URL(req.url());
        // Any other page load (a server redirect, or a <noscript> meta refresh that some plugins add
        // for browsers without JavaScript) gets 204 No Content, so the browser stays on the profile.
        if(req.resourceType()==='document'&&req.frame()===probePage?.mainFrame()&&u.href!==s.profileURL)return route.fulfill({status:204,body:''});
        return req.method()==='GET'&&u.origin===s.baseURL&&(req.resourceType()==='document'?u.href===s.profileURL:['image','stylesheet','font'].includes(req.resourceType()))?route.continue():route.abort();
      });
      const page=await probe.newPage();probePage=page;
      reason='管理画面のプロフィール画面を開けませんでした';
      const response=await page.goto(s.profileURL,{timeout:15000,waitUntil:'domcontentloaded'});
      if(response?.request().redirectedFrom()){reason='管理画面のプロフィール画面が別のページへ転送されました';throw new Error('redirected');}
      if(response?.status()!==200){reason=`管理画面のプロフィール画面がHTTP ${response?.status()??'応答なし'}でした`;throw new Error('status');}
      if(page.url()!==s.profileURL){reason='管理画面のプロフィール画面から別のページへ移動しました';throw new Error('moved');}
      // The check runs without JavaScript, so look for the elements rather than their visibility:
      // some plugins hide the profile form until their scripts run.
      if(!await page.locator('#wpadminbar').count()||!await page.locator('form#your-profile').count()){reason='管理画面のプロフィール画面として表示されませんでした';throw new Error('not authenticated');}
      if(this.session!==s)throw new Error('cancelled');
      reason='WordPressのログインの有効期限が切れています';
      const verifiedState=scopeState(await probe.storageState(),s.baseURL);if(wordpressSessionStatus(verifiedState,new URL(s.profileURL).pathname).expired)throw Error('expired');s.state=verifiedState;s.phase='verified';await probe.close();probe=null;await s.browser.close();s.browser=null;
      return {id,phase:'verified',...(s.adminPath?{adminPath:s.adminPath}:{})};
    }catch{if(this.session===s)s.phase='waiting';throw new Error(`ログインを確認できません。専用ブラウザーでログイン・追加認証を完了してから、もう一度確認してください（理由：${reason}）`);}
    finally{await probe?.close().catch(()=>{});}
  }
  save(id,{baseURL,projectId,role},persist){
    const s=this.get(id);
    if(s.phase!=='verified'||s.baseURL!==new URL(baseURL).origin||s.projectId!==(projectId??null)||(s.role??null)!==(role??null))throw new Error('確認済みログインと保存先が一致しません。再度ログインしてください');
    if(wordpressSessionStatus(s.state,new URL(s.profileURL??'/wp-admin/profile.php',s.baseURL).pathname).expired)throw Error('WordPress認証の内部期限が切れています。専用ブラウザーで新しいログインを取得してください');const result=persist(s.state);clearTimeout(s.timer);this.session=null;return result;
  }
  async cancel(id){
    const s=this.session;if(!s||s.id!==id)return;
    this.session=null;clearTimeout(s.timer);s.state=null;await s.browser?.close().catch(()=>{});
  }
  async close(){if(this.session)await this.cancel(this.session.id);}
}
