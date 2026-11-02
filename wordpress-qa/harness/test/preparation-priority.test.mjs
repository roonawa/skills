import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preparationImportance} from '../ui/public/case-generator.js';
test('important unconfigured security and critical workflows have reasons',()=>{
 for(const [id,suite] of [['coverage-roles','authz'],['coverage-cache','cache'],['coverage-order','commerce'],['coverage-notification','delivery'],['coverage-update','operations']])assert.ok(preparationImportance({id,suite,preparationRequired:true})?.reason);
});
test('resolved, direct review and noncritical preparations are not highlighted',()=>{
 for(const preparationRequired of [false,undefined])assert.equal(preparationImportance({id:'coverage-roles',suite:'authz',preparationRequired}),null);
 for(const [id,suite] of [['coverage-metadata','seo'],['coverage-admin-general','authz'],['coverage-performance','performance']])assert.equal(preparationImportance({id,suite,preparationRequired:true}),null);
});
