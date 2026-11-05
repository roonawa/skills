// Run from any directory: node test/settings-minimal-browser.mjs
// 登録済みサイトの設定画面は最低限の項目だけを表示し、残りは閉じた「詳細設定（技術担当向け）」にまとめる。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {startUI} from '../ui/server.mjs';
import {ProjectStore} from '../ui/project-store.mjs';
import {registrationConfig} from '../ui/registration.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
fs.mkdirSync(path.join(root,'.selftest'),{recursive:true});
const scratch=fs.mkdtempSync(path.join(root,'.selftest','settings-minimal-'));
const storeDir=path.join(scratch,'projects'),baseURL='https://minimal.example.test';
const profile={timezone:'Asia/Tokyo',language:'ja',adminPath:'/wp-admin/',indexable:true,writes:false,testEmail:'qa@example.test'};
const store=new ProjectStore(storeDir,{codec:v=>v});
const config=registrationConfig({name:'最小設定テスト',baseURL,environment:'staging',profile,discovery:{pages:[{path:'/'},{path:'/about/'}],warnings:[]}});
const id=store.save({config,profile,auth:{publicPassword:'stored-view-password'}});
const {revision:_r,journeys:_j,allowTestWrites:_w,headersEnv:_h,...bare}=config,plain=store.save({config:{...bare,name:'条件なしサイト'},sensitivePaths:false});
const aiFile=path.join(storeDir,'system','system.json');
const app=await startUI({port:0,storeDir,credentialCodec:v=>v});
const settings=async project=>{const d=await(await fetch(`${app.url}/api/projects/${project}/settings`)).json();return {config:d.config,profile:d.profile,credentials:d.credentials};};
// Visible form controls inside the dialog, named by data-key, id, data attribute or text.
const visibleControls=d=>d.evaluate(dialog=>[...dialog.querySelectorAll('input,select,textarea,button,summary')].filter(el=>el.checkVisibility()).map(el=>el.dataset.key||el.id||el.getAttributeNames().find(a=>a.startsWith('data-'))||el.textContent.trim()));
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const d=page.locator('dialog:has(#site-editor)'),advanced=d.locator('#settings-advanced-settings'),summary=advanced.locator(':scope>summary');
 const openSite=async name=>{await page.goto(app.url);await page.locator('#project-select').selectOption({label:name});await page.locator('#edit-site').click();await expect(d).toBeVisible();await expect(d.locator('[data-key=name]')).toHaveValue(name);};
 const base=['editor-close','name','baseURL','environment'],tail=['login-start','詳細設定（技術担当向け）','editor-cancel','editor-save'];
 // AI未設定：補完パネルは出さない。標準操作テスト登録済み：検索エンジン・閲覧パスワードを出す。
 await openSite('最小設定テスト');
 await expect(d.locator('#login-status')).toBeAttached();
 assert.deepEqual(await visibleControls(d),[...base,'indexable','profile-public-password','profile-clear-public-password',...tail]);
 await expect(d.locator('#settings-profile-basics [data-key=indexable]')).toBeChecked();
 await expect(d.locator('#settings-profile-note')).toBeHidden();
 await expect(d.locator('#editor-mode')).not.toContainText('保存前の実行準備');
 await expect(advanced).not.toHaveAttribute('open','');
 await expect(summary).toHaveText('詳細設定（技術担当向け）');
 await expect(advanced).toContainText('通常は変更不要です。自動取得と結果画面の『次にやること』で設定されます。');
 await summary.click();
 for(const text of ['公開ページの検査','管理設定の検査','自動取得と追加条件','共通の操作テスト','機能・運用の検査','REST APIの認証','ロール別の認証','その他の検査（詳細設定）'])await expect(advanced).toContainText(text);
 for(const sel of ['#refresh-automation','#login-path','#admin-path','#clear-browser','#auth-user','#add-role','#enable-operation-profile'])await expect(advanced.locator(sel)).toBeVisible();
 await summary.click();
 // 詳細設定に触れずに保存しても、画面に出していない値は残り、保存済みの設定は変わらない。
 // 1回目の保存は従来どおり操作テストの条件を画面の形式に整える（interactions等の既定値を追加）。2回目からは同じになること。
 await d.locator('#editor-save').click();await expect(d).not.toBeVisible();
 const before=await settings(id);
 assert.equal(before.profile.testEmail,'qa@example.test');assert.equal(before.profile.indexable,true);assert.equal(JSON.parse(store.record(id).sealed).publicPassword,'stored-view-password');
 await page.locator('#edit-site').click();await expect(d).toBeVisible();
 await d.locator('#editor-save').click();await expect(d).not.toBeVisible();
 assert.deepEqual(await settings(id),before);
 // 隠れた欄の入力エラー（ブラウザーの検証・保存時の検証）は、区画を開いて欄を示す。
 await page.locator('#edit-site').click();await expect(d).toBeVisible();
 await summary.click();await d.locator('#operation-profile-section>details>summary').click();
 const email=d.locator('#operation-profile-section [data-key=testEmail]');await email.fill('not-an-email');
 await d.locator('#operation-profile-section>details>summary').click();await summary.click();await expect(email).toBeHidden();
 await d.locator('#editor-save').click();await expect(advanced).toHaveAttribute('open','');await expect(email).toBeVisible();await expect(email).toBeFocused();
 await email.fill('qa@example.test');const timezone=d.locator('#operation-profile-section [data-key=timezone]');await timezone.fill('Not/AZone');
 await d.locator('#operation-profile-section>details>summary').click();await summary.click();await expect(timezone).toBeHidden();
 await d.locator('#editor-save').click();await expect(d.locator('#editor-error')).toHaveText('タイムゾーンが不正です');
 await expect(advanced).toHaveAttribute('open','');await expect(timezone).toBeVisible();await expect(timezone).toBeFocused();
 await d.locator('#editor-cancel').click();await expect(d).not.toBeVisible();
 assert.deepEqual(await settings(id),before);
 // 標準操作テスト未登録のサイトでは、検索エンジン・閲覧パスワードを出さない。
 await openSite('条件なしサイト');
 assert.deepEqual(await visibleControls(d),[...base,...tail]);
 await expect(d.locator('#settings-profile-note')).toBeVisible();await expect(d.locator('#settings-profile-note')).toHaveText('閲覧パスワードと検索エンジンの設定は、詳細設定で『WordPressの標準操作テストを登録する』を有効にすると変更できます。');
 // 詳細設定で標準操作テストを有効にすると、案内は消えて閲覧パスワード・検索エンジンが出る。
 await summary.click();await d.locator('#enable-operation-profile').check();await expect(d.locator('#settings-profile-note')).toBeHidden();await expect(d.locator('#settings-profile-basics [data-key=indexable]')).toBeVisible();
 await d.locator('#editor-cancel').click();await expect(d).not.toBeVisible();await openSite('条件なしサイト');
 const plainBefore=await settings(plain);
 await d.locator('#editor-save').click();await expect(d).not.toBeVisible();
 assert.deepEqual(await settings(plain),plainBefore);
 // 新規サイト（「詳細な検査設定を開く」）も最低限の項目だけを表示し、標準操作テストを登録する前提で既定値を入れる。
 await page.locator('#new-site').click();await page.locator('#registration-advanced-settings>summary').click();await page.locator('#registration-advanced').click();await expect(d).toBeVisible();
 assert.deepEqual(await visibleControls(d),[...base,'indexable','profile-public-password','profile-clear-public-password',...tail]);
 await expect(advanced).not.toHaveAttribute('open','');await expect(d.locator('#settings-profile-note')).toBeHidden();
 await expect(d.locator('#enable-operation-profile')).toBeChecked();
 for(const [key,value] of [['timezone','Asia/Tokyo'],['language','ja'],['adminPath','/wp-admin/']])await expect(d.locator(`#operation-profile-section [data-key=${key}]`)).toHaveValue(value);
 const newIndexable=d.locator('#settings-profile-basics [data-key=indexable]'),env=d.locator('#site-fields [data-key=environment]');
 await expect(newIndexable).not.toBeChecked();await env.selectOption('production');await expect(newIndexable).toBeChecked();await env.selectOption('staging');await expect(newIndexable).not.toBeChecked();
 await newIndexable.check();await env.selectOption('production');await env.selectOption('local');await expect(newIndexable).toBeChecked();
 await newIndexable.uncheck();await env.selectOption('production');await expect(newIndexable).not.toBeChecked();
 await d.locator('#editor-cancel').click();await expect(d).not.toBeVisible();
 // 登録済みサイトは環境を変えても保存済みの検索エンジンの値を変えない。
 await openSite('最小設定テスト');const savedIndexable=d.locator('#settings-profile-basics [data-key=indexable]');await expect(savedIndexable).toBeChecked();
 await d.locator('#site-fields [data-key=environment]').selectOption('local');await expect(savedIndexable).toBeChecked();await d.locator('#editor-cancel').click();await expect(d).not.toBeVisible();
 // AIが使えるときだけ「自動取得してClaudeで補完」を出す。
 fs.writeFileSync(aiFile,JSON.stringify({provider:'anthropic',enabled:true,approved:true,sealed:'sk-ant-fixture',model:'claude-sonnet-4-6',dailyLimit:20}));
 await openSite('最小設定テスト');
 await expect(d.locator('[data-propose]')).toBeVisible();
 assert.deepEqual(await visibleControls(d),[...base,'indexable','profile-public-password','profile-clear-public-password','data-budget','data-propose',...tail]);
 // スマホ幅：区画を閉じても開いてもはみ出さない。
 await page.setViewportSize({width:390,height:800});
 for(const open of [true,false]){
  await advanced.evaluate((el,open)=>el.open=open,open);
  const sizes=await page.evaluate(()=>{const dl=document.querySelector('dialog:has(#site-editor)'),b=dl.querySelector('.editor-body');return {page:document.documentElement.scrollWidth,body:[b.scrollWidth,b.clientWidth],dialog:[dl.scrollWidth,dl.clientWidth],right:dl.getBoundingClientRect().right};});
  assert(sizes.page<=390,JSON.stringify(sizes));assert(sizes.body[0]<=sizes.body[1],JSON.stringify(sizes));assert(sizes.dialog[0]<=sizes.dialog[1],JSON.stringify(sizes));assert(sizes.right<=390,JSON.stringify(sizes));
 }
 assert.deepEqual(errors,[]);
 console.log('PASS settings shows only minimal fields; advanced settings closed, untouched save keeps settings, hidden errors open the section, AI panel only when usable, 390px fits');
}finally{await browser.close();await app.close();fs.rmSync(scratch,{recursive:true,force:true});}
