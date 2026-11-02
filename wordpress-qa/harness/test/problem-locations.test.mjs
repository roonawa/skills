import test from 'node:test';import assert from 'node:assert/strict';
import {collectExamEvidence} from '../lib/exam-evidence.mjs';import {buildExam,customerExamHtml} from '../lib/site-exam.mjs';
import {safeLocationUrl} from '../lib/problem-locations.mjs';
test('location URLs strip credentials, queries and fragments and reject outside sites',()=>{
 assert.equal(safeLocationUrl('https://user:secret@site.test/page?token=secret#private','https://site.test'),'https://site.test/page');
 assert.equal(safeLocationUrl('https://other.test/private','https://site.test'),'');assert.equal(safeLocationUrl('javascript:alert(1)','https://site.test'),'');
});
test('evidence locates individual nodes and screenshot numbers without copying HTML or input values',()=>{
 const report={baseURL:'https://site.test',configHash:'h',rows:[{id:'axe.home-pc',status:'fail',title:'internal test',evidence:['axe.json','marked-screenshots.json','marked-001.png'],failures:[{key:'axe:label',title:'ラベル不足'}]}]};
 const nodes=[{target:['#first'],html:'<input value="PRIVATE">'},{target:['#second'],html:'<select name="PRIVATE">'}];
 const files={'context.json':JSON.stringify({configHash:'h',config:{pages:[{id:'home',path:'/contact?token=PRIVATE'}],visuals:[{id:'home-pc',pageId:'home',width:1280}]}}),'axe.json':JSON.stringify({url:'https://site.test/contact?token=PRIVATE',violations:[{id:'label',nodes}]}),'marked-screenshots.json':JSON.stringify({shots:[{id:'marked-001',number:1,rule:'label',status:'captured',...nodes[0],url:'https://site.test/contact',viewport:{width:1280}}]}),'marked-001.png':Buffer.from('89504e470d0a1a0a','hex')};
 const collected=collectExamEvidence(report,file=>Buffer.isBuffer(files[file])?files[file]:Buffer.from(files[file]));const exam=buildExam(collected.report),locations=exam.issues[0].cases[0].locations;
 assert.equal(locations.length,2);assert(locations.some(l=>l.element==='選択欄'));assert(locations.some(l=>l.number===1&&l.width===1280));assert(!JSON.stringify(locations).includes('PRIVATE'));assert(!JSON.stringify(locations).includes('#first'));
 let html=customerExamHtml(collected.report,exam,collected.image);assert(html.includes('https://site.test/contact'));assert(html.includes('選択欄'));assert(!html.includes('画像の「指摘 1」'));
 exam.issues[0].imageFiles=['marked-001.png'];html=customerExamHtml(collected.report,exam,collected.image);assert(html.includes('画像の「指摘 1」'));assert(html.includes('指摘 1：入力欄'));assert(!html.includes('PRIVATE'));
});
