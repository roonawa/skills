export async function preparePublicGate(config,env=process.env){
 if(config.headersEnv!=='WPQA_UI_PUBLIC_HEADERS'||!env.WPQA_UI_SITE_PASSWORD)return;
 const sitePath=config.sitePath??JSON.parse(env.WPQA_UI_PROFILE||'{}').sitePath??'/';
 if(!/^\/(?:[a-zA-Z0-9_%-]+\/)*$/.test(sitePath)||/%(?:2e|2f|5c)/i.test(sitePath))throw Error('公開サイトのパスが不正です');
 const {request}=await import('@playwright/test');const client=await request.newContext({baseURL:config.baseURL,timeout:15000});
 try{const r=await client.get(sitePath+'?password-protected=login',{maxRedirects:0});if(r.status()>=400)throw Error('BLOCKED: サイト閲覧認証画面を取得できません');
 if(r.status()===200&&!/name=["']password_protected_pwd/.test(await r.text()))return {required:false};
 if(r.status()!==200)throw Error('BLOCKED: サイト閲覧認証画面を取得できません');
 await client.post(sitePath+'?password-protected=login',{form:{password_protected_pwd:env.WPQA_UI_SITE_PASSWORD,password_protected_cookie_test:'1','password-protected':'login',redirect_to:config.baseURL+sitePath},maxRedirects:0});
 const cookies=(await client.storageState()).cookies.filter(c=>c.domain.replace(/^\./,'')===new URL(config.baseURL).hostname&&/password_protected/.test(c.name)&&c.name!=='password_protected_cookie_test');
 if(!cookies.length)throw Error('BLOCKED: 登録したサイト閲覧パスワードを確認してください');
 env.WPQA_UI_PUBLIC_HEADERS=JSON.stringify({Cookie:cookies.map(c=>c.name+'='+c.value).join('; ')});
 return {required:true};
 }finally{await client.dispose();}
}
