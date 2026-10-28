import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guidance} from '../lib/guidance.mjs';
import {coveragePlan} from '../lib/checks/index.mjs';
test('every unconfigured coverage item explains its specific setup',()=>{
 const config={checks:coveragePlan()};
 for(const c of config.checks.filter(c=>c.kind==='unconfigured')){
  const g=guidance({config,row:{id:'check.'+c.id},managed:true});
  assert(g.missing[0].includes('未定義'));assert(g.steps.some(s=>s.includes('検査方法')));assert(g.steps.length>=3);
  assert.equal(g.target.checkId,c.id);assert(g.location.includes(c.id));assert(g.fields.length>=3);assert(g.steps.some(s=>s.includes('ひな形')));
 }
});
test('mail and performance guidance identify fields, examples and external preparation',()=>{
 const config={checks:[{id:'mail',title:'通知メール到達',suite:'delivery',kind:'unconfigured',options:{}},{id:'speed',suite:'performance',kind:'unconfigured',options:{}}]};
 const mail=guidance({config,row:{id:'check.mail'},managed:true});assert.match(mail.fields[2].value,/expected.to/);assert.match(mail.external,/担当者/);assert.match(mail.location,/通知メール到達/);
 const speed=guidance({config,row:{id:'check.speed'},managed:true});assert.match(speed.fields[2].value,/合意済み/);assert.equal(speed.external,null);
});
test('credentials and write prerequisites are isolated to the selected item and secrets stay private',()=>{
 const config={environment:'production',checks:[{id:'x',kind:'wp-cache',options:{}},{id:'y',kind:'unconfigured',options:{instructions:'unrelated'}}]};
 const g=guidance({config,row:{id:'check.x'},env:{WPQA_UI_ADMIN_HEADERS:'secret-value'}});
 assert(g.missing.some(s=>s.includes('WPQA_UI_ADMIN_STATE')));assert(!JSON.stringify(g).includes('secret-value'));assert(!JSON.stringify(g).includes('unrelated'));assert(g.steps.some(s=>s.includes('本番URL')));
});
test('changed config does not misrepresent an old authentication failure as current',()=>{
 const g=guidance({config:{checks:[{id:'x',kind:'seo-page',options:{}}]},row:{id:'check.x',reason:'BLOCKED: authentication failed'},changed:true});
 assert(g.changed);assert(!g.steps.some(s=>s.includes('ログインし直し')));assert(g.missing[0].includes('再実行'));
});
