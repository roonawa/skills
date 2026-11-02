import test from 'node:test';import assert from 'node:assert/strict';import {impactAssessments,collectAccessibilityImpact} from '../lib/impact-probes.mjs';
test('visible repeated measured contrast and verified keyboard barrier have distinct impact',()=>{
 const data={schema:'wpqa-accessibility-impact-v1',scope:'observed-elements-only',observations:[{rule:'color-contrast',visible:true,repeated:true,textPresent:true,contrastRatio:2,expectedRatio:4.5},{rule:'scrollable-region-focusable',visible:true,repeated:true,keyboardBlocked:true,overflow:true,tabIndex:-1,focusableDescendants:0}]};
 const a=impactAssessments(data);assert.deepEqual(a.map(x=>x.scores),[[2,3,2],[3,3,2]]);
 data.observations[0].visible=false;data.observations[1].focusableDescendants=1;assert.equal(impactAssessments(data).length,0);
});
test('single scan, malformed measurements and successful document do not score',()=>{
 assert.equal(impactAssessments({schema:'wpqa-accessibility-impact-v1',scope:'observed-elements-only',observations:[{rule:'color-contrast',repeated:false,visible:true,textPresent:true,contrastRatio:1,expectedRatio:4.5}]}).length,0);
 const data={schema:'wpqa-document-impact-v1',path:'/page',statuses:[200,200],repeated:true,browserConfirmed:true,findings:['fragment-missing']};assert.equal(impactAssessments(data).length,1);data.statuses[1]=403;assert.equal(impactAssessments(data).length,0);
});
test('failed repeat observation cannot yield an impact record',async()=>{const r=await collectAccessibilityImpact({}, {violations:[]},async()=>{throw Error();});assert.equal(r.observations.length,0);assert.equal(r.unverified.length,1);});
import {chromium} from '@playwright/test';import AxeBuilder from '@axe-core/playwright';
test('real browser records repeated accessibility failures without persisting body text',async()=>{
 const browser=await chromium.launch();try{const context=await browser.newContext();const page=await context.newPage();await page.setContent('<html lang="ja"><title>test</title><main><p style="color:#aaa;background:#fff">VISIBLE_TEST_TEXT</p><iframe srcdoc="<p>frame</p>"></iframe><div style="height:30px;overflow-y:scroll"><p style="height:200px">scroll</p></div></main></html>');
 const scan=()=>new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();const first=await scan(),e=await collectAccessibilityImpact(page,first,scan);
 assert(impactAssessments(e).some(a=>a.key==='axe:frame-title'));assert(!JSON.stringify(e).includes('VISIBLE_TEST_TEXT'));
 }finally{await browser.close();}
});

import {confirmFragmentTargets} from '../lib/impact-probes.mjs';
test('fragment scoring requires actual missing destination after click, and skips explicit script controls',async()=>{
 const browser=await chromium.launch();try{
 const ctx=await browser.newContext(),p=await ctx.newPage();await p.setContent('<a href="#missing">Jump</a>');
 assert.equal(await confirmFragmentTargets(p,['fragment target missing: missing']),true);
 await p.setContent('<a href="#present">Jump</a><div id="present">target</div>');assert.equal(await confirmFragmentTargets(p,['fragment target missing: present']),false);
 await p.setContent('<a href="#menu" onclick="return false">Menu</a>');assert.equal(await confirmFragmentTargets(p,['fragment target missing: menu']),false);
 }finally{await browser.close();}
});
