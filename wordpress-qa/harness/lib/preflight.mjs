import fs from 'node:fs';
import {chromium,firefox,webkit} from '@playwright/test';
export function preflight(config,env=process.env){
 const issues=[];
 const issue=(id,message)=>issues.push({id,message});
 const need=(id,name)=>{if(!env[name])issue(id,'認証が未登録です: '+name);};
 for(const c of config.checks??[]){
  const o=c.options,id=c.id;
  if(c.kind==='unconfigured')issue(id,o.instructions);
  if(c.kind.startsWith('wp-')){
   if(config.environment==='production'||!config.allowTestWrites)issue(id,'検証環境とテストデータ変更の許可が必要です');
   need(id,o.headersEnv??'WPQA_UI_ADMIN_HEADERS');
   if(['wp-lifecycle','wp-cache'].includes(c.kind))need(id,o.storageStateEnv??'WPQA_UI_ADMIN_STATE');
   if(c.kind==='wp-authz')need(id,o.roleHeadersEnv??'WPQA_ROLE_'+o.role.toUpperCase().replaceAll('-','_')+'_HEADERS');
   for(const role of o.cacheRoles??[])need(id,role.storageStateEnv);
  }
  if(c.kind==='browser-flow'){
   if(o.roleEnv)need(id,o.roleEnv);
   if(o.steps.some(s=>['fill','click','check','select','press','setInputFiles'].includes(s.action))&&(config.environment==='production'||!config.allowTestWrites))issue(id,'操作検査には検証環境とテストデータ変更の許可が必要です');
  }
  if(c.kind==='operation-drill'){
   if(!config.trustedAdapters?.[o.adapter])issue(id,'運用アダプターが未登録です: '+o.adapter);
   if(config.environment==='production'||!config.allowTestWrites)issue(id,'運用検査には検証環境とテストデータ変更の許可が必要です');
  }
  if(c.kind==='compatibility-screen'&&!fs.existsSync(({chromium,firefox,webkit})[o.engine].executablePath()))issue(id,'ブラウザーをインストールしてください: '+o.engine);
 }
 for(const a of config.admin??[]){const name=a.source==='rest'?a.headersEnv:a.storageStateEnv;if(name)need(a.id,name);}
 return {ready:issues.length===0,issues,scope:'設定とローカル実行環境の確認です。サイトの認証成功や検査合格を保証するものではありません。'};
}
