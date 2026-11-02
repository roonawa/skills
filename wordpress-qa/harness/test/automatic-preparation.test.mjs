import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePreparation} from '../ui/automatic-preparation.mjs';
const config=()=>({name:'fixture',baseURL:'https://example.test',environment:'staging',allowTestWrites:true,pages:[{id:'home',path:'/'}],admin:[],manual:[],visuals:[],journeys:[],checks:['publishing','scheduled','metadata'].map(id=>({id:'coverage-'+id,kind:'unconfigured',suite:id==='metadata'?'seo':id==='scheduled'?'scheduled':'publishing',options:{instructions:'不足'}}))});
test('authorized standard journeys are linked while broader residual scope is retained',()=>{
 const c=config();c.journeys=[{id:'profile-post-lifecycle',module:'fixture'},{id:'profile-scheduled',module:'fixture'}];
 const out=compilePreparation(c,{writes:true},{automation:{public:{},admin:{}}});
 assert(!out.checks.some(c=>c.id==='coverage-publishing'));assert(out.manual.some(c=>c.id==='scope-publishing'));
 assert(out.manual.some(c=>c.id==='scope-scheduled'));assert.equal(out.allowTestWrites,true);
});
test('missing authorization and missing executor are never converted to completed checks',()=>{
 const c=config(),out=compilePreparation(c,{writes:false},{automation:{public:{},admin:{}}});
 assert(out.checks.some(c=>c.id==='coverage-publishing'&&c.kind==='unconfigured'));
 assert(out.checks.some(c=>c.id==='coverage-metadata'&&c.kind==='unconfigured'));
});
test('ready structural inspection can be linked but editorial judgment stays explicit',()=>{
 const c=config();c.checks.push({id:'auto-metadata',kind:'standard-public',suite:'seo',options:{area:'metadata',paths:['/']}});
 const out=compilePreparation(c,{},{});assert.equal(out.checks.find(c=>c.id==='coverage-metadata').kind,'human-review');
 assert(out.checks.find(c=>c.id==='coverage-metadata').options.instructions.includes('auto-metadata'));
});
