import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium,request} from '@playwright/test';
import {run} from '../lib/checks/standard.mjs';

const methods=[];
const server=createServer((req,res)=>{
 methods.push(req.method);
 if(req.url==='/slow'){setTimeout(()=>res.end('done'),150);return;}
 if(req.url==='/unavailable'){res.writeHead(503);res.end();return;}
 res.setHeader('content-type','text/html');
 res.end('<form novalidate><input type="email" required><button>Send</button></form><script>fetch("/slow");fetch("/write",{method:"POST"}).catch(()=>{});</script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch(),baseURL=`http://127.0.0.1:${server.address().port}`;
const check=(area,path='/')=>run({check:{kind:'standard-public',suite:area==='performance'?'performance':'delivery',options:{area,paths:[path]}},config:{baseURL,timeoutMs:2000},browser,requestFactory:request});
try{
 for(let i=0;i<5;i++){
  const result=await check('forms');
  assert.equal(result.reviewRequired,true);
  assert.match(result.reviewReason,/送信なし/);
  assert.deepEqual(result.errors,[]);
  assert.equal((await check('performance')).errors.length,0);
 }
 await assert.rejects(check('performance','/unavailable'),/BLOCKED: 参考測定/);
 assert(methods.every(method=>method==='GET'));
 console.log('Delayed routes completed for 10 checks; novalidate requires review; failed reference measurement blocks; no POST forwarded.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
