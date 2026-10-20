import {test} from 'node:test';
import assert from 'node:assert/strict';
import {networkPolicy,validateNetworkPolicy} from '../lib/network-policy.mjs';
test('origins must be exact and HTTPS except loopback',()=>{
  for(const origin of ['https://*.example.com','https://example.com/','http://example.com','https://user:secret@example.com']) {
    assert.throws(()=>validateNetworkPolicy({allowedResourceOrigins:[origin]}));
  }
});
test('resource, navigation and interaction permissions are independent',()=>{
  const p=networkPolicy('https://site.test',{allowedResourceOrigins:['https://cdn.test'],allowedNavigationOrigins:['https://pay.test'],allowedInteractionOrigins:['https://pay.test']});
  assert.equal(p.allowed('https://cdn.test/x','GET',false),true);
  assert.equal(p.allowed('https://cdn.test/x','POST',false),false);
  assert.equal(p.allowed('https://cdn.test/x','GET',true),false);
  assert.equal(p.allowed('https://pay.test/x','POST',true),true);
  assert.equal(p.allowed('https://evil.test/x','GET',false),false);
});
test('foreign fetch strips credentials and refuses redirect before following it',async()=>{
  let fetched=false,aborted=false;
  const p=networkPolicy('http://127.0.0.1:8000',{allowedResourceOrigins:['http://127.0.0.1:8001']},{newContext:async()=>({
    dispose:async()=>{},
    fetch:async(url,options)=>{fetched=true;assert.equal(options.maxRedirects,0);assert.equal(options.headers.cookie,'');assert.equal(options.headers.authorization,'');assert.equal(options.headers['x-api-key'],undefined);
      return {headers:()=>({location:'https://evil.test/'}),status:()=>302};},
  })});
  await p.route({
    request:()=>({url:()=> 'http://127.0.0.1:8001/asset',method:()=> 'GET',isNavigationRequest:()=>false,postDataBuffer:()=>null,
      allHeaders:async()=>({cookie:'secret',authorization:'Bearer secret','x-api-key':'secret',accept:'*/*'})}),
    abort:async()=>{aborted=true;},
  });
  assert.ok(fetched&&aborted);
});
