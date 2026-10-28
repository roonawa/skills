import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAutomationPlan,resolveAutomationProfile,mergeAutomationConfig} from '../ui/automation-plan.mjs';
const pending=id=>({id:'coverage-'+id,kind:'unconfigured',suite:'delivery',options:{instructions:'needs conditions'}});
const input=()=>({admin:[],manual:[],checks:['admin-reading','admin-discussion','admin-permalink','admin-plugins','navigation','contact-errors','contact-retry','crawl','browsers','publishing'].map(pending)});
const discovery={automation:{observedAt:'2026-10-28',admin:{reading:[{id:'show_on_front',title:'front',path:'/wp-admin/options-reading.php',selector:'input:checked',read:'value',expected:'page'}]},public:{search:{path:'/',actionPath:'/',inputSelector:'input[name=s]',submitSelector:'button'},forms:[{path:'/contact',formId:31,fields:[{name:'name',type:'text'},{name:'email',type:'email'},{name:'message',type:'textarea'}]}],robots:{path:'/robots.txt'}}}};
test('discovery resolves unambiguous form structure without granting writes or overwriting input',()=>{
 const p=resolveAutomationProfile({writes:false,contactEmailField:'explicit'},discovery);
 assert.equal(p.contactFormId,31);assert.equal(p.contactPath,'/contact');assert.equal(p.contactNameField,'name');assert.equal(p.contactEmailField,'explicit');assert.equal(p.writes,false);assert.equal(p.submit,undefined);
 const ambiguous=structuredClone(discovery);ambiguous.automation.public.forms.push({...ambiguous.automation.public.forms[0],formId:32});
 assert.equal(resolveAutomationProfile({},ambiguous).contactFormId,undefined);
});
test('observations create actual checks, retain missing groups and state baseline scope',()=>{
 const c=applyAutomationPlan(input(),{},discovery);
 assert.equal(c.admin.length,1);assert(c.admin[0].title.includes('変更検知'));
 assert(!c.checks.some(x=>x.id==='coverage-admin-reading'));
 assert.equal(c.checks.find(x=>x.id==='coverage-admin-discussion').kind,'unconfigured');
 assert.equal(c.checks.find(x=>x.id==='coverage-contact-retry').kind,'discovered-public');
 assert.equal(c.checks.find(x=>x.id==='coverage-publishing').kind,'unconfigured');
 assert(c.manual.some(x=>x.reason.includes('文字数')));
 assert.equal(applyAutomationPlan(input(),{automation:{useObservedBaselines:false}},discovery).admin.length,0);
});
test('rediscovery retains prior baseline/custom policy and replaces only unresolved rows',()=>{
 const old=input();old.admin=[{id:'observed-reading-show-on-front',expected:'posts'}];old.checks.push({id:'user-check',kind:'redirect'});
 const c=mergeAutomationConfig(old,applyAutomationPlan(input(),{},discovery));
 assert.equal(c.admin[0].expected,'posts');assert(c.checks.some(x=>x.id==='user-check'));
 assert.equal(c.checks.find(x=>x.id==='coverage-navigation').kind,'discovered-public');
 assert(!c.checks.some(x=>x.id==='coverage-admin-reading'));
});
test('explicit configured coverage is not replaced by observation',()=>{
 const c=input();c.checks.find(x=>x.id==='coverage-navigation').kind='browser-flow';
 assert.equal(applyAutomationPlan(c,{},discovery).checks.find(x=>x.id==='coverage-navigation').kind,'browser-flow');
});
test('cache checks require explicit staging write permission and use saved admin browser auth',()=>{
 const c={...input(),environment:'staging',checks:[pending('cache')]};
 assert.equal(applyAutomationPlan(c,{writes:false},{}).checks[0].kind,'unconfigured');
 const ready=applyAutomationPlan(c,{writes:true,adminPath:'/site/wp-admin/'},{});
 assert.equal(ready.checks[0].kind,'wp-cache');assert.equal(ready.checks[0].options.restPath,'/site/wp-json/wp/v2');
 assert.equal(applyAutomationPlan({...c,environment:'production'},{writes:true},{}).checks[0].kind,'unconfigured');
});
