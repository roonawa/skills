import {registrationTrace} from './registration-diagnostics.mjs';
import {validateInteractionSettings,validateInteractionPermissions,generateInteractionChecks} from './public/interaction-profile.js';
import {chromium} from '@playwright/test';
import {generateCases,linkRegistrationCoverage} from './public/case-generator.js';
import {fileURLToPath} from 'node:url';
import {preparePublicGate} from '../lib/registration-gate.mjs';
import {parseSettings,validateContactExpectedFields} from '../builtin/wordpress-profile/helpers.mjs';
import {discoverAutomation} from './automation-discovery.mjs';
import {validateAutomationInput} from './public/automation-inputs.js';
import {applyAutomationPlan,resolveAutomationProfile} from './automation-plan.mjs';
export const builtinModules=Object.fromEntries(['inventory','contact-schema','contact-submit','bank-order','post-lifecycle','scheduled'].map(k=>[k,fileURLToPath(new URL(`../builtin/wordpress-profile/${k}.mjs`,import.meta.url))]));
export function validateProfile(p,environment,{discoveryPending=false}={}){
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('登録時の検査条件が必要です');
 const allowed=['contactExpectedFields','automation','interactions','sitePath','timezone','language','indexable','permalink','contactFormId','writes','adminPath','maxPages','performanceMs','contactPath','submit','testEmail','contactNameField','contactEmailField','contactMessageField','contactConsentField','bankOrder','productPath','cartPath','customerPrefecture','bankPaymentLabel','expectedTotal'];
 if(Object.keys(p).some(k=>!allowed.includes(k)))throw Error('未対応の登録条件があります');
 validateInteractionSettings(p.interactions);
 validateInteractionPermissions(p.interactions,environment,p.writes);
 const automation=validateAutomationInput(p.automation);
 const contactExpectedFields=validateContactExpectedFields(p.contactExpectedFields);
 for(const key of ['writes','submit','bankOrder'])if(p[key]!==undefined&&typeof p[key]!=='boolean')throw Error('操作許可は真偽値で指定してください');
 if(typeof p.timezone!=='string'||!p.timezone||typeof p.language!=='string'||!p.language||typeof p.indexable!=='boolean')throw Error('タイムゾーン・言語・検索公開方針を入力してください');
 try{new Intl.DateTimeFormat('ja',{timeZone:p.timezone});}catch{throw Error('タイムゾーンが不正です');}
 if(p.writes&&environment==='production')throw Error('本番環境ではテスト投稿を作成できません');
 if(p.submit&&(environment==='production'||!p.writes))throw Error('送信検査には検証環境の操作許可が必要です');
 if(p.bankOrder){if(environment==='production'||!p.writes)throw Error('注文確定は検証環境のみです');for(const key of ['productPath','cartPath'])if(typeof p[key]!=='string'||!/^\/(?!\/)/.test(p[key])||/[?#]/.test(p[key]))throw Error('商品・カートのパスを指定してください');if(!p.testEmail||!/^\S+@\S+\.\S+$/.test(p.testEmail)||!p.customerPrefecture||!p.bankPaymentLabel||!Number.isInteger(p.expectedTotal)||p.expectedTotal<1)throw Error('注文検査のメール・都道府県・銀行振込名・合計金額を指定してください');}
 if(p.submit&&(typeof p.testEmail!=='string'||!/^\S+@\S+\.\S+$/.test(p.testEmail)))throw Error('送信検査のテストメールを入力してください');
 if(p.submit&&!discoveryPending&&(!p.contactFormId||!p.contactPath))throw Error('送信検査のフォームID・パスを入力してください');
 for(const name of ['contactNameField','contactEmailField','contactMessageField','contactConsentField'])if(p[name]!==undefined&&!/^[a-zA-Z][\w-]{0,99}$/.test(p[name]))throw Error('フォーム項目名が不正です');
 if(p.submit&&!discoveryPending&&['contactNameField','contactEmailField','contactMessageField'].some(k=>!p[k]))throw Error('送信フォームの名前・メール・本文の項目名が必要です');
 if(p.writes!==undefined&&typeof p.writes!=='boolean')throw Error('投稿作成条件が不正です');
 if(p.contactFormId!=null&&(!Number.isInteger(p.contactFormId)||p.contactFormId<1))throw Error('フォームIDは正の整数です');
 if(p.permalink!==undefined&&typeof p.permalink!=='string')throw Error('URL構造を文字列で指定してください');
 const adminPath=p.adminPath||'/wp-admin/';if(!/^\/(?:[a-zA-Z0-9_-]+\/)*wp-admin\/$/.test(adminPath))throw Error('管理画面パスが不正です');
 if(p.sitePath!==undefined&&(!/^\/(?:[a-zA-Z0-9_%-]+\/)*$/.test(p.sitePath)||/%(?:2e|2f|5c)/i.test(p.sitePath)))throw Error('公開サイトのパスが不正です');
 const maxPages=p.maxPages??200;if(!Number.isInteger(maxPages)||maxPages<1||maxPages>500)throw Error('取得上限は1〜500ページです');
 if(p.performanceMs!=null&&(!Number.isInteger(p.performanceMs)||p.performanceMs<1||p.performanceMs>120000))throw Error('性能上限を1〜120000msで指定してください');
 if(p.contactPath&&(!p.contactPath.startsWith('/')||p.contactPath.startsWith('//')||/[?#]/.test(p.contactPath)))throw Error('問い合わせパスが不正です');
 return {...p,...(contactExpectedFields===undefined?{}:{contactExpectedFields}),...(p.automation===undefined?{}:{automation}),adminPath,maxPages,writes:!!p.writes};
}
export async function discoverRegistration({baseURL,profile,state,publicPassword='',launch=()=>chromium.launch(),trace=registrationTrace()}){
 const browser=await trace.step('browser',launch);let context;const result={pages:[{path:profile.sitePath||'/'}],types:[],warnings:[],authenticated:false};
 try{
 const gate=state.cookies.filter(c=>/password_protected/.test(c.name)&&c.name!=='password_protected_cookie_test');
 const publicEnv={WPQA_UI_SITE_PASSWORD:publicPassword,WPQA_UI_PUBLIC_HEADERS:JSON.stringify(gate.length?{Cookie:gate.map(c=>c.name+'='+c.value).join('; ')}:{})};
 const gateResult=await trace.step('gate',()=>preparePublicGate({baseURL,sitePath:profile.sitePath,headersEnv:'WPQA_UI_PUBLIC_HEADERS'},publicEnv));if(gateResult?.required===false){result.publicPasswordRequired=false;result.warnings.push('閲覧パスワード保護がないため、入力された閲覧パスワードは使用・保存しません。');}
 const {request}=await import('@playwright/test'),publicClient=await request.newContext({extraHTTPHeaders:JSON.parse(publicEnv.WPQA_UI_PUBLIC_HEADERS),timeout:15000});
 try{await trace.step('public',async()=>{const r=await publicClient.get(baseURL+(profile.sitePath||'/'),{maxRedirects:0});const location=r.headers().location??'',body=await r.text();if(/password-protected/.test(location)||/name=["']password_protected_pwd/.test(body))throw Error('登録時にサイト閲覧パスワードも入力してください。管理者ログインとは別の認証です。');});}finally{await publicClient.dispose();}
 context=await browser.newContext({storageState:state,javaScriptEnabled:false,serviceWorkers:'block'});
 await context.route('**/*',async r=>{const req=r.request(),u=new URL(req.url());if(req.method()!=='GET'||req.resourceType()!=='document'||u.origin!==baseURL)return r.abort();const response=await r.fetch({maxRedirects:0});try{if(response.status()>=300&&response.status()<400)return await r.abort();await r.fulfill({response});}finally{await response.dispose();}});
 const page=await context.newPage();await trace.step('admin',()=>page.goto(baseURL+profile.adminPath,{timeout:20000}));
 await trace.step('authentication',async()=>{if(!await page.locator('#wpadminbar').count())throw Error('管理画面の認証を確認できません');});result.authenticated=true;
 const source=await page.locator('script:not([src])').evaluateAll(es=>es.map(e=>e.textContent).join('\n'));
 let settings;try{settings=parseSettings(source,baseURL);}catch{result.warnings.push('REST連携を取得できません。URLはトップページのみ。');}
 if(settings){
 const headers={'X-WP-Nonce':settings.nonce};
 const rest=new URL('wp/v2/',settings.root).href;
 for(const type of ['posts','pages']){
  let pages=1;for(let n=1;n<=pages;n++){
   const r=await trace.step('urls',()=>context.request.get(rest+type+`?status=publish&per_page=100&page=${n}&_fields=id,link`,{headers,maxRedirects:0,timeout:20000}));
   if(r.status()!==200){result.warnings.push(`${type}: HTTP ${r.status()}（自動取得未完了）`);break;}
   const data=await trace.step('urls',async()=>{const value=await r.json();if(!Array.isArray(value))throw Error('公開URL一覧が不正です');return value;});pages=Math.min(Number(r.headers()['x-wp-totalpages']||1),10);
   for(const item of data){const u=new URL(item.link),pagePath=u.pathname+u.search;if(u.origin===baseURL&&!result.pages.some(p=>p.path===pagePath)&&result.pages.length<profile.maxPages)result.pages.push({path:pagePath});}
   if(result.pages.length>=profile.maxPages){result.warnings.push('URL取得上限に達しました。範囲の追加確認が必要です。');break;}
  }
 }
 }
 result.automation=await trace.step('discovery',()=>discoverAutomation({baseURL,profile,adminPage:page,adminContext:context,publicHeaders:JSON.parse(publicEnv.WPQA_UI_PUBLIC_HEADERS),pages:result.pages,restSettings:settings}));
 result.plugins=result.automation.admin.plugins.map(row=>row.expected);
 result.warnings.push(...result.automation.warnings);
 return result;
 }finally{await context?.close();await browser.close();}
}
export function registrationConfig({name,baseURL,environment,profile,discovery}){
 const p=validateProfile(resolveAutomationProfile(profile,discovery),environment);const url=new URL(baseURL);if(url.origin!==baseURL||url.pathname!=='/'||!name?.trim())throw Error('サイト名とorigin形式のURLが必要です');
 const c={name:name.trim(),baseURL,environment,allowTestWrites:p.writes,allowProductionJourneys:environment==='production',pages:discovery.pages.map((v,i)=>({id:i?'discovered-'+i:'home',path:v.path,canonical:new URL(v.path,baseURL).href,indexable:p.indexable,lang:p.language,links:true})),admin:[],journeys:[],visuals:[],checks:[],manual:[]};
 const setting=(id,title,path,selector,read,expected)=>c.admin.push({id,title,path:p.adminPath+path,source:'browser',selector,read,expected,authenticatedSelector:'#wpadminbar',storageStateEnv:'WPQA_UI_ADMIN_STATE'});
 setting('siteurl','WordPress URL','options-general.php','#siteurl','value',baseURL+p.adminPath.replace(/\/wp-admin\/$/,''));
 setting('home','公開サイトURL','options-general.php','#home','value',baseURL+(p.sitePath||'/').replace(/\/$/,''));
 setting('timezone','タイムゾーン','options-general.php','#timezone_string','value',p.timezone);
 setting('language','サイト言語','options-general.php','#WPLANG','value',p.language);
 setting('indexing','検索公開方針','options-reading.php','#blog_public','checked',!p.indexable);
 if(p.permalink)setting('permalinks','記事URL構造','options-permalink.php','#permalink_structure','value',p.permalink);
 c.journeys=profileJourneys(p);
 if(p.performanceMs)c.checks.push({id:'registration-performance',title:'登録した性能予算',suite:'performance',kind:'performance-navigation',options:{path:p.sitePath||'/',samples:3,cache:'cold',budgets:{durationMs:p.performanceMs}}});
 // Representative views, not hundreds of duplicate screenshots.
 const generated=generateCases({...c,pages:c.pages.slice(0,5)});generated.pages=c.pages;
 // Keep missing prerequisites distinct from actual human judgment.
 generated.manual.push({id:'registration-scope',title:'登録時の取得範囲・残る条件',reason:`公開URL ${c.pages.length}件、代表表示${Math.min(c.pages.length,5)}ページ。${discovery.warnings.join(' ')} 問い合わせ送信・銀行振込注文は登録した対象のみ。受信箱到達・別ロール・隔離復元は追加の連携・期待値が必要。`});
 return applyAutomationPlan(linkRegistrationCoverage(generateInteractionChecks(generated,p),p),p,discovery);
}


export function profileJourneys(p){
 return ['inventory',...(p.contactFormId?['contact-schema']:[]),...(p.submit?['contact-submit']:[]),...(p.bankOrder?['bank-order']:[]),...(p.writes?['post-lifecycle','scheduled']:[])].map(kind=>({id:'profile-'+kind,title:{inventory:'CMS公開URL照合','contact-schema':'問い合わせ設定','contact-submit':'問い合わせ送信（受信箱到達とは別判定）','bank-order':'銀行振込注文・取消','post-lifecycle':'投稿の作成・公開・更新・回収',scheduled:'予約公開・回収'}[kind],module:builtinModules[kind],handlesAuthentication:true}));
}

