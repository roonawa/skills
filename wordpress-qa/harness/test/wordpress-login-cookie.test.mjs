import test from 'node:test';
import assert from 'node:assert/strict';
import {isLoggedInCookie,wordpressSessionStatus} from '../lib/wordpress-session.mjs';

// サーバーがクッキー名に接頭辞を付ける場合（例：ENC_wordpress_logged_in_…）もログイン済みと認める。
test('logged-in cookie is recognised with or without a server prefix',()=>{
 for(const name of ['wordpress_logged_in_0123abcd','ENC_wordpress_logged_in_0123abcd'])assert.equal(isLoggedInCookie({name,value:'v'}),true,name);
 for(const c of [{name:'wordpress_logged_in_0123abcd',value:''},{name:'wordpress_test_cookie',value:'v'},{name:'ENC_wordpress_test_cookie',value:'v'},{name:'xwordpress_logged_in_1',value:'v'},{name:'wp-settings-1',value:'v'}])assert.equal(isLoggedInCookie(c),false,c.name);
});
test('session expiry is read from prefixed auth cookies too',()=>{
 const exp=Math.floor(Date.UTC(2030,0,1)/1000),value=encodeURIComponent(`admin|${exp}|token|hmac`);
 for(const name of ['wordpress_sec_0123abcd','ENC_wordpress_sec_0123abcd'])assert.equal(wordpressSessionStatus({cookies:[{name,value,path:'/wp-admin'}]}).expiresAt,new Date(exp*1000).toISOString(),name);
});
