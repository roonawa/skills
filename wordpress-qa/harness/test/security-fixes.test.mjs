import test from 'node:test';
import assert from 'node:assert/strict';
import {mailHeaders} from '../lib/mailpit.mjs';
import {createSharedAccess,hashPassword} from '../ui/shared-access.mjs';
test('mail credentials require dedicated purpose and exact origin',()=>{
  const env={WPQA_UI_ADMIN_HEADERS:'{"Authorization":"secret"}',WPQA_MAIL_TEST_HEADERS:'{"Authorization":"mail"}',WPQA_MAIL_TEST_HEADERS_ORIGIN:'https://mail.example.test'};
  assert.throws(()=>mailHeaders({url:'https://evil.test',headersEnv:'WPQA_UI_ADMIN_HEADERS'},env));
  assert.throws(()=>mailHeaders({url:'https://evil.test',headersEnv:'WPQA_MAIL_TEST_HEADERS'},env));
  assert.deepEqual(mailHeaders({url:'https://mail.example.test',headersEnv:'WPQA_MAIL_TEST_HEADERS'},env),{Authorization:'mail'});
});
test('failed passwords cannot lock out a legitimate account',async()=>{
  const access=createSharedAccess({origin:'https://qa.test',users:[{name:'user',...hashPassword('correct-password-long')}]});
  const req=p=>({socket:{remoteAddress:'127.0.0.1'},headers:{host:'qa.test',authorization:'Basic '+Buffer.from('user:'+p).toString('base64')}});
  for(let i=0;i<12;i++)await assert.rejects(()=>access.authenticate(req('incorrect')));
  assert.equal((await access.authenticate(req('correct-password-long'))).name,'user');
});
