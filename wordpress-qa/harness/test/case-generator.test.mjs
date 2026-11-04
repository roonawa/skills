import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateCases,addSecurityChecks} from '../ui/public/case-generator.js';
import {validateConfig,catalog} from '../lib/config.mjs';
test('registration generates explicit tests and preserves unresolved obligations',()=>{
 const input={name:'Fixture',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:false}],checks:[]};
 const result=generateCases(input);assert.equal(input.checks.length,0);
 assert.deepEqual(generateCases(result),result);
 const config=validateConfig(result);const rows=catalog(config);
 assert.ok(rows.some(x=>x.id==='page.home'));assert.ok(rows.some(x=>x.id==='links.home'));
 assert.equal(config.visuals.length,2);assert.equal(config.checks.length,49);
 assert.ok(config.checks.every(x=>(x.required||['auto-security-headers','auto-security-disclosure','security-compatibility'].includes(x.id))&&['unconfigured','standard-public','software-security','security-baseline'].includes(x.kind)));
 for(const id of ['notification','order-record','order-notification','order-cleanup','admin-general','contact-errors'])assert.ok(config.checks.some(x=>x.id==='coverage-'+id));
 assert.equal(config.allowTestWrites,false);
});
test('preserves explicit expectations and existing cases',()=>{
 const input={pages:[{id:'home',links:false}],visuals:[{id:'custom',pageId:'home',width:1280,ready:'#loaded'}],checks:[{id:'coverage-notification',kind:'human-review',options:{instructions:'existing'}}]};
 const r=generateCases(input);assert.equal(r.pages[0].links,false);assert.equal(r.visuals[0].ready,'#loaded');assert.equal(r.checks.find(x=>x.id==='coverage-notification').kind,'human-review');
});
test('addSecurityChecks adds five baseline checks once',()=>{
 const c={checks:[],pages:[{id:'a',path:'/a'},{id:'home',path:'/blog/'}]};addSecurityChecks(c,'/wp/wp-admin/');addSecurityChecks(c,'/wp/wp-admin/');
 const b=c.checks.filter(x=>x.kind==='security-baseline');assert.deepEqual(b.map(x=>x.id),['auto-security-exposure','auto-security-transport','auto-security-active-mixed','auto-security-headers','auto-security-disclosure']);
 assert.deepEqual(b.map(x=>x.required),[true,true,true,false,false]);assert.deepEqual(b.map(x=>x.options.area),['exposure','transport','mixed','headers','disclosure']);
 assert.ok(b.every(x=>x.suite==='authz'&&x.timeoutMs===120000&&x.options.wpPath==='/wp/'&&x.options.paths[0]==='/blog/'&&x.options.paths.length===2));
 assert.deepEqual(addSecurityChecks({checks:[]},'/wp-admin/').checks.find(x=>x.id==='auto-security-headers').options,{area:'headers',paths:['/'],wpPath:'/'});
 const many={pages:['a','b','c','d','e','f'].map(id=>({id,path:'/'+id})).concat({id:'home',path:'/'})};addSecurityChecks(many);assert.equal(many.checks.at(-1).options.paths[0],'/');assert.equal(many.checks.at(-1).options.paths.length,5);
});
test('generated baseline checks pass validateConfig',()=>{
 const config=validateConfig(generateCases({name:'Fixture',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:false}],checks:[]}));
 assert.equal(config.checks.filter(x=>x.kind==='security-baseline').length,5);
});
test('existing custom auto-security check is not overwritten',()=>{
 const mine={id:'auto-security-headers',title:'独自',suite:'authz',kind:'security-baseline',required:true,timeoutMs:1000,options:{area:'headers',paths:['/x']}};const c={checks:[mine]};addSecurityChecks(c);
 assert.equal(c.checks[0],mine);assert.deepEqual(mine.options.paths,['/x']);assert.equal(c.checks.filter(x=>x.id==='auto-security-headers').length,1);assert.equal(c.checks.length,5+5);
});
