import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import {BrowserLogin} from '../ui/browser-login.mjs';

// Some plugins (e.g. All in One SEO's author tabs) hide the profile form until JavaScript runs.
// The login check opens the profile without JavaScript, so it must not depend on visibility,
// and a <noscript> meta refresh on the page must not count as leaving the profile.
const COOKIE='wordpress_logged_in_fixture';
let subdir=false;
const site=createServer((req,res)=>{
  const url=new URL(req.url,'http://x'),logged=req.headers.cookie?.includes(COOKIE+'=ok');
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(url.pathname==='/wp-login.php')return res.end('<form>login</form>');
  // A second site layout: WordPress installed under /wp/, while /wp-admin/ only redirects to the top page.
  if(url.pathname==='/wp/wp-admin/'){if(!logged){res.statusCode=302;res.setHeader('Location','/');return res.end();}return res.end('<body class="wp-admin"><div id="wpadminbar">bar</div>dashboard</body>');}
  if(url.pathname==='/wp/wp-admin/profile.php'){if(!logged){res.statusCode=302;res.setHeader('Location','/');return res.end();}return res.end('<body class="wp-admin"><div id="wpadminbar">bar</div><form id="your-profile">profile</form></body>');}
  if(url.pathname==='/wp-admin/profile.php'&&subdir){res.statusCode=301;res.setHeader('Location','/');return res.end();}
  if(url.pathname==='/wp-admin/profile.php'){
    if(!logged){res.statusCode=302;res.setHeader('Location','/wp-login.php');return res.end();}
    return res.end('<html><head><style>#your-profile{display:none}</style></head><body class="wp-admin"><div id="wpadminbar">bar</div><noscript><meta http-equiv="refresh" content="0;url=/wp-admin/no-js.php"></noscript><div class="aioseo-tabs"></div><form id="your-profile">profile</form><script>document.getElementById("your-profile").style.display="block"</script></body></html>');
  }
  res.statusCode=404;res.end();
});
await new Promise(r=>site.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${site.address().port}`;
const open=async()=>{const login=new BrowserLogin({launch:()=>chromium.launch()});const {id}=await login.start({baseURL:base,environment:'local'});return {login,id};};
try{
  {
    const {login,id}=await open();
    await login.session.context.addCookies([{name:COOKIE,value:'ok',url:base}]);
    assert.equal((await login.verify(id)).phase,'verified');
    await login.close();
  }
  {
    const {login,id}=await open();
    await assert.rejects(login.verify(id),e=>/^ログインを確認できません。/.test(e.message)&&/ログイン用のクッキー/.test(e.message));
    await login.session.context.addCookies([{name:COOKIE,value:'bad',url:base}]);
    await assert.rejects(login.verify(id),e=>/^ログインを確認できません。/.test(e.message)&&/プロフィール画面/.test(e.message)&&!/bad/.test(e.message));
    await login.close();
  }
  {
    // WordPress under /wp/: the check follows the admin path shown in the logged-in browser.
    subdir=true;
    const {login,id}=await open();
    await login.session.context.addCookies([{name:COOKIE,value:'ok',url:base}]);
    await login.session.page.goto(base+'/wp/wp-admin/');
    const result=await login.verify(id);
    assert.equal(result.phase,'verified');assert.equal(result.adminPath,'/wp/wp-admin/');assert.equal(login.adminPathOf(id),'/wp/wp-admin/');
    await login.close();subdir=false;
  }
  console.log('PASS hidden profile form, failure reasons and WordPress in a subfolder');
}finally{await new Promise(r=>site.close(r));}
