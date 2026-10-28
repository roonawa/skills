import {createServer} from 'node:http';import assert from 'node:assert/strict';import {chromium,request} from '@playwright/test';import {run} from '../lib/checks/standard.mjs';
const methods=[],server=createServer((req,res)=>{methods.push(req.method);res.setHeader('content-type','text/html');if(req.url.includes('__wpqa_missing_')){res.statusCode=404;res.end('missing');return;}res.end('<html lang="ja"><title>Fixture</title><body><h1 id="main">Fixture</h1><a href="#main">Main</a><form method="post"><label>Email<input type="email" required></label><button>Submit</button></form><script>fetch("/forbidden",{method:"POST",body:"must-not-send"}).catch(()=>{})</script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const baseURL=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();
try{
 const suites={metadata:'seo',navigation:'delivery',forms:'delivery',keyboard:'accessibility',integrations:'delivery',multilingual:'multilingual',performance:'performance',crawl:'seo'};
 for(const [area,suite] of Object.entries(suites)){
  const check={id:'test-'+area,kind:'standard-public',suite,options:{area,paths:['/']}};
  const result=await run({check,config:{baseURL,timeoutMs:5000},browser,requestFactory:request});assert.equal(result.errors.length,0);assert.equal(result.results.length,1);
 }
 assert(methods.every(m=>m==='GET'),'automatic tests must not send forms or script POSTs');console.log('All eight standard scopes passed; no POST requests reached fixture');
}finally{await browser.close();await new Promise(r=>server.close(r));}
