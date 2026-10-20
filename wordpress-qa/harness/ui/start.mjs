import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUI } from './server.mjs';
import { startDemo } from '../examples/demo-server.mjs';
import { coveragePlan } from '../lib/checks/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const configPaths=[];let port=4310,demoServer,trustedAdapters={};
try {
  const args=process.argv.slice(2);
  for(let i=0;i<args.length;i+=2){
    if(args[i]==='--config'&&args[i+1])configPaths.push(path.resolve(args[i+1]));
    else if(args[i]==='--port'&&/^\d+$/.test(args[i+1]??''))port=Number(args[i+1]);
    else if(args[i]==='--adapters'&&args[i+1]) {
      const file=path.resolve(args[i+1]),value=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('Adapters must be an alias-to-module object');
      trustedAdapters=Object.fromEntries(Object.entries(value).map(([alias,module])=>{
        if(!/^[a-z][a-z0-9-]{0,63}$/.test(alias)||typeof module!=='string'||!module.trim())throw new Error('Invalid adapter alias or module path');
        return [alias,fs.realpathSync(path.resolve(path.dirname(file),module))];
      }));
    }
    else throw new Error('Usage: npm run ui -- [--config site.json] [--port 4310] [--adapters adapters.json]');
  }
  if(port<0||port>65535)throw new Error('Invalid port');
  const demo=!configPaths.length;
  if(demo){
    demoServer=await startDemo(0);
    const config=JSON.parse(fs.readFileSync(path.join(root,'examples/site.demo.json'),'utf8'));
    config.admin=JSON.parse(fs.readFileSync(path.join(root,'examples/admin.demo.json'),'utf8'));
    config.checks=coveragePlan();
    config.name='WordPress QA デモサイト';config.baseURL=demoServer.url;config.mailpit.url=demoServer.url;
    config.pages.forEach(p=>p.canonical=new URL(p.path,demoServer.url).href);
    config.journeys[0].module=path.join(root,'examples/contact.mjs');
    config.outputDir=path.join(root,'runs','ui-demo');config.baselineDir=path.join(root,'baselines','ui-demo');
    fs.mkdirSync(path.join(root,'.ui'),{recursive:true});const file=path.join(root,'.ui','demo.json');fs.writeFileSync(file,JSON.stringify(config,null,2));configPaths.push(file);
  }
  const app=await startUI({configPaths,port,demo,storeDir:path.join(root,'.ui','projects'),trustedAdapters});
  console.log(`WordPress QA Console: ${app.url}\n${demo?'Local demo included.':'Registered projects: '+configPaths.length}\nCtrl+C to stop (active run will finish first).`);
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;await app.close();if(demoServer)await demoServer.close();};
  process.on('SIGINT',close);process.on('SIGTERM',close);
}catch(e){console.error(e.message);if(demoServer)await demoServer.close();process.exitCode=1;}
