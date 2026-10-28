import {test} from 'node:test';import assert from 'node:assert/strict';
import {registrationTrace} from '../ui/registration-diagnostics.mjs';
test('stage diagnostics identify timeout without recording credentials or raw errors',async()=>{
 const events=[],trace=registrationTrace(e=>events.push(e));
 await assert.rejects(()=>trace.step('admin',async()=>{throw Error('Timeout 20000ms https://site/?nonce=secret-cookie password=secret');}),e=>e.stage==='admin'&&e.status===400&&/管理画面/.test(e.message)&&/TIMEOUT/.test(e.message));
 assert(!JSON.stringify(events).includes('secret'));assert.equal(events.at(-1).stage,'admin');assert.equal(events.at(-1).code,'TIMEOUT');assert.ok(events.at(-1).diagnosticId);
});
