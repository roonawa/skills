import test from 'node:test';import assert from 'node:assert/strict';import {isolatedAuthOnly} from '../lib/isolated-auth.mjs';
test('only explicitly self-authenticating journeys bypass shared public headers',()=>{
 const c={config:{journeys:[{id:'own',handlesAuthentication:true},{id:'public'}]},report:{rows:[]}};
 assert.equal(isolatedAuthOnly(c),false);
 c.report.rows=[{id:'journey.own',suite:'journey',selected:true}];assert.equal(isolatedAuthOnly(c),true);
 c.report.rows.push({id:'page.home',suite:'audit',selected:true});assert.equal(isolatedAuthOnly(c),false);
 c.report.rows=[{id:'journey.public',suite:'journey',selected:true}];assert.equal(isolatedAuthOnly(c),false);
});
