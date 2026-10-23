import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from '../lib/config.mjs';
import {operationRequest} from '../lib/operations.mjs';
const config={environment:'staging',allowTestWrites:true,baseURL:'https://example.test',pages:[],policies:[],visuals:[],manual:[],journeys:[{id:'order',module:'order.mjs',explicitOnly:true,title:'銀行振込'}]};
test('write operations stay out of all and journey suites',()=>{
 for(const suite of ['all','journey'])assert.equal(catalog(config,suite)[0].selected,false);
});
test('registered standard operations are unexecuted and selected by normal suites',()=>{
 const c={...config,journeys:config.journeys.map(j=>({...j,runWithSuite:true}))};
 for(const suite of ['all','journey']){const row=catalog(c,suite)[0];assert.equal(row.status,'not_run');assert.equal(row.selected,true);}
 assert.equal(catalog(c,'audit')[0].selected,false);
});
test('operation requires exact scope, confirmation and isolated environment',()=>{
 const request={configHash:'hash',mode:'submit',confirmed:true,password:'secret'};
 assert.equal(operationRequest(config,'hash','order',request).env.WPQA_OPERATION_MODE,'submit');
 assert.throws(()=>operationRequest(config,'new','order',request),/設定/);
 assert.throws(()=>operationRequest(config,'hash','order',{...request,confirmed:false}),/確認/);
 assert.throws(()=>operationRequest({...config,environment:'production'},'hash','order',request),/検証/);
 assert.throws(()=>operationRequest(config,'hash','missing',request),/操作/);
});
