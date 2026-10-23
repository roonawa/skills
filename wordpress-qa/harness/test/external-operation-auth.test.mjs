import test from 'node:test';
import assert from 'node:assert/strict';
import {authenticate} from '../../../debug-evidence/mannendo-staging/operations/common.mjs';
test('external operation authenticates using harness-supplied request factory',async()=>{
 let closed=false,created=false;
 const request={newContext:async options=>{
  assert.equal(options.baseURL,'http://127.0.0.1:4321');created=true;
  return {get:async()=>({url:()=>options.baseURL+'/'}),dispose:async()=>{closed=true;}};
 }};
 assert.deepEqual(await authenticate({baseURL:'http://127.0.0.1:4321',environment:'local'},{request}),{});
 assert.equal(created,true);assert.equal(closed,true);
});
