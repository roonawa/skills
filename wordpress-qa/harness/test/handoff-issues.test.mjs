import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeKey,issueKey,isConfirmed,collectIssues,unconfirmedCount} from '../lib/handoff-issues.mjs';
import {evidenceUrls} from '../lib/issue-report.mjs';
const report=rows=>({runId:'r1',baseURL:'https://example.test',rows});
const f=(key,extra={})=>({key,title:'T '+key,actual:'a',admin:'ad',code:'c',verify:'v',...extra});
test('normalizeKey strips volatile parts',()=>{
  assert.equal(normalizeKey('error:connect ECONNREFUSED 127.0.0.1:53123 at 2026-11-02T10:00:00Z'),normalizeKey('error:connect ECONNREFUSED 127.0.0.1:61001 at 2026-11-03T09:12:44Z'));
  assert.equal(normalizeKey('baseline:missing-csp:/'),'baseline:missing-csp:/');
  assert.equal(normalizeKey('http:/a?x=1&y=2 ok'),'http:/a?… ok');
  assert.equal(normalizeKey('id 123e4567-e89b-12d3-a456-426614174000'),'id <uuid>');
});
test('normalizeKey leaves baseline security setting keys unchanged',()=>{
  for(const k of ['baseline:cookie-secure:/post/12345/','security:x:/p/98765?a=1','setting:page-12345'])assert.equal(normalizeKey(k),k);
});
test('issueKey joins row id and normalized key',()=>assert.equal(issueKey({id:'a.b'},{key:'error:x 12345'}),'a.b|error:x <n>'));
test('collectIssues takes fail and caution rows only',()=>{
  const rows=[{id:'a',status:'fail',failures:[f('k1')]},{id:'b',status:'fail',level:'caution',failures:[f('k2')]},{id:'c',status:'pass',failures:[f('k3')]},{id:'d',status:'blocked',failures:[f('k4')]},{id:'e',status:'review',preparationRequired:true,failures:[f('k5')]},{id:'g',status:'fail'}];
  const issues=collectIssues({report:report(rows),readEvidence:()=>null});
  assert.deepEqual(issues.map(i=>[i.rowId,i.level,i.key]),[['a','fail','a|k1'],['b','caution','b|k2']]);
});
test('baseline owner and url come from rule and key',()=>{
  const [i]=collectIssues({report:report([{id:'security.baseline',title:'基礎診断',status:'fail',failures:[f('baseline:missing-hsts:/about/')]}]),readEvidence:()=>{throw new Error('x');}});
  assert.equal(i.owner,'server');assert.deepEqual(i.urls,['https://example.test/about/']);assert.equal(i.rawKey,'baseline:missing-hsts:/about/');
});
test('non-baseline issues use evidenceUrls and unknown owner',()=>{
  const row={id:'axe.pc',status:'fail',evidence:['axe.json'],failures:[f('color-contrast')]};
  const [i]=collectIssues({report:report([row]),readEvidence:()=>({url:'https://example.test/qa'})});
  assert.equal(i.owner,'unknown');assert.deepEqual(i.urls,['https://example.test/qa']);
});
test('failures of one row normalizing to the same key merge with union of urls',()=>{
  const row2={id:'js',status:'fail',evidence:['javascript.json'],failures:[f('error:x 12345'),f('error:x 67890')]};
  let n=0;const issues=collectIssues({report:report([row2]),readEvidence:()=>({url:'https://example.test/p'+(n++)})});
  assert.equal(issues.length,1);assert.deepEqual(issues[0].urls,['https://example.test/p0','https://example.test/p1']);
});
test('evidenceUrls reads axe url and baseline paths, ignores unreadable',()=>{
  const row={id:'x',evidence:['axe.json','security-baseline.json','bad.json','javascript.json']};
  const run={runId:'r',baseURL:'https://example.test'};
  const urls=evidenceUrls({row,run,readEvidence:(_r,file)=>{
    if(file==='axe.json')return {url:'https://example.test/a'};
    if(file==='security-baseline.json')return {schema:'security-baseline-v1',findings:[{rule:'missing-hsts',path:'/'},{rule:'nope',path:'/z'},{rule:'missing-csp',path:'/a'}]};
    throw new Error('x');
  }});
  assert.deepEqual(urls,['https://example.test/a','https://example.test/']);
});
test('isConfirmed and unconfirmedCount ignore unselected not_run',()=>{
  assert(isConfirmed({status:'pass'}));assert(!isConfirmed({status:'fail',preparationRequired:true}));
  const rows=[{id:'1',status:'blocked'},{id:'2',status:'pass',preparationRequired:true},{id:'3',status:'not_run'},{id:'4',status:'review'},{id:'5',status:'pass'}];
  assert.equal(unconfirmedCount(report(rows)),3);
});
