import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {chromium} from '@playwright/test';
import {validate,run} from '../lib/checks/workflows.mjs';

const requestStep={action:'assertRequest',url:'/collect',method:'POST',query:{event:'checkout'},body:{event:'purchase',amount:7,consent:true},count:1,timeoutMs:800,settleMs:200};
const checkFor=step=>({kind:'browser-flow',suite:'delivery',options:{steps:[step]}});

test('assertRequest schema requires exact endpoints, scalar parameters, counts and bounded waits',()=>{
 const config={baseURL:'https://example.test'};
 validate(checkFor(requestStep),config);
 validate(checkFor({...requestStep,count:0,body:{empty:null}}),config);
 for(const patch of [{url:'https://example.test/*'},{url:'/collect?event=x'},{url:'https://user:password@example.test/collect'},{url:'javascript:alert(1)'},{url:'http://untrusted.test/collect'},{url:'//other.test/collect'},{url:'/collect#fragment'},{method:undefined},{method:'post'},{count:-1},{count:1.1},{query:{event:['purchase']}},{body:{event:{nested:true}}},{body:{amount:Infinity}},{timeoutMs:30001},{settleMs:0},{timeoutMs:100,settleMs:200},{selector:'body'}])assert.throws(()=>validate(checkFor({...requestStep,...patch}),config));
 assert.throws(()=>validate(checkFor({action:'assertText',selector:'h1',value:'yes',query:{event:'purchase'}}),config));
});

test('real requests verify endpoint, method, query/body and counts without storing payloads',async t=>{
 const received=[];
 const collector=http.createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;received.push({path:req.url,method:req.method,text});
  if(req.url.startsWith('/failed')){req.socket.destroy();return;}
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','content-type');
  res.setHeader('Content-Type','text/plain');
  if(req.url.startsWith('/slow')){setTimeout(()=>res.end('ok'),600);return;}
  res.end('ok');
 });
 await new Promise(r=>collector.listen(0,'127.0.0.1',r));const external=`http://127.0.0.1:${collector.address().port}`;
 const site=http.createServer((req,res)=>{
  const mode=new URL(req.url,'http://fixture').searchParams.get('mode')??'one';
  res.setHeader('Content-Type','text/html');
  res.end(`<button id="send">send</button><p>ready</p><script>
   const mode=${JSON.stringify(mode)},external=${JSON.stringify(external)};
   function send(){
    const path=mode==='wrongpath'?'/collect-other':mode==='failed'?'/failed':mode==='slow'?'/slow':'/collect';
    const query=mode==='wrongquery'?'other':'checkout';
    const data={event:mode==='wrongbody'?'other':'purchase',amount:7,consent:true,private:'payload-secret-value'};
    const form=mode==='form';
    fetch(external+path+'?event='+query+'&extra=ignored',{method:mode==='get'?'GET':'POST',headers:form?{'Content-Type':'application/x-www-form-urlencoded'}:{'Content-Type':'application/json'},...(mode==='get'?{}:{body:form?new URLSearchParams({event:'purchase',amount:'7'}):JSON.stringify(data)})}).catch(()=>{});
   }
   document.querySelector('button').onclick=()=>{if(mode==='none')return;if(mode==='late'){setTimeout(send,150);return;}send();if(mode==='duplicate')setTimeout(send,100);};
  </script>`);
 });
 await new Promise(r=>site.listen(0,'127.0.0.1',r));const baseURL=`http://127.0.0.1:${site.address().port}`;
 const browser=await chromium.launch();const config={baseURL,environment:'local',allowTestWrites:true,timeoutMs:1000};
 const execute=(mode,patch={},options={},signal)=>{
  const step={...requestStep,url:external+'/collect',...patch};
  const check={kind:'browser-flow',suite:'delivery',options:{sandbox:true,allowedInteractionOrigins:[external],steps:[{action:'goto',url:'/?mode='+mode},{action:'click',selector:'#send'},step],...options}};
  const events=[];return run({check,config,browser,token:'request-token-123',signal,record:e=>events.push(e)}).then(result=>({result,events}));
 };
 try{
  await t.test('positive exact expected values and redacted count evidence',async()=>{
   const {result,events}=await execute('one');assert.equal(result.steps.at(-1).passed,true);
   assert.deepEqual(events.at(-1).actual,{count:1,pending:0,failed:0});
   assert(!JSON.stringify({result,events}).includes('payload-secret-value'));assert(!JSON.stringify(events).includes('purchase'));assert(!JSON.stringify(events).includes(external));
   assert(received.some(r=>r.text.includes('payload-secret-value')));
  });
  await t.test('wrong endpoint, method, query and typed body cannot pass',async()=>{
   for(const [mode,patch] of [['wrongpath',{}],['wrongquery',{}],['wrongbody',{}],['one',{method:'GET'}],['one',{body:{amount:'7'}}]])await assert.rejects(execute(mode,{timeoutMs:300,settleMs:50,...patch},{allowedResourceOrigins:[external]}),/count differs/);
  });
  await t.test('duplicates during settle and delayed events during zero window fail',async()=>{
   await assert.rejects(execute('duplicate'),/exceeds/);
   await assert.rejects(execute('late',{count:0,timeoutMs:400,settleMs:50}),/exceeds/);
   const start=Date.now();await execute('none',{count:0,timeoutMs:250,settleMs:50});assert(Date.now()-start>=250);
  });
  await t.test('form body and externally allowed GET query work',async()=>{
   await execute('form',{body:{event:'purchase',amount:'7'}});
   await execute('get',{method:'GET',body:undefined},{allowedResourceOrigins:[external]});
  });
  await t.test('denied origins, failed and in-flight requests never count as a pass',async()=>{
   const start=received.length;await assert.rejects(execute('one',{}, {allowedInteractionOrigins:[]}),/not explicitly allowed/);assert.equal(received.length,start);
   await assert.rejects(execute('failed',{url:external+'/failed',count:0}),/matching request failed/);
   await assert.rejects(execute('slow',{url:external+'/slow',count:0,timeoutMs:150,settleMs:50}),/still pending/);
  });
  await t.test('cancelled bounded wait stops and records no request payload',async()=>{
   const controller=new AbortController();setTimeout(()=>controller.abort(),150);
   await assert.rejects(execute('none',{}, {},controller.signal),error=>{assert.equal(error.name,'AbortError');assert(!JSON.stringify(error.qaEvidence).includes('payload-secret'));return true;});
  });
 }finally{await browser.close();site.closeAllConnections();collector.closeAllConnections();await Promise.all([new Promise(r=>site.close(r)),new Promise(r=>collector.close(r))]);}
});

