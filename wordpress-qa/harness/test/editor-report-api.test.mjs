import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';
import {startUI} from '../ui/server.mjs';import {ProjectStore} from '../ui/project-store.mjs';import {registrationConfig} from '../ui/registration.mjs';import {SystemSettings} from '../ui/system-settings.mjs';import {createSecretCodec} from '../ui/secret-codec.mjs';

const BASE='https://example.test';
const profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false};
const sitemap='<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/</loc></url></urlset>';
// 3 groups to write (security-headers caution, unclassified fail, sitemap-format fail) → estimate 2 calls.
const rows=[
 {id:'check.auto-security-headers',title:'見出し',suite:'audit',status:'fail',level:'caution',reason:'missing-hsts'},
 {id:'check.mystery',title:'謎',suite:'audit',status:'fail',reason:'something odd',evidence:['mystery.json']},
 {id:'sitemap.main',title:'サイトマップ',suite:'audit',status:'fail',reason:'malformed sitemap XML'},
 {id:'check.ok',title:'合格',suite:'audit',status:'pass'},
];
const item=i=>({index:i,title:`${i+1}番目の対応`,summary:`${i+1}番目の項目の状況をまとめました。`,impact:`${i+1}番目の項目を放置すると困ることがあります。`,steps:[`${i+1}番目の手順を行います`],location:`${i+1}番目の画面`,urgency:'normal',note:''});
function fakeFetcher(make=item){
 const f=async(url,opts)=>{f.calls++;const input=JSON.parse(JSON.parse(opts.body).messages[0].content);f.inputs.push(input);
  return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items:input.map(x=>make(x.index))})}]}));};
 f.calls=0;f.inputs=[];return f;
}
function fakeClient(gate){
 const c={calls:0,get:async url=>{c.calls++;if(gate)await gate;return url===`${BASE}/sitemap.xml`?{status:200,location:null,headers:{},text:sitemap}:{status:200,location:null,headers:{},text:'<html><body>x</body></html>'};},head:async()=>({status:200})};
 return c;
}
async function fixture(t,{ai={enabled:true,approved:true,evidenceApproved:true},runStatus='finished',fetcher=fakeFetcher(),client=fakeClient(),external=false,runRows=rows,runBaseURL=BASE}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-editor-api-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const codec=createSecretCodec(randomBytes(32)),store=new ProjectStore(path.join(dir,'projects'),{codec});
 const config=registrationConfig({name:'編集者API',baseURL:BASE,environment:'staging',profile,discovery:{pages:[{path:'/'}],warnings:[]}});
 const id=store.save({config,profile,auth:{publicPassword:'view-only-pass'}}),ctx=store.context(id);
 const run=path.join(ctx.outputDir,'run-1');fs.mkdirSync(run,{recursive:true});
 fs.writeFileSync(path.join(run,'results.json'),JSON.stringify({runId:'run-1',name:'編集者API',baseURL:runBaseURL,environment:'staging',configHash:ctx.configHash,startedAt:'2026-11-05T00:00:00Z',...(runStatus==='finished'?{finishedAt:'2026-11-05T00:10:00Z'}:{}),runStatus,rows:runRows,summary:{fail:3,caution:1,pass:1}}));
 fs.writeFileSync(path.join(run,'context.json'),JSON.stringify({configHash:ctx.configHash,config:{pages:ctx.config.pages,visuals:ctx.config.visuals,policies:ctx.config.policies}}));
 fs.writeFileSync(path.join(run,'mystery.json'),JSON.stringify({note:'x'}));
 const settings=new SystemSettings({directory:path.join(dir,'projects','system'),codec});
 if(ai)settings.save({apiKey:'sk-ant-fixture-only',...ai});
 const configPaths=[];
 if(external){const file=path.join(dir,'site.json');fs.writeFileSync(file,JSON.stringify({name:'External',baseURL:'https://external.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://external.test/',indexable:false}],journeys:[],visuals:[]}));configPaths.push(file);
  const er=path.join(dir,'runs','run-1');fs.mkdirSync(er,{recursive:true});fs.writeFileSync(path.join(er,'results.json'),JSON.stringify({runId:'run-1',baseURL:'https://external.test',startedAt:'2026-11-05T00:00:00Z',finishedAt:'2026-11-05T00:10:00Z',runStatus:'finished',rows}));}
 const app=await startUI({port:0,storeDir:path.join(dir,'projects'),credentialCodec:codec,configPaths,publicDiscovery:async()=>({public:{},admin:{}}),aiOptions:{fetcher},editorRecheckClient:client});t.after(()=>app.close());
 const boot=await(await fetch(app.url+'/api/bootstrap')).json(),endpoint=`${app.url}/api/projects/${id}/runs/run-1`;
 const post=()=>fetch(endpoint+'/editor-report',{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:'{}'});
 const status=async()=>(await fetch(endpoint+'/editor-report')).json();
 return {app,boot,id,run,store,settings,endpoint,post,status,fetcher,client};
}

