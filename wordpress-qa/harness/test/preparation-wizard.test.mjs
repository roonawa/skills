import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {preparationChoices,profilePreparation,preparationError} from '../ui/public/preparation-wizard.js';
test('missing business expectations are explained in Japanese instead of treating samples as complete',()=>{assert.match(preparationError({kind:'performance-navigation',options:{budgets:{}}}),/許容値/);assert.match(preparationError({kind:'browser-flow',options:{steps:[{action:'goto',url:'/'}]}}),/結果を確認/);assert.equal(preparationError({kind:'performance-navigation',options:{budgets:{durationMs:3000}}}),'');});
test('auto-fill uses site paths and discovered forms without inventing recipient or budget',()=>{
 const config={pages:[{path:'/sub/'}],checks:[{kind:'discovered-public',options:{forms:[{formId:31,path:'/sub/contact',formSelector:'#f form',submitSelector:'#f button',fields:[{name:'email',type:'email',required:true},{name:'body',type:'textarea',required:true}]}]}}]};
 const choice=preparationChoices({id:'coverage-notification'},config,{contactFormId:31,testEmail:'qa@example.test'})[0];
 assert.equal(choice.options.steps[0].url,'/sub/contact');assert.equal(choice.options.steps[1].value,'qa@example.test');assert.equal(choice.options.steps.at(-1).expected.to,'');assert.match(choice.options.steps[2].value,/\{\{token\}\}/);
 const perf=preparationChoices({id:'coverage-performance'},config)[0];assert.deepEqual(perf.options.budgets,{});assert.equal(perf.options.path,'/sub/');assert.equal(choice.options.sandbox,undefined);
 assert(profilePreparation['coverage-publishing'].includes('writes'));
});
test('Japanese wizard edits executable options without raw JSON or method selection',async()=>{
 const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.route('http://wizard.test/**',async route=>{const path=new URL(route.request().url()).pathname;await route.fulfill(path.endsWith('.js')?{contentType:'text/javascript',body:await readFile(new URL('../ui/public'+path,import.meta.url),'utf8')}:{contentType:'text/html',body:'<main></main>'});});
 await page.goto('http://wizard.test/');await page.evaluate(async()=>{const {initCoverage}=await import('/coverage-editor.js');const {showPreparationWizard}=await import('/preparation-wizard.js');const config={pages:[{path:'/sub/'}],checks:[{id:'coverage-performance',title:'読込み時間',suite:'performance',kind:'unconfigured',options:{}}]};window.editor=initCoverage(document.querySelector('main'));window.editor.populate(config);showPreparationWizard({row:document.querySelector('.coverage-row'),config,profile:{},profileFields:()=>null,onProfileChange:()=>{}});});
 assert.equal(await page.locator('[data-c=kind]').isVisible(),false);assert.equal(await page.locator('[data-c=options]').isVisible(),false);assert.equal(await page.locator('[data-option=path]').inputValue(),'/sub/');
 await page.locator('[data-option="budgets.durationMs"]').fill('4000');await page.locator('[data-option="budgets.durationMs"]').blur();
 const result=await page.evaluate(()=>window.editor.read());assert.equal(result.checks[0].kind,'performance-navigation');assert.equal(result.checks[0].options.budgets.durationMs,4000);assert.equal(result.allowTestWrites,false);
 await page.evaluate(async()=>{const {showPreparationWizard}=await import('/preparation-wizard.js');const config={checks:[{id:'coverage-notification',title:'通知',suite:'delivery',kind:'unconfigured',options:{}},{id:'detected',kind:'discovered-public',suite:'delivery',options:{forms:[{formId:1,path:'/contact',formSelector:'#f',submitSelector:'#send',fields:[{name:'email',type:'email',required:true}]}]}}]};window.editor.populate(config);showPreparationWizard({row:document.querySelector('.coverage-row'),config,profile:{},profileFields:()=>null,onProfileChange:()=>{}});});
 assert.equal(await page.locator('[data-option="steps.1.selector"]').evaluate(el=>el.tagName),'SELECT');
 assert.equal(await page.locator('[data-option="steps.1.method"]').count(),0);
 await page.locator('[data-option="steps.3.source.url"]').fill('http://127.0.0.1:8025');await page.locator('[data-option="steps.3.expected.to"]').fill('qa@example.test');await page.locator('[data-option="steps.3.expected.to"]').blur();
 const mail=await page.evaluate(()=>window.editor.read().checks[0]);assert.equal(mail.options.steps.at(-1).expected.to,'qa@example.test');assert.equal(await page.locator('[data-c=options]').first().isVisible(),false);
 }finally{await browser.close();}
});
