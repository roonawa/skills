import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCases} from '../ui/public/case-generator.js';
import {validateConfig,catalog} from '../lib/config.mjs';
import {preflight} from '../lib/preflight.mjs';
import {selectSingleTest} from '../lib/confirmation.mjs';
import {releaseGate,classify} from '../lib/results.mjs';
const base={name:'New site',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:false}]};
test('first registration preserves every undefined obligation without dispatching it as a broken test',()=>{
 const config=validateConfig(generateCases(base));const rows=catalog(config);
 const pending=rows.filter(r=>r.preparationRequired);
 assert.equal(pending.length,config.checks.filter(c=>c.kind==='unconfigured').length);
 assert(pending.length>20);assert(pending.every(r=>r.status==='not_run'&&!r.selected&&r.required&&r.reason.startsWith('準備待ち: ')));
 assert(rows.some(r=>r.selected&&r.kind==='standard-public'));
 assert.equal(releaseGate(rows.map(r=>r.preparationRequired?r:{...r,status:'pass'})),false);
 assert.throws(()=>selectSingleTest(rows,pending[0].id),/準備待ち/);
 const p=preflight(config,{});assert.equal(p.ready,true);assert.equal(p.issues.length,0);assert.equal(p.preparations.length,pending.length);
});
test('selected common operation waits for concrete conditions and becomes executable when configured',()=>{
 const config=validateConfig({...base,checks:[{id:'inspect',kind:'site-interaction',suite:'seo',options:{operation:'public-discovery',settings:{paths:[]}}}]});
 for(const suite of ['all','seo','interaction']){const row=catalog(config,suite).find(r=>r.id==='check.inspect');assert(row.preparationRequired);assert.equal(row.selected,false);}
 config.checks[0].options.settings.paths=['/'];const ready=catalog(config,'interaction');
 assert.equal(ready.find(r=>r.id==='check.inspect').preparationRequired,undefined);assert(ready.find(r=>r.id==='check.inspect').selected);
 selectSingleTest(ready,'check.inspect');assert.equal(ready.filter(r=>r.selected).length,1);
});
test('missing authentication and unexpected execution failures are not hidden by preparation classification',()=>{
 const config=validateConfig({...base,admin:[{id:'setting',source:'browser',path:'/wp-admin/options.php',selector:'#name',read:'value',expected:'expected',authenticatedSelector:'#wpadminbar',storageStateEnv:'QA_ADMIN_STATE'}]});
 assert.equal(preflight(config,{}).ready,false);assert.equal(preflight(config,{}).issues.length,1);
 assert.equal(classify({status:'failed',errors:[{message:'BLOCKED: authentication expired'}]},[]),'blocked');
 assert.equal(classify({status:'failed',errors:[{message:'Expected result differs'}]},[]),'fail');
});