test('creates both files for a finished run',async t=>{
 const f=await fixture(t);
 const before=await f.status();
 assert.deepEqual(before,{available:true,groups:3,calls:2,remaining:20,files:{editor:false,basis:false},stage:null});
 const r=await f.post(),data=await r.json();assert.equal(r.status,200,JSON.stringify(data));
 assert.equal(data.file,'editor-report.html');assert.equal(data.basis,'editor-report-basis.html');
 assert.deepEqual(data.counts,{fail:2,caution:1,unverified:0,notApplicable:0});assert.equal(data.aiCalls,1);assert(Array.isArray(data.warnings));
 assert.equal(f.fetcher.calls,1);assert(f.client.calls>0);
 for(const name of [data.file,data.basis]){const html=fs.readFileSync(path.join(f.run,name),'utf8');assert.match(html,/<html/i);assert.doesNotMatch(html,/<script/i);}
 assert.doesNotMatch(JSON.stringify(f.fetcher.inputs),/view-only-pass/);
 assert.deepEqual(fs.readdirSync(f.run).filter(n=>n.endsWith('.tmp')),[]);
 const after=await f.status();assert.deepEqual(after.files,{editor:true,basis:true});assert.equal(after.remaining,19);assert.equal(after.stage,null);
});

test('rejects running runs',async t=>{
 const f=await fixture(t,{runStatus:'running'});
 const r=await f.post();assert.equal(r.status,409);assert.equal((await r.json()).error,'完了した実行を選択してください');
 const s=await f.status();assert.equal(s.available,false);assert.equal(s.reason,'完了した実行を選択してください');
 assert.equal(f.fetcher.calls,0);assert.equal(f.client.calls,0);
});

test('refuses when remaining calls are insufficient',async t=>{
 const f=await fixture(t,{ai:{enabled:true,approved:true,evidenceApproved:true,dailyLimit:1}});
 const s=await f.status();assert.equal(s.available,false);assert.equal(s.remaining,1);assert.equal(s.calls,2);
 const reason='本日のAI利用の残り回数が足りません（必要 2 回・残り 1 回）';assert.equal(s.reason,reason);
 const r=await f.post();assert.equal(r.status,409);assert.equal((await r.json()).error,reason);
 assert.equal(f.fetcher.calls,0);assert.equal(f.client.calls,0);assert(!fs.existsSync(path.join(f.run,'editor-report.html')));
});

test('requires evidence approval',async t=>{
 const reason='AIの利用設定（有効化・承認・取得情報の送信許可）を確認してください';
 for(const ai of [{enabled:true,approved:true,evidenceApproved:false},null]){
  const f=await fixture(t,{ai});
  const s=await f.status();assert.equal(s.available,false);assert.equal(s.reason,reason);
  const r=await f.post();assert.equal(r.status,409);assert.equal((await r.json()).error,reason);
  assert.equal(f.fetcher.calls,0);assert.equal(f.client.calls,0);
 }
});

test('serves the files through /files',async t=>{
 const f=await fixture(t);assert.equal((await f.post()).status,200);
 for(const name of ['editor-report.html','editor-report-basis.html']){
  const r=await fetch(`${f.endpoint}/files?path=${encodeURIComponent(name)}`);assert.equal(r.status,200,name);
  assert.match(r.headers.get('content-security-policy'),/sandbox/);assert.match(r.headers.get('content-type'),/text\/html/);
 }
});

