import fs from 'node:fs';
import {chromium,firefox,webkit} from '@playwright/test';
import {preparationReason} from './checks/index.mjs';
export function preflight(config,env=process.env){
 const issues=[],preparations=[];
 const issue=(id,message)=>issues.push({id,message});
 const need=(id,name)=>{if(!env[name])issue(id,'認証が未登録です: '+name);};
 for(const c of config.checks??[]){
  const o=c.options,id=c.id;
  const preparation=preparationReason(c,config);
  if(preparation){preparations.push({id,message:preparation});continue;}
  if(c.kind.startsWith('wp-')){
   if(config.environment==='production'||!config.allowTestWrites)issue(id,'検証環境とテストデータ変更の許可が必要です');
   if(!env[o.headersEnv??'WPQA_UI_ADMIN_HEADERS'])need(id,o.storageStateEnv??'WPQA_UI_ADMIN_STATE');
   if(['wp-lifecycle','wp-cache'].includes(c.kind))need(id,o.storageStateEnv??'WPQA_UI_ADMIN_STATE');
   if(config.headersEnv)need(id,config.headersEnv);
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
 return {ready:issues.length===0,issues,preparations,scope:'実行対象の設定とローカル環境を確認します。準備待ちは実行対象外ですが、未検証の必須観点として残ります。認証の有効期限や通信障害による実行不能を保証なく防げるものではありません。'};
}
