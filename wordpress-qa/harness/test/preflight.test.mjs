import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preflight} from '../lib/preflight.mjs';
test('preflight identifies missing prerequisites without certifying network authentication',()=>{
 const config={environment:'production',allowTestWrites:false,checks:[
  {id:'auth',kind:'wp-authz',options:{role:'subscriber'}},
  {id:'ops',kind:'operation-drill',options:{adapter:'restore'}},
  {id:'todo',kind:'unconfigured',options:{instructions:'期待値を設定'}}
 ]};
 const r=preflight(config,{});
 assert.equal(r.ready,false);
 assert(r.issues.some(i=>i.message.includes('WPQA_ROLE_SUBSCRIBER_HEADERS')));
 assert(r.issues.some(i=>i.message.includes('アダプター')));
 assert(r.issues.some(i=>i.id==='todo'));
 assert(r.scope.includes('保証するものではありません'));
 config.environment='local';config.allowTestWrites=true;config.trustedAdapters={restore:'test.mjs'};config.checks.pop();
 assert.equal(preflight(config,{WPQA_UI_ADMIN_HEADERS:'{}',WPQA_ROLE_SUBSCRIBER_HEADERS:'{}'}).ready,true);
});
