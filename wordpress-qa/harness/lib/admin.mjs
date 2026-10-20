import {isDeepStrictEqual} from 'node:util';
import {envHeaders} from './mailpit.mjs';
const blocked=message=>{throw new Error(`BLOCKED: ${message}`);};
export function readField(data,field) {
  for(const key of field.split('.')) {
    if(data===null||typeof data!=='object'||!Object.hasOwn(data,key))blocked('設定項目が取得結果にありません');
    data=data[key];
  }
  return data;
}
export function compareSetting(setting,actual) {
  return {expected:setting.sensitive?'[非表示]':setting.expected,actual:setting.sensitive?'[非表示]':actual,matched:isDeepStrictEqual(setting.expected,actual)};
}
export async function inspectSetting({setting:s,config:c,browser,requestFactory}) {
  const target=new URL(s.path,c.baseURL).href;
  if(s.source==='rest') {
    const client=await requestFactory.newContext({extraHTTPHeaders:envHeaders(s.headersEnv),timeout:c.timeoutMs});
    try {
      const response=await client.get(target,{maxRedirects:0});
      if(response.status()!==200)blocked(`設定API HTTP ${response.status()}。認証・権限・URLを確認してください`);
      if(!response.headers()['content-type']?.includes('application/json'))blocked('設定APIがJSONを返しません');
      return readField(await response.json(),s.field);
    }catch(error){if(error.message.startsWith('BLOCKED:'))throw error;blocked('設定APIの取得に失敗しました');}
    finally{await client.dispose();}
  }
  let context;
  try {
    const storageState=s.storageStateEnv?process.env[s.storageStateEnv]:undefined;
    if(s.storageStateEnv&&!storageState)blocked('認証状態ファイルの環境変数が未設定です');
    context=await browser.newContext({storageState:storageState?.trim().startsWith('{')?JSON.parse(storageState):storageState,serviceWorkers:'block',javaScriptEnabled:false});
    // A dedicated context has no trace/screenshot capture or inherited auth headers.
    // Only the registered settings document and its static assets may be requested.
    await context.route('**/*',route=>{
      const req=route.request(),u=new URL(req.url());
      const allowed=u.origin===c.baseURL&&req.method()==='GET'&&(req.resourceType()==='document'?u.href===target:['stylesheet','image','font'].includes(req.resourceType()));
      return allowed?route.continue():route.abort();
    });
    const page=await context.newPage();page.setDefaultTimeout(c.timeoutMs);
    const response=await page.goto(target,{timeout:c.timeoutMs});
    if(response?.status()!==200||page.url()!==target)blocked('管理画面を開けません。認証・権限・URLを確認してください');
    if(!await page.locator(s.authenticatedSelector).isVisible())blocked('管理画面のログイン状態を確認できません');
    const locator=page.locator(s.selector);
    if(await locator.count()!==1)blocked('設定項目を一意に取得できません');
    if(s.read==='checked')return await locator.isChecked();
    if(s.read==='text')return (await locator.innerText()).trim();
    return await locator.inputValue();
  }catch(error){if(error.message.startsWith('BLOCKED:'))throw error;blocked('管理画面から設定を取得できません');}
  finally{await context?.close();}
}
