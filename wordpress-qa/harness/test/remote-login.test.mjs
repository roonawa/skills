import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteLogin} from '../ui/remote-login.mjs';

function fixture(ttlMs=60000){
  const calls=[],routes=[];let closed=0;
  const page={goto:async()=>{},screenshot:async()=>Buffer.from('image'),mouse:{click:async(...v)=>calls.push(v),wheel:async(...v)=>calls.push(v)},keyboard:{insertText:async v=>calls.push(v),press:async v=>calls.push(v)}};
  const context={route:async(pattern,fn)=>routes.push(fn),routeWebSocket:async()=>{},on(){},newPage:async()=>page};
  const login=new RemoteLogin({ttlMs,launch:async()=>({on(){},close:async()=>closed++,newContext:async()=>context})});
  return {login,calls,routes,closed:()=>closed};
}
test('remote login is private to authenticated owner, bounds commands and blocks off-origin requests',async()=>{
  const f=fixture(),options={baseURL:'https://example.test',environment:'staging'};
  try{
    const s=await f.login.startOwned(options,'alice');
    await assert.rejects(f.login.operate(s.id,'bob',{type:'frame'}),{status:403});
    await assert.rejects(f.login.operate(s.id,'alice',{type:'click',x:-1,y:2}));
    await assert.rejects(f.login.operate(s.id,'alice',{type:'key',key:'F12'}));
    await assert.rejects(f.login.operate(s.id,'alice',{type:'text',text:'x'.repeat(2049)}));
    await f.login.operate(s.id,'alice',{type:'text',text:'日本語'});assert.deepEqual(f.calls,['日本語']);
    assert.equal((await f.login.operate(s.id,'alice',{type:'frame'})).image,Buffer.from('image').toString('base64'));
    for(const [url,allowed] of [['https://example.test/wp-login.php',true],['https://other.test/',false],['http://example.test/',false],['https://user:pass@example.test/',false]]){
      let continued=false;await f.routes[0]({request:()=>({url:()=>url}),continue:()=>{continued=true;},abort:()=>{}});assert.equal(continued,allowed);
    }
    await assert.rejects(f.login.startOwned(options,'bob'));assert.equal(f.login.session.owner,'alice');
    assert(!JSON.stringify(f.login.status()).includes('日本語'));
  }finally{await f.login.close();}
});
test('remote login expires and clears browser and saved state',async()=>{
  const f=fixture(20);const s=await f.login.startOwned({baseURL:'https://example.test'},'alice');
  await new Promise(r=>setTimeout(r,70));assert.equal(f.login.busy,false);assert.equal(f.closed(),1);
  await assert.rejects(f.login.operate(s.id,'alice',{type:'frame'}),/期限切れ/);
});
