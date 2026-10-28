import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateCases} from '../ui/public/case-generator.js';
import {validateConfig,catalog} from '../lib/config.mjs';
test('registration generates explicit tests and preserves unresolved obligations',()=>{
 const input={name:'Fixture',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:false}],checks:[]};
 const result=generateCases(input);assert.equal(input.checks.length,0);
 assert.deepEqual(generateCases(result),result);
 const config=validateConfig(result);const rows=catalog(config);
 assert.ok(rows.some(x=>x.id==='page.home'));assert.ok(rows.some(x=>x.id==='links.home'));
 assert.equal(config.visuals.length,2);assert.equal(config.checks.length,39);
 assert.ok(config.checks.every(x=>x.required&&['unconfigured','standard-public'].includes(x.kind)));
 for(const id of ['notification','order-record','order-notification','order-cleanup','admin-general','contact-errors'])assert.ok(config.checks.some(x=>x.id==='coverage-'+id));
 assert.equal(config.allowTestWrites,false);
});
test('preserves explicit expectations and existing cases',()=>{
 const input={pages:[{id:'home',links:false}],visuals:[{id:'custom',pageId:'home',width:1280,ready:'#loaded'}],checks:[{id:'coverage-notification',kind:'human-review',options:{instructions:'existing'}}]};
 const r=generateCases(input);assert.equal(r.pages[0].links,false);assert.equal(r.visuals[0].ready,'#loaded');assert.equal(r.checks.find(x=>x.id==='coverage-notification').kind,'human-review');
});
