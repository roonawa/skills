import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handoffSubject,buildHandoffText,formatIssueDetail} from '../lib/handoff-text.mjs';
import {redactor} from '../lib/evidence.mjs';
const report={runId:'run-1',baseURL:'https://example.test',environment:'staging',finishedAt:'2026-11-01T16:30:00Z'};
const mk=(n,level,owner,extra={})=>({key:'r|'+n,rawKey:n,rowId:'r',rowTitle:'行'+n,level,owner,urls:['https://example.test/'+n],title:'課題'+n,actual:'状況です。二文目。',admin:'管理画面で直す。次の手順。',code:'コードで直す。次の手順。',verify:'確認する。次の確認。',...extra});
const build=(issues,o={})=>buildHandoffText({report,siteName:'S',issues,unconfirmed:3,...o});
test('subject sanitizes site name and uses JST date',()=>assert.equal(handoffSubject({siteName:'A:B\nC',finishedAt:'2026-11-01T16:30:00Z'}),'A・B C：SITE EXAM 診断結果の修正（2026-11-02）'));
test('body groups by owner in fixed order, fail before caution',()=>{
  const {body}=build([mk('u','fail','unknown'),mk('t','caution','theme'),mk('s','fail','server'),mk('a1','caution','admin'),mk('a2','fail','admin')]);
  const p=s=>body.indexOf(s);
  assert.ok(p('【概要】')<p('【管理画面・プラグイン】')&&p('【管理画面・プラグイン】')<p('【サーバー・ホスティング】')&&p('【サーバー・ホスティング】')<p('【テーマ・開発】')&&p('【テーマ・開発】')<p('【担当区分の確認が必要】'));
  assert.ok(p('［不合格］課題a2')<p('［注意］課題a1'));
  assert.match(body,/・実行日時（日本時間）：2026-11-02 01:30/);assert.match(body,/・実行ID：run-1/);assert.match(body,/不合格3件・注意2件/);assert.match(body,/SITE EXAMで未確認の項目：3件/);
  assert.ok(body.trimEnd().endsWith('比較結果をこのタスクに追記してください。'));
});
test('excluded keys are omitted and counts reflect included only',()=>{
  const r=build([mk('a','fail','admin'),mk('b','caution','admin')],{excludedKeys:['r|b']});
  assert.deepEqual(r.included.map(i=>i.key),['r|a']);assert.match(r.body,/不合格1件・注意0件/);assert.doesNotMatch(r.body,/課題b/);
});
test('urls capped at five with remainder count',()=>{
  const t=formatIssueDetail(mk('a','fail','admin',{urls:Array.from({length:7},(_,i)=>'https://e.test/'+i)}));
  assert.equal((t.match(/https:\/\/e\.test\/\d/g)??[]).length,5);assert.match(t,/ほか2件/);
});
test('unknown owner shows both admin and code',()=>{
  const t=formatIssueDetail(mk('a','fail','unknown'));assert.match(t,/・直し方（管理画面）：管理画面で直す。/);assert.match(t,/・直し方（技術）：コードで直す。/);
});
test('public origin adds result link',()=>assert.match(build([],{publicOrigin:'https://x.test/',projectId:'p'}).body,/・結果画面：https:\/\/x\.test\/\n/));
test('no markdown syntax',()=>assert.doesNotMatch(build([mk('a','fail','admin'),mk('b','caution','unknown')]).body,/^#|\*\*|^\s*[-*] /m));
test('long input is truncated within limit',()=>{
  const big='長い説明。'.repeat(50),opt={actual:big,admin:big,code:big,verify:big};
  const issues=[...Array.from({length:300},(_,i)=>mk('c'+i,'caution',i%2?'admin':'unknown',opt)),...Array.from({length:50},(_,i)=>mk('f'+i,'fail','theme',opt))];
  const r=build(issues);
  assert.ok(r.body.length<=20000);assert.equal(r.truncated,true);assert.ok(r.body.includes('全文はSITE EXAMの不具合報告書を参照'));assert.ok(r.body.includes('比較結果をこのタスクに追記してください。'));
  for(let i=0;i<50;i++)assert.ok(r.body.includes('［不合格］課題f'+i));
});
test('short input is not truncated',()=>{const r=build([mk('a','fail','admin')]);assert.equal(r.truncated,false);assert.ok(!r.body.includes('全文は'));});
test('secrets are redacted',()=>{
  const clean=redactor({headersEnv:'X'},{X:JSON.stringify({authorization:'Basic c2VjcmV0'})});
  const r=build([mk('a','fail','admin',{actual:'Authorization: Basic c2VjcmV0 が見えた'})],{clean});
  assert.ok(!r.body.includes('c2VjcmV0'));
});
test('real redactor does not cut a long body',()=>{
  const big='長い説明。'.repeat(50),opt={actual:big,admin:big,code:big,verify:big};
  const r=build(Array.from({length:80},(_,i)=>mk('f'+i,'fail','admin',opt)),{clean:redactor({},{})});
  assert.ok(r.body.length<=20000);assert.ok(r.body.includes('比較結果をこのタスクに追記してください。'));
});
