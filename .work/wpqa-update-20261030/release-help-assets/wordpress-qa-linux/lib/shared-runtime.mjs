// Imported before application code in the hardened shared deployment and children.
import {setGlobalDispatcher,ProxyAgent} from 'undici';
import {chromium,firefox,webkit,request} from '@playwright/test';
if(process.env.WPQA_EGRESS_PROXY){
  const proxy={server:process.env.WPQA_EGRESS_PROXY};
  setGlobalDispatcher(new ProxyAgent(proxy.server));
  const create=request.newContext.bind(request);
  request.newContext=options=>create({...options,proxy});
  for(const [name,type] of Object.entries({chromium,firefox,webkit})){
    type.launch=async()=>{
      const endpoint=process.env['WPQA_BROWSER_'+name.toUpperCase()];
      if(!endpoint)throw Error('BLOCKED: このブラウザーの隔離ワーカーは未設定です');
      return type.connect(endpoint,{timeout:30000});
    };
    type.launchPersistentContext=async()=>{throw Error('共有版では永続ブラウザープロファイルは使用できません');};
  }
}
