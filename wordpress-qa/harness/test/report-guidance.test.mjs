import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderEditorReport,renderBasis} from '../lib/editor-report/render.mjs';
import {confirmationPlan,validateConfirmation} from '../lib/confirmation.mjs';
test('report points to matching basis and preserves actionable technical facts',()=>{
 const group={id:'headers:fail',rule:'security-headers',category:'tech',rowIds:['check.headers'],basis:{checks:[{id:'check.headers',title:'ヘッダー',status:'fail',reason:'missing',evidence:['headers.json'],failures:[{title:'HSTS不足',actual:'HSTSなし',admin:'HTTPS設定を確認',code:'Strict-Transport-Securityを設定',verify:'ヘッダーを再取得'}]}]}};
 const input={site:{name:'fixture'},groups:[group],items:[{groupId:group.id,title:'ヘッダーを修正',steps:['技術担当に依頼']} ]};
 const html=renderEditorReport(input),basis=renderBasis(input);
 const anchor=/editor-report-basis.html#([^"<]+)/.exec(html)[1];
 assert(basis.includes(`id="${anchor}"`));assert.match(basis,/ヘッダーを修正/);assert.match(basis,/headers.json/);
 assert.match(html,/Strict-Transport-Securityを設定/);assert.match(html,/ヘッダーを再取得/);
});
test('policy confirmation asks for agreement and supports saving unresolved work',()=>{
 const plan=confirmationPlan({id:'manual.discovery-scope-admin-discussion',manualReview:true});
 assert.match(plan.steps[0].title,/取り決め/);
 const data={finish:false,reviewer:'担当',notes:'確認待ち',steps:plan.steps};
 assert.equal(validateConfirmation(plan,data).outcome,'review');
 assert.throws(()=>validateConfirmation(plan,{...data,finish:true}),/未確認/);
});