test('reports the stage while creating and refuses a second creation',async t=>{
 let release;const gate=new Promise(r=>release=r),f=await fixture(t,{client:fakeClient(gate)});
 const first=f.post();
 let s;for(let i=0;i<100;i++){s=await f.status();if(s.stage==='recheck')break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(s.stage,'recheck');assert.equal(s.available,false);assert.equal(s.reason,'ほかの処理が終わってから作成してください');
 const second=await f.post();assert.equal(second.status,409);assert.equal((await second.json()).error,'ほかの処理が終わってから作成してください');
 release();assert.equal((await first).status,200);
 assert.equal((await f.status()).stage,null);
});

test('other work is refused while an editor report is being created',async t=>{
 let release;const gate=new Promise(r=>release=r),f=await fixture(t,{client:fakeClient(gate)});
 const send=(route,data)=>fetch(f.app.url+route,{method:'POST',headers:{Origin:f.app.url,'X-QA-Token':f.boot.token,'Content-Type':'application/json'},body:JSON.stringify(data)});
 const configHash=f.boot.projects.find(p=>p.id===f.id).configHash,busy='編集者向け報告書の作成が終わってから実行してください';
 const first=f.post();
 for(let i=0;i<100&&(await f.status()).stage!=='recheck';i++)await new Promise(r=>setTimeout(r,20));
 for(const [route,data] of [[`/api/projects/${f.id}/runs`,{suite:'all'}],[`/api/projects/${f.id}/remove`,{confirmed:true,configHash}],['/api/system/settings',{dailyLimit:30}],['/api/logins',{baseURL:BASE}],['/api/ai/propose',{config:{},answers:{}}],
  [`/api/projects/${f.id}/runs/run-1/exam-ai`,{}],[`/api/projects/${f.id}/runs/run-1/exam-evidence`,{}],[`/api/projects/${f.id}/runs/run-1/exam-evidence-run`,{}]]){
  const r=await send(route,data);assert.equal(r.status,409,route);assert.equal((await r.json()).error,busy,route);
 }
 release();assert.equal((await first).status,200);
 const run=await send(`/api/projects/${f.id}/runs`,{suite:'all',ids:['check.nothing-here']});assert.equal(run.status,400);assert.notEqual((await run.json()).error,busy);
 const removed=await send(`/api/projects/${f.id}/remove`,{confirmed:true,configHash});assert.equal(removed.status,200,await removed.clone().text());
});

test('the estimate leaves room for one group added by the re-check',async t=>{
 const plugin=i=>({id:`check.plugin-${i}`,title:'プラグイン',suite:'audit',status:'fail',reason:'vulnerable',softwareSecurity:{component:'plugin',unknown:[],findings:[{title:'a',asset:{slug:`p${i}`,name:`P${i}`,version:'1.0'},cves:[`CVE-2026-${i}`],range:{max_version:'2.0',max_operator:'lt',unfixed:'0',closed:'0'}}]}});
 const f=await fixture(t,{runRows:Array.from({length:20},(_,i)=>plugin(i)),ai:{enabled:true,approved:true,evidenceApproved:true,dailyLimit:3}});
 const s=await f.status();assert.equal(s.groups,20);assert.equal(s.calls,4);assert.equal(s.available,false);
 assert.equal(s.reason,'本日のAI利用の残り回数が足りません（必要 4 回・残り 3 回）');
});

test('returns the check failure in Japanese and writes nothing',async t=>{
 const fetcher=fakeFetcher(i=>({...item(i),summary:`expect(received) が失敗しました ${i}。`}));
 const f=await fixture(t,{fetcher});
 const r=await f.post(),data=await r.json();assert.equal(r.status,422);assert.match(data.error,/文章の確認に通りませんでした/);
 assert(!fs.existsSync(path.join(f.run,'editor-report.html')));assert.equal((await f.status()).stage,null);
});

test('external-config sites cannot create editor reports',async t=>{
 const f=await fixture(t,{external:true});
 const ext=f.boot.projects.find(p=>p.id!==f.id);
 const s=await(await fetch(`${f.app.url}/api/projects/${ext.id}/runs/run-1/editor-report`)).json();
 assert.equal(s.available,false);assert.equal(s.reason,'登録済みサイトのみ作成できます');
});

test('page text in a failure reason is not sent to Claude but stays in the basis',async t=>{
 const reason="expect(locator).toHaveText(expected) Received: 'お客様の氏名 山田'";
 const f=await fixture(t,{runRows:[{id:'page.contact',title:'問い合わせ',suite:'audit',status:'fail',reason}]});
 const r=await f.post();assert.equal(r.status,200,await r.clone().text());
 assert.equal(f.fetcher.calls,1);
 const sent=JSON.stringify(f.fetcher.inputs);assert.doesNotMatch(sent,/山田|お客様|Received|toHaveText/);
 assert.deepEqual(f.fetcher.inputs[0][0].facts,{reasonKinds:[{kind:'page',errorClass:'assertion'}]});
 const basis=fs.readFileSync(path.join(f.run,'editor-report-basis.html'),'utf8');
 assert(basis.includes('Received: &#39;お客様の氏名 山田&#39;'));
});

// 実行後に登録URLが変わった場合、保存済みの閲覧パスワードを古い接続先へ送らない。
test('refuses when the run was made against a different site origin than the registered one',async t=>{
 const f=await fixture(t,{runBaseURL:'https://old.example.test'});
 const r=await f.post();assert.equal(r.status,409);assert.equal((await r.json()).error,'登録済みサイトのURLが実行時と異なります。新しく検査を実行してから作成してください');
 const s=await f.status();assert.equal(s.available,false);assert.equal(s.reason,'登録済みサイトのURLが実行時と異なります。新しく検査を実行してから作成してください');
 assert.equal(f.fetcher.calls,0);assert.equal(f.client.calls,0);
});
