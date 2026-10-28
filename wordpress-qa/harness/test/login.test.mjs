import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BrowserLogin,loginTarget,scopeState} from '../ui/browser-login.mjs';
test('trusted restart snapshot restores verified state without opening a browser',async()=>{
 const resume={id:'resumed',baseURL:'https://example.test',environment:'staging',phase:'verified',state:{cookies:[{domain:'example.test',path:'/',name:'wordpress_logged_in_x',value:'fixture'}],origins:[]}};
 const login=new BrowserLogin({resume});assert.equal(login.status().phase,'verified');assert.equal((await login.verify('resumed')).phase,'verified');assert(!JSON.stringify(login.status()).includes('fixture'));await login.close();
});
test('login targets normalize origin and reject off-site or insecure destinations',()=>{
 const t=loginTarget({baseURL:'https://example.test/',loginPath:'/blog/wp-login.php',adminPath:'/blog/wp-admin/'});
 assert.equal(t.profileURL,'https://example.test/blog/wp-admin/profile.php');
 for(const bad of [{baseURL:'http://example.test',environment:'local'},{baseURL:'https://example.test/path'},{baseURL:'https://example.test',loginPath:'https://evil.test/'},{baseURL:'https://example.test',adminPath:'/wp-admin/?action=delete'}])assert.throws(()=>loginTarget(bad));
 assert.equal(loginTarget({baseURL:'http://127.0.0.1:1234',environment:'local'}).baseURL,'http://127.0.0.1:1234');
});
test('verified state is bound to site/project and consumed only after successful persistence',()=>{
 const login=new BrowserLogin();login.session={id:'test',phase:'verified',baseURL:'https://example.test',projectId:'project',state:{cookies:[],origins:[]}};
 assert.ok(!JSON.stringify(login.status()).includes('cookies'));
 assert.throws(()=>login.save('test',{baseURL:'https://evil.test',projectId:'project'},()=>{}),/一致/);
 assert.throws(()=>login.save('test',{baseURL:'https://example.test',projectId:'other'},()=>{}),/一致/);
 assert.throws(()=>login.save('test',{baseURL:'https://example.test',projectId:'project'},()=>{throw Error('write failed');}),/write failed/);
 assert.equal(login.busy,true);
 assert.equal(login.save('test',{baseURL:'https://example.test',projectId:'project'},()=>123),123);assert.equal(login.busy,false);
 assert.throws(()=>login.get('test'),/期限切れ/);
});
test('timeout closes the isolated browser and releases the login slot',async()=>{
 let closed=0;const login=new BrowserLogin({ttlMs:25,launch:async()=>({on(){},close:async()=>{closed++;},newContext:async()=>({newPage:async()=>({goto:async()=>{}})})})});
 await login.start({baseURL:'https://example.test'});
 await assert.rejects(()=>login.start({baseURL:'https://example.test'}),/進行中/);
 await new Promise(r=>setTimeout(r,60));assert.equal(login.busy,false);assert.equal(closed,1);
});
test('only target cookies and storage are captured, parent cookies are scoped to target host',()=>{
 const s=scopeState({cookies:[{domain:'.example.test',name:'wordpress_logged_in_x',value:'session'},{domain:'idp.test',name:'sso',value:'secret'}],origins:[{origin:'https://www.example.test',localStorage:[]},{origin:'https://idp.test',localStorage:[]}]},'https://www.example.test');
 assert.equal(s.cookies.length,1);assert.equal(s.cookies[0].domain,'www.example.test');assert.equal(s.origins.length,1);assert.ok(!JSON.stringify(s).includes('secret'));
});
