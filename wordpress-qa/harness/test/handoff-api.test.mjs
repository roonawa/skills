import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startUI} from '../ui/server.mjs';
import {writeReport} from '../lib/results.mjs';

const STATE='zq7',SECRET='pw-Very-Secret-77',TOKEN='zzSecretToken42',baseURL='http://127.0.0.1:4300';
const row=(id,status,evidence=[],title=id)=>({id,title,required:true,status,evidence});
function writeRun(dir,runId,finishedAt,rows,files={},runStatus='finished',extra={}){
  const runDir=path.join(dir,'runs',runId);
  for(const [file,data] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(runDir,file)),{recursive:true});fs.writeFileSync(path.join(runDir,file),JSON.stringify(data));}
  fs.mkdirSync(runDir,{recursive:true});writeReport(runDir,{runId,name:'Handoff',baseURL,environment:'local',runStatus,startedAt:finishedAt,finishedAt,configHash:'x',rows,...extra});
}
const auditRow=()=>row('check.audit-home','fail',['evidence/audit-home.json'],'トップページ');
const auditFile={'evidence/audit-home.json':{url:baseURL+'/?session=abc',errors:[`unexpected header Authorization: Bearer ${TOKEN} ${SECRET}`]}};
const linksRow=()=>row('check.links-a','fail',['evidence/links-a.json'],'リンク');
const linksFile={'evidence/links-a.json':{url:baseURL+'/links/',errors:['broken link found']}};
const baselineRow=()=>row('security.baseline','fail',['security-baseline.json'],'基礎診断');
const baselineFile={'security-baseline.json':{schema:'security-baseline-v1',findings:[{rule:'missing-hsts',path:'/',observation:'HSTSなし'}]}};
async function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-handoff-')),configFile=path.join(dir,'site.json');
  fs.writeFileSync(configFile,JSON.stringify({name:'Handoff: Site',baseURL,environment:'local',pages:[{id:'home',path:'/',canonical:baseURL+'/',indexable:true}],journeys:[],visuals:[]}));
  writeRun(dir,'run-a','2026-10-01T01:00:00.000Z',[auditRow(),linksRow(),baselineRow(),row('check.blocked','blocked')],{...auditFile,...linksFile,...baselineFile});
  writeRun(dir,'run-b','2026-10-02T01:00:00.000Z',[row('check.audit-home','pass'),linksRow(),baselineRow(),row('check.new','fail',['evidence/audit-new.json'],'新規')],{...linksFile,...baselineFile,'evidence/audit-new.json':{url:baseURL+'/new/',errors:['new problem appeared']}});
  writeRun(dir,'run-c','2026-10-03T01:00:00.000Z',[auditRow()],auditFile,'running');
  const stateRow=()=>row('check.audit-'+STATE,'fail',['evidence/audit-state.json'],'状態依存'),stateFile={'evidence/audit-state.json':{url:baseURL+'/d/',errors:['mismatch '+STATE+' seen']}};
  writeRun(dir,'run-d','2026-10-04T01:00:00.000Z',[stateRow()],stateFile);writeRun(dir,'run-e','2026-10-05T01:00:00.000Z',[stateRow()],stateFile);
  process.env.WPQA_HANDOFF_TEST_PASSWORD=SECRET;process.env.WPQA_HANDOFF_TEST_HEADERS=JSON.stringify({Authorization:'Bearer '+TOKEN});
  const app=await startUI({configPaths:[configFile],port:0});
  t.after(async()=>{await app.close();delete process.env.WPQA_HANDOFF_TEST_PASSWORD;delete process.env.WPQA_HANDOFF_TEST_HEADERS;fs.rmSync(dir,{recursive:true,force:true});});
  const boot=await(await fetch(app.url+'/api/bootstrap')).json(),id=boot.projects[0].id,texts=[];
  const post=async(runId,kind,value,headers={'X-QA-Token':boot.token})=>{const r=await fetch(`${app.url}/api/projects/${id}/runs/${runId}/${kind}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url,...headers},body:JSON.stringify(value)});const text=await r.text();texts.push(text);return {status:r.status,data:JSON.parse(text)};};
  const handoffs=path.join(dir,'handoffs-runs'),saved=()=>fs.existsSync(handoffs)?fs.readdirSync(handoffs).filter(f=>f.endsWith('.json')):[];
  return {post,saved,handoffs,texts,dir};
}

test('handoff preview does not save; save:true saves once per id',async t=>{
  const {post,saved,handoffs}=await setup(t);
  const preview=await post('run-a','handoff',{excludedKeys:[],save:false});assert.equal(preview.status,200);
  const d=preview.data;assert.match(d.handoffId,/^h-[a-z0-9]+-[a-f0-9]{8}$/);assert.equal(saved().length,0);
  assert.equal(d.subject,'Handoff・ Site：SITE EXAM 診断結果の修正（2026-10-01）');assert.equal(d.unconfirmed,1);assert.equal(d.truncated,false);
  assert.equal(d.issues.length,3);for(const i of d.issues)assert.deepEqual(Object.keys(i).sort(),['key','level','owner','rowTitle','title','urls']);
  assert.ok(d.issues.every(i=>/^[a-f0-9]{32}$/.test(i.key)));const pick=t=>d.issues.find(i=>i.rowTitle===t),base=pick('基礎診断'),links=pick('リンク');
  assert.equal(base.owner,'server');assert.deepEqual(base.urls,[baseURL+'/']);assert.deepEqual(links.urls,[baseURL+'/links/']);
  assert.match(d.body,/【サーバー・ホスティング】/);assert.match(d.body,/SITE EXAMで未確認の項目：1件/);
  const again=await post('run-a','handoff',{excludedKeys:[],save:false});assert.notEqual(again.data.handoffId,d.handoffId);
  const first=await post('run-a','handoff',{handoffId:d.handoffId,excludedKeys:[links.key,'f'.repeat(32)],save:true});assert.equal(first.status,200);
  assert.equal(first.data.handoffId,d.handoffId);assert.deepEqual(first.data.excludedKeys,[links.key]);assert.doesNotMatch(first.data.body,/broken link/);
  assert.deepEqual(saved(),[d.handoffId+'.json']);
  await post('run-a','handoff',{handoffId:d.handoffId,excludedKeys:[links.key],save:true});assert.equal(saved().length,1);
  const record=JSON.parse(fs.readFileSync(path.join(handoffs,saved()[0]),'utf8'));
  assert.equal(record.sourceRunId,'run-a');assert.equal(record.sourceFinishedAt,'2026-10-01T01:00:00.000Z');assert.equal(record.siteName,'Handoff: Site');assert.equal(record.actor,'');
  assert.deepEqual(record.issues.map(i=>i.key).sort(),d.issues.filter(i=>i!==links).map(i=>i.key).sort());assert.deepEqual(record.excludedKeys,[links.key]);
  assert.ok(record.issues.every(i=>i.actual&&i.verify));
});

test('compare classifies against latest record and saves next record on save',async t=>{
  const {post,saved,handoffs}=await setup(t);
  const pre=(await post('run-a','handoff',{excludedKeys:[],save:false})).data,pick=t=>pre.issues.find(i=>i.rowTitle===t),links=pick('リンク'),audit=pick('トップページ'),base=pick('基礎診断');
  await post('run-a','handoff',{handoffId:pre.handoffId,excludedKeys:[links.key],save:true});
  assert.equal((await post('run-a','handoff-compare',{uncheckedAddedKeys:[],save:false})).status,409);
  const c=await post('run-b','handoff-compare',{uncheckedAddedKeys:[],save:false});assert.equal(c.status,200);
  const d=c.data;assert.match(d.handoffId,/^h-/);assert.notEqual(d.handoffId,pre.handoffId);
  assert.deepEqual(Object.keys(d.baseline).sort(),['createdAt','handoffId','sourceRunId']);assert.equal(d.baseline.handoffId,pre.handoffId);assert.equal(d.baseline.sourceRunId,'run-a');
  const keys=list=>list.map(i=>i.key);
  assert.deepEqual(keys(d.comparison.resolved),[audit.key]);assert.deepEqual(keys(d.comparison.unresolved),[base.key]);assert.deepEqual(keys(d.comparison.carriedExcluded),[links.key]);assert.deepEqual(d.comparison.unverified,[]);
  assert.equal(d.comparison.added.length,1);assert.equal(d.comparison.added[0].rowTitle,'新規');assert.equal(d.scopeGap,0);
  for(const list of Object.values(d.comparison))for(const i of list)assert.deepEqual(Object.keys(i).sort(),['key','level','rowTitle','title','urls']);
  assert.match(d.body,/【SITE EXAM 再診断結果（2026-10-02）】/);assert.match(d.body,/new problem appeared/);assert.equal(saved().length,1);
  const unchecked=await post('run-b','handoff-compare',{handoffId:d.handoffId,uncheckedAddedKeys:[d.comparison.added[0].key],save:true});assert.equal(unchecked.status,200);
  assert.doesNotMatch(unchecked.data.body,/new problem appeared/);assert.equal(saved().length,2);
  const resaved=await post('run-b','handoff-compare',{handoffId:d.handoffId,uncheckedAddedKeys:[],save:true});assert.equal(resaved.status,200,JSON.stringify(resaved.data));
  assert.equal(resaved.data.baseline.handoffId,pre.handoffId);assert.equal(saved().length,2);
  const next=JSON.parse(fs.readFileSync(path.join(handoffs,d.handoffId+'.json'),'utf8'));
  assert.equal(next.sourceRunId,'run-b');assert.deepEqual(next.issues.map(i=>i.key).sort(),[base.key,d.comparison.added[0].key].sort());assert.deepEqual(next.excludedKeys,[links.key]);
  assert.equal((await post('run-b','handoff-compare',{uncheckedAddedKeys:[],save:false})).status,409);
});

test('rejects unfinished run, bad keys, bad id',async t=>{
  const {post,saved}=await setup(t);
  for(const kind of ['handoff','handoff-compare']){
    const keys=kind==='handoff'?'excludedKeys':'uncheckedAddedKeys';
    const r=await post('run-c',kind,{[keys]:[],save:false});assert.equal(r.status,409);assert.equal(r.data.error??r.data.message,'完了した実行を選択してください');
    for(const bad of ['x',[1],['k'],['A'.repeat(32)],['a'.repeat(33)],Array(501).fill('a'.repeat(32))])assert.equal((await post('run-a',kind,{[keys]:bad,save:false})).status,400,JSON.stringify(bad).slice(0,40));
    for(const handoffId of ['bad','h-x-1234567',7,'../h-a-12345678'])assert.equal((await post('run-a',kind,{handoffId,[keys]:[],save:true})).status,400,String(handoffId));
    assert.equal((await post('run-a',kind,{[keys]:[],save:'yes'})).status,400);
    assert.equal((await post('run-a',kind,{[keys]:[],save:true},{})).status,403);
  }
  assert.equal((await post('run-a','handoff',{excludedKeys:Array(500).fill('a'.repeat(32)),save:false})).status,200);
  assert.equal(saved().length,0);
});

test('compare without prior record returns 409',async t=>{
  const {post,saved}=await setup(t);
  const r=await post('run-b','handoff-compare',{uncheckedAddedKeys:[],save:true});assert.equal(r.status,409);
  assert.equal(r.data.error??r.data.message,'比較できる引き継ぎ記録がありません');assert.equal(saved().length,0);
});

test('response body never contains configured secret header values',async t=>{
  const {post,saved,handoffs,texts}=await setup(t);
  const pre=(await post('run-a','handoff',{excludedKeys:[],save:false})).data;
  assert.match(pre.body,/\[REDACTED\]/);
  await post('run-a','handoff',{handoffId:pre.handoffId,excludedKeys:[],save:true});
  const audit=pre.issues.find(i=>i.rowTitle==='トップページ');
  assert.equal((await post('run-a','handoff',{excludedKeys:[audit.key],save:false})).data.excludedKeys[0],audit.key);
  await post('run-a','handoff',{handoffId:pre.handoffId,excludedKeys:[audit.key],save:true});
  await post('run-b','handoff-compare',{uncheckedAddedKeys:[],save:true});
  // 課題キー・rawKey・除外キーを含め、応答と記録ファイルのすべての項目を調べる。
  const all=[...texts,...saved().map(f=>fs.readFileSync(path.join(handoffs,f),'utf8'))].join('\n');
  assert.match(all,/"excludedKeys":\["[a-f0-9]{32}"\]/);assert.match(all,/"rawKey": ""/);
  assert.ok(texts.length>=5);for(const secret of [SECRET,TOKEN,'session=abc'])assert.ok(!all.includes(secret),secret);
});

test('issue keys are digests of the unredacted key, so a changed secret set does not change classification',async t=>{
  const {post,saved,handoffs,texts}=await setup(t);
  process.env.WPQA_HANDOFF_TEST_STATE=JSON.stringify({cookies:[{name:'c',value:STATE}],origins:[]});
  t.after(()=>{delete process.env.WPQA_HANDOFF_TEST_STATE;});
  const pre=(await post('run-d','handoff',{excludedKeys:[],save:false})).data;
  assert.equal(pre.issues.length,1);assert.match(pre.issues[0].key,/^[a-f0-9]{32}$/);
  assert.equal((await post('run-d','handoff',{handoffId:pre.handoffId,excludedKeys:[pre.issues[0].key],save:false})).data.excludedKeys[0],pre.issues[0].key);
  await post('run-d','handoff',{handoffId:pre.handoffId,excludedKeys:[],save:true});
  process.env.WPQA_HANDOFF_TEST_STATE=JSON.stringify({cookies:[{name:'c',value:'rotated-cookie'}],origins:[]});
  const c=(await post('run-e','handoff-compare',{uncheckedAddedKeys:[],save:false})).data;
  assert.deepEqual(c.comparison.unresolved.map(i=>i.key),[pre.issues[0].key]);
  assert.deepEqual([c.comparison.resolved,c.comparison.added,c.comparison.unverified].map(l=>l.length),[0,0,0]);assert.equal(c.scopeGap,0);
  process.env.WPQA_HANDOFF_TEST_STATE=JSON.stringify({cookies:[{name:'c',value:STATE}],origins:[]});
  await post('run-e','handoff-compare',{uncheckedAddedKeys:[],save:true});
  const all=[...texts,...saved().map(f=>fs.readFileSync(path.join(handoffs,f),'utf8'))].join('\n');assert.ok(texts.length>=5);
  for(const s of ['mismatch '+STATE,'audit-'+STATE+'|',STATE+' seen'])assert.ok(!all.includes(s),s);
});

test('a supplied handoffId cannot overwrite a record made from another run',async t=>{
  const {post,handoffs}=await setup(t);
  const read=id=>JSON.parse(fs.readFileSync(path.join(handoffs,id+'.json'),'utf8'));
  const pre=(await post('run-a','handoff',{excludedKeys:[],save:false})).data;
  await post('run-a','handoff',{handoffId:pre.handoffId,excludedKeys:[],save:true});
  for(const save of [false,true]){const r=await post('run-b','handoff-compare',{handoffId:pre.handoffId,uncheckedAddedKeys:[],save});assert.equal(r.status,400);assert.equal(r.data.error,'引き継ぎIDが不正です');}
  assert.equal(read(pre.handoffId).sourceRunId,'run-a');
  const cmp=(await post('run-b','handoff-compare',{uncheckedAddedKeys:[],save:true})).data;assert.equal(read(cmp.handoffId).sourceRunId,'run-b');
  const r=await post('run-a','handoff',{handoffId:cmp.handoffId,excludedKeys:[],save:true});assert.equal(r.status,400);assert.equal(r.data.error,'引き継ぎIDが不正です');
  assert.equal(read(cmp.handoffId).sourceRunId,'run-b');
  assert.equal((await post('run-b','handoff-compare',{handoffId:cmp.handoffId,uncheckedAddedKeys:[],save:true})).data.baseline.handoffId,pre.handoffId);
});

test('aggregated runs and rows copied from older runs are not treated as re-checks',async t=>{
  const {post,saved,dir}=await setup(t);
  const pre=(await post('run-a','handoff',{excludedKeys:[],save:false})).data,audit=pre.issues.find(i=>i.rowTitle==='トップページ');
  await post('run-a','handoff',{handoffId:pre.handoffId,excludedKeys:[],save:true});
  writeRun(dir,'run-f','2026-10-06T01:00:00.000Z',[{...row('check.audit-home','pass'),sourceRunId:'run-x'}],{},'finished',{aggregation:{notAFreshRun:true,sourceRuns:['run-x']}});
  const agg=await post('run-f','handoff-compare',{uncheckedAddedKeys:[],save:true});assert.equal(agg.status,409);
  assert.equal(agg.data.error,'集約結果は再診断として比較できません。新しい実行を選択してください');assert.equal(saved().length,1);
  writeRun(dir,'run-s','2026-10-06T02:00:00.000Z',[{...row('check.audit-home','pass'),details:{sourceRunId:'run-x'}}],{},'finished',{sources:[{id:'run-x',configHash:'x',finishedAt:'2026-10-06T00:00:00.000Z'}]});
  const sum=await post('run-s','handoff-compare',{uncheckedAddedKeys:[],save:true});assert.equal(sum.status,409);assert.equal(sum.data.error,'集約結果は再診断として比較できません。新しい実行を選択してください');assert.equal(saved().length,1);
  writeRun(dir,'run-g','2026-10-07T01:00:00.000Z',[{...row('check.audit-home','pass'),sourceRunId:'run-x'},row('check.links-a','pass'),row('security.baseline','pass')]);
  const c=(await post('run-g','handoff-compare',{uncheckedAddedKeys:[],save:false})).data;
  assert.deepEqual(c.comparison.unverified.map(i=>i.key),[audit.key]);assert.equal(c.comparison.resolved.length,2);assert.ok(!c.comparison.resolved.some(i=>i.key===audit.key));assert.equal(c.scopeGap,0);
  assert.equal(c.comparison.unverified[0].reason,'not-rechecked');assert.doesNotMatch(c.body,/同じ検査に別の課題/);
  // 同じ行が別の課題で fail のまま → 解消ではなく再確認できず（同じ検査に別の課題）。
  writeRun(dir,'run-h','2026-10-08T01:00:00.000Z',[row('check.audit-home','pass'),row('check.links-a','fail',['evidence/links-a.json'],'リンク'),row('security.baseline','pass')],{'evidence/links-a.json':{url:baseURL+'/links/',errors:['other link problem']}});
  const h=(await post('run-h','handoff-compare',{uncheckedAddedKeys:[],save:false})).data,links=pre.issues.find(i=>i.rowTitle==='リンク');
  assert.deepEqual(h.comparison.unverified.map(i=>[i.key,i.reason]),[[links.key,'same-check-failing']]);assert.deepEqual(Object.keys(h.comparison.unverified[0]).sort(),['key','level','reason','rowTitle','title','urls']);
  assert.ok(!h.comparison.resolved.some(i=>i.key===links.key));assert.match(h.body,/（同じ検査に別の課題が残っているため確認できません）/);
});
