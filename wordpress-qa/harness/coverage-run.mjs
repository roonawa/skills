import {request} from '@playwright/test';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {authenticate} from '../../debug-evidence/mannendo-staging/operations/common.mjs';
const file=path.resolve('../../debug-evidence/mannendo-staging/site.json'),c=JSON.parse(fs.readFileSync(file));
const headers=await authenticate(c,{request});const env={...process.env,[c.headersEnv]:JSON.stringify(headers),WPQA_OPERATION_ID:'suite',WPQA_OPERATION_MODE:'preview'};
const tmp=path.join(os.tmpdir(),'mannendo-qa-admin-'+Date.now()+'.json');
try{
 if(process.env.WPQA_ADMIN_PASSWORD){
  const cookies=headers.Cookie.split('; ').map(pair=>{const pos=pair.indexOf('=');return {name:pair.slice(0,pos),value:pair.slice(pos+1),domain:new URL(c.baseURL).hostname,path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'};});const client=await request.newContext({baseURL:c.baseURL,storageState:{cookies,origins:[]}});
  try{const login=await client.get('/wp-login.php');if((await login.text()).includes('siteguard_captcha')){console.log('Admin blocked: SiteGuard CAPTCHA requires an authenticated QA browser session.');}else{await client.post('/wp-login.php',{form:{log:'mannendoec_test',pwd:process.env.WPQA_ADMIN_PASSWORD,'wp-submit':'ログイン',redirect_to:c.baseURL+'/wp-admin/',testcookie:'1'}});const r=await client.get('/wp-admin/options-reading.php');if((await r.text()).includes('id="blog_public"')){env.WPQA_MANNENDO_ADMIN_STATE=JSON.stringify(await client.storageState());console.log('Admin authentication verified; state kept only in child environment.');}else console.log('Admin authentication unavailable; admin cases remain blocked.');}}finally{await client.dispose();}
 }
 delete env.WPQA_ADMIN_PASSWORD;
 if(process.argv[2]==='auth-only'){console.log(env.WPQA_MANNENDO_ADMIN_STATE?'AUTH_OK':'AUTH_BLOCKED');process.exit(env.WPQA_MANNENDO_ADMIN_STATE?0:2);}
 const child=spawn(process.execPath,['bin/qa.mjs','run','--config',file,'--suite',process.argv[2]??'all',...(process.argv[3]?['--id',process.argv[3]]:[])],{env,stdio:'inherit',windowsHide:true});process.exitCode=await new Promise(r=>child.on('exit',r));
}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
