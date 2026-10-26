import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {preparePublicGate} from '../lib/registration-gate.mjs';

test('public protection saves only the gate cookie and rejects an incorrect password',async()=>{
 const received=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  received.push({method:req.method,authorization:req.headers.authorization,cookie:req.headers.cookie});
  if(req.method==='GET')res.setHeader('Set-Cookie','password_protected_cookie_test=1; Path=/');
  else if(new URLSearchParams(body).get('password_protected_pwd')==='fixture-password')res.setHeader('Set-Cookie',['bid_1_password_protected_auth=gate-value; Path=/','wordpress_logged_in_fixture=must-not-export; Path=/']);
  res.end('fixture');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const config={baseURL:`http://127.0.0.1:${server.address().port}`,headersEnv:'WPQA_UI_PUBLIC_HEADERS'};
 try{
  const env={WPQA_UI_SITE_PASSWORD:'fixture-password',WPQA_UI_ADMIN_HEADERS:'secret-admin'};
  await preparePublicGate(config,env);
  assert.deepEqual(JSON.parse(env.WPQA_UI_PUBLIC_HEADERS),{Cookie:'bid_1_password_protected_auth=gate-value'});
  assert(received.every(r=>!r.authorization&&!String(r.cookie).includes('secret-admin')));
  await assert.rejects(()=>preparePublicGate(config,{WPQA_UI_SITE_PASSWORD:'wrong'}),/閲覧パスワード/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
