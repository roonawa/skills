import {chromium,firefox} from '@playwright/test';
const engine=process.env.WPQA_ENGINE??'chromium',type={chromium,firefox}[engine];
if(!type)throw Error('unsupported engine');
const server=await type.launchServer({headless:true,host:'0.0.0.0',port:3000,wsPath:'/browser',...(engine==='chromium'?{chromiumSandbox:true}:{}),proxy:{server:'http://egress:3128'}});
console.log('Isolated browser ready');
process.on('SIGTERM',()=>server.close());
