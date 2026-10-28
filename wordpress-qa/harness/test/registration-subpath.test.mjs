import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registrationTarget} from '../ui/public/registration.js';
import {registrationConfig} from '../ui/registration.mjs';
test('subdirectory site input becomes origin and scoped paths, preserving custom login',()=>{
 assert.deepEqual(registrationTarget('https://example.test/retemp','/wp-login.php','/wp-admin/'),{baseURL:'https://example.test',sitePath:'/retemp/',loginPath:'/retemp/wp-login.php',adminPath:'/retemp/wp-admin/'});
 assert.equal(registrationTarget('https://example.test/retemp/','/custom-login','/retemp/wp-admin/').loginPath,'/custom-login');
 assert.throws(()=>registrationTarget('https://example.test/retemp?secret=x'),/URL/);
});
test('subdirectory homepage expectation and performance test retain site scope',()=>{
 const c=registrationConfig({name:'Subsite',baseURL:'https://example.test',environment:'staging',profile:{sitePath:'/retemp/',adminPath:'/retemp/wp-admin/',timezone:'Asia/Tokyo',language:'ja',indexable:false,performanceMs:1000},discovery:{pages:[{path:'/retemp/'}],warnings:[]}});
 assert.equal(c.admin.find(a=>a.id==='home').expected,'https://example.test/retemp');
 assert.equal(c.checks.find(a=>a.id==='registration-performance').options.path,'/retemp/');
});
