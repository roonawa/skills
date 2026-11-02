import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExam,validateExamItems,customerExamHtml} from '../lib/site-exam.mjs';
const report={runId:'r1',name:'<script>unsafe</script>',baseURL:'https://site.test/?secret=hidden',runStatus:'finished',finishedAt:'2026-10-29',configHash:'c1',rows:[{id:'a',status:'fail',title:'A',evidence:['audit.json'],failures:[{key:'axe:label',title:'入力欄の名前',impact:'説明',admin:'対応'}]},{id:'b',status:'fail',title:'B',evidence:[],failures:[{key:'axe:label',title:'入力欄の名前',impact:'説明',admin:'対応'}]},{id:'c',status:'fail',title:'C',evidence:[]},{id:'d',status:'blocked',title:'未確認'},{id:'e',status:'pass'}]};
const items=exam=>exam.issues.map(({id,scores,certainty,reasons,impact,action,reviewed,source})=>({id,scores,certainty,reasons,impact,action,reviewed,source}));
test('groups observations, excludes blocked from failures and retains pending scores',()=>{
 const e=buildExam(report);assert.equal(e.issues.length,2);assert.equal(e.issues[0].cases.length,2);assert.equal(e.maximum,null);assert.equal(e.pending,2);assert.equal(e.coverage.executed,4);assert.equal(e.coverage.unconfirmed.length,1);
});
test('validates score ranges, reasons and unknown IDs; original result is immutable',()=>{
 const original=JSON.stringify(report),exam=buildExam(report),data=items(exam);data[1].scores=[5,4,4];data[1].certainty='provisional';data[1].reasons=['影響の前提','成立条件の前提','範囲の前提'];
 const valid=validateExamItems(data,exam);assert.equal(buildExam(report,{fingerprint:exam.fingerprint,items:valid}).maximum,95);
 assert.equal(JSON.stringify(report),original);data[1].scores=[5,5,5];assert.throws(()=>validateExamItems(data,exam));data[1].scores=null;data[1].certainty='confirmed';assert.throws(()=>validateExamItems(data,exam));
});
test('changed source invalidates saved evaluations; customer HTML escapes input, omits query and raw evidence',()=>{
 const exam=buildExam(report),saved={fingerprint:exam.fingerprint,items:items(exam),savedAt:'now',version:'v1'};
 const changed=structuredClone(report);changed.rows[0].status='pass';assert.equal(buildExam(changed,saved).stale,true);
 const html=customerExamHtml(report,buildExam(report,saved));assert(!html.includes('<script>'));assert(!html.includes('secret=hidden'));assert(!html.includes('audit.json'));assert(html.includes('下書き'));assert(html.includes('採点保留'));assert(html.includes('未確認'));
});
