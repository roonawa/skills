import test from 'node:test';import assert from 'node:assert/strict';
import {createSharedAccess,hashPassword} from '../ui/shared-access.mjs';
test('authentication yields the event loop and bounds simultaneous expensive checks',async()=>{
 const access=createSharedAccess({origin:'https://qa.test',users:[{name:'user',...hashPassword('correct-password-long')}]});
 const req=password=>({headers:{host:'qa.test',authorization:'Basic '+Buffer.from('user:'+password).toString('base64')}});
 const pending=[access.authenticate(req('wrong-one')).catch(e=>e),access.authenticate(req('wrong-two')).catch(e=>e)];
 await assert.rejects(access.authenticate(req('wrong-three')),e=>e.status===429);
 assert.ok((await Promise.all(pending)).every(e=>e.status===401));
 assert.equal((await access.authenticate(req('correct-password-long'))).name,'user');
});
