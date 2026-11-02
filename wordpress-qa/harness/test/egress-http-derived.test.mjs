import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDestination} from '../lib/egress-policy.mjs';
const pub=async()=>[{address:'93.184.216.34',family:4}];
const priv=async()=>[{address:'10.0.0.5',family:4}];
const entries=[{origin:'https://example.com'}];
const ok={method:'GET',hasBody:false};
test('derived http GET / is allowed when same-host https origin exists',async()=>{
  const d=await resolveDestination('http://example.com/',entries,pub,ok);
  assert.equal(d.port,80);
});
test('derived http rejects other methods, paths, queries, bodies',async()=>{
  for(const [url,opt] of [['http://example.com/',{method:'POST',hasBody:false}],['http://example.com/wp-login.php',ok],['http://example.com/?a=1',ok],['http://example.com/',{method:'GET',hasBody:true}],['http://example.com:8080/',ok]])
    await assert.rejects(resolveDestination(url,entries,pub,opt),undefined,url);
});
test('derived http rejects private addresses',async()=>{
  await assert.rejects(resolveDestination('http://example.com/',entries,priv,ok));
});
test('derived http requires method option',async()=>{
  await assert.rejects(resolveDestination('http://example.com/',entries,pub));
});
test('explicit http rule with privateIPs unchanged',async()=>{
  const e=[{origin:'http://intra.local',privateIPs:['10.0.0.5']}];
  const d=await resolveDestination('http://intra.local/x',e,priv,{method:'POST',hasBody:true});
  assert.equal(d.address,'10.0.0.5');assert.equal(d.port,80);
  const d2=await resolveDestination('http://intra.local/x',e,priv);
  assert.equal(d2.address,'10.0.0.5');
});
