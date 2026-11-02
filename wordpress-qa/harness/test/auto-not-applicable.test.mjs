import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProjectStore} from '../ui/project-store.mjs';
import {registrationConfig} from '../ui/registration.mjs';
import {catalog,validateConfig} from '../lib/config.mjs';
import {releaseGate} from '../lib/results.mjs';
import {latestResults} from '../lib/latest-results.mjs';
import {selectSingleTest} from '../lib/confirmation.mjs';
import {buildIssueReport} from '../lib/issue-report.mjs';
const orders=['coverage-order','coverage-order-record','coverage-order-cleanup','coverage-order-notification'],why='有効なプラグインに通販機能が見つからないため対象外（登録時の取得）';
const profile=(automation={pluginInventory:{observed:true,slugs:['contact-form-7']}})=>({timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false,automation});
function saved(t,p=profile(),environment='staging'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-auto-na-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new ProjectStore(path.join(root,'projects')),config=registrationConfig({name:'Auto NA',baseURL:'https://example.test',environment,profile:p,discovery:{pages:[{path:'/'}],warnings:[]}});
 const id=store.save({config,profile:p});return {root,store,id,config:store.context(id).config};
}
const passAllBut=(rows,keep)=>rows.map(r=>keep(r)?r:{...r,status:'pass'});
test('store.save writes autoNotApplicable for staging site without commerce plugins',t=>{
 const {root,store,id,config}=saved(t);
 assert.deepEqual(Object.keys(config.autoNotApplicable).sort(),[...orders,'coverage-membership'].sort());assert.equal(config.autoNotApplicable['coverage-order'],why);
 assert.equal(config.autoNotApplicable['coverage-membership'],'有効なプラグインに会員機能が見つからないため対象外（登録時の取得）');
 assert.deepEqual(store.record(id).config.autoNotApplicable,config.autoNotApplicable);
 const unobserved=saved(t,profile({pluginInventory:{observed:false,slugs:[]}}));assert(!('autoNotApplicable' in unobserved.config));
 const prod=saved(t,profile(undefined),'production');assert.deepEqual(Object.keys(prod.config.autoNotApplicable).sort(),['coverage-cache','coverage-contact-success','coverage-publishing','coverage-scheduled',...orders,'coverage-membership'].sort());
 const bare=new ProjectStore(path.join(root,'bare')),plain=bare.save({config:{name:'Plain',baseURL:'https://plain.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://plain.test/',indexable:false}]}});assert(!('autoNotApplicable' in bare.record(plain).config));
 const hash=bare.context(plain).configHash,view=bare.view(plain);bare.save({id:plain,version:view.version,config:view.config});assert.equal(bare.context(plain).configHash,hash);assert(!('autoNotApplicable' in bare.record(plain).config));
 for(const bad of [[],{'Bad Id':'x'},{'coverage-order':''},{'coverage-order':'x'.repeat(501)},{'coverage-order':1},{'auto-security-transport':'x'},{'coverage-publishing':'x'}])assert.throws(()=>validateConfig({...config,autoNotApplicable:bad}),/autoNotApplicable/,JSON.stringify(bad));
 assert.equal(validateConfig({...config,autoNotApplicable:{'coverage-order':'x'.repeat(500)}}).autoNotApplicable['coverage-order'].length,500);
});
test('catalog turns autoNotApplicable checks into reasoned not_applicable rows that are not selected',t=>{
 const {config}=saved(t),rows=catalog(config),row=rows.find(r=>r.id==='check.coverage-order');
 assert.equal(row.status,'not_applicable');assert.equal(row.autoNotApplicable,true);assert.equal(row.selected,false);assert.equal(row.reason,why);assert(!('preparationRequired' in row));
 for(const id of [...orders,'coverage-membership'])assert.equal(rows.find(r=>r.id==='check.'+id).status,'not_applicable',id);
 assert(rows.find(r=>r.id==='check.coverage-publishing').preparationRequired);assert(!rows.find(r=>r.id==='check.coverage-publishing').autoNotApplicable);
 for(const suite of ['standard','interaction','commerce'])assert.equal(catalog(config,suite).find(r=>r.id==='check.coverage-order').selected,false,suite);
 assert.throws(()=>selectSingleTest(catalog(config),'check.coverage-order'),/対象外/);
 const latest=latestResults(rows,'h',[]);assert.equal(latest.rows.find(r=>r.id==='check.coverage-order').status,'not_applicable');assert.equal(latest.rows.find(r=>r.id==='check.coverage-order').autoNotApplicable,true);
});
test('releaseGate passes when only auto not_applicable rows remain besides passes',t=>{
 const {config}=saved(t),rows=catalog(config);
 assert.equal(releaseGate(passAllBut(rows,r=>r.autoNotApplicable)),true);
 assert.equal(releaseGate(passAllBut(rows,r=>r.autoNotApplicable||r.id==='check.coverage-cache')),false);
});
test('relevant override restores preparationRequired and gate fails again',t=>{
 const {config}=saved(t,profile({pluginInventory:{observed:true,slugs:['contact-form-7']},relevantOverrides:['coverage-membership']})),rows=catalog(config),row=rows.find(r=>r.id==='check.coverage-membership');
 assert(!config.autoNotApplicable['coverage-membership']);assert.equal(config.autoNotApplicable['coverage-order'],why);
 assert.equal(row.preparationRequired,true);assert.equal(row.status,'not_run');assert(!row.autoNotApplicable);
 assert.equal(releaseGate(passAllBut(rows,r=>r.autoNotApplicable||r.preparationRequired)),false);
 const prod=saved(t,profile({pluginInventory:{observed:true,slugs:[]},relevantOverrides:['coverage-publishing']}),'production');assert(prod.config.autoNotApplicable['coverage-publishing']);
});
test('results.json rows keep not_applicable after a run',async t=>{
 const {root,config}=saved(t),runDir=path.join(root,'run');fs.mkdirSync(runDir);
 const rows=catalog(config);selectSingleTest(rows,'check.auto-security-transport');
 const report={name:config.name,baseURL:config.baseURL,environment:config.environment,runId:'r1',rows,errors:[],runStatus:'starting'};
 const ctxFile=path.join(root,'ctx.json');fs.writeFileSync(ctxFile,JSON.stringify({config,runDir,report}));
 const previous=process.env.WPQA_CONTEXT;process.env.WPQA_CONTEXT=ctxFile;t.after(()=>{if(previous===undefined)delete process.env.WPQA_CONTEXT;else process.env.WPQA_CONTEXT=previous;});
 const {default:Reporter}=await import('../lib/reporter.mjs'),reporter=new Reporter();
 const testCase={title:'check.auto-security-transport | x',annotations:[]};
 reporter.onBegin();reporter.onTestBegin(testCase);reporter.onTestEnd(testCase,{status:'passed',duration:1,errors:[],attachments:[]});reporter.onEnd({status:'passed'});
 const written=JSON.parse(fs.readFileSync(path.join(runDir,'results.json'),'utf8')),find=id=>written.rows.find(r=>r.id===id);
 assert.equal(find('check.auto-security-transport').status,'pass');
 for(const id of [...orders,'coverage-membership']){const r=find('check.'+id);assert.equal(r.status,'not_applicable',id);assert.equal(r.autoNotApplicable,true);assert.equal(r.selected,false);assert(r.reason.includes('対象外'));}
 assert.equal(written.summary.not_applicable,5);
});
test('issue report shows 自動判定 for auto not_applicable rows',()=>{
 const current={runId:'now',startedAt:'2026-11-02',finishedAt:'2026-11-02',runStatus:'finished',configHash:'h',baseURL:'https://example.test',environment:'staging',name:'QA',rows:[{id:'check.coverage-order',title:'注文',status:'not_applicable',autoNotApplicable:true,selected:false,reason:why},{id:'manual.x',title:'手動',status:'not_applicable',reason:'手で対象外'}]};
 const {html}=buildIssueReport({current,readEvidence:()=>({})});
 assert.match(html,/注文 — check\.coverage-order（対象外・自動判定）/);assert(html.includes(why));assert(!html.includes('手動 — manual.x（対象外・自動判定）'));
});
test('only the tool own judgements can be auto not_applicable',t=>{
 const {config}=saved(t),prod=saved(t,profile(),'production').config;
 assert.throws(()=>validateConfig({...config,autoNotApplicable:{'auto-security-transport':'理由'}}),/autoNotApplicable/);
 assert.throws(()=>validateConfig({...config,autoNotApplicable:{'coverage-cache':'理由'}}),/autoNotApplicable/);
 assert.equal(validateConfig({...prod,autoNotApplicable:{'coverage-cache':'理由'}}).autoNotApplicable['coverage-cache'],'理由');
 const forged=catalog({...config,autoNotApplicable:{'auto-security-transport':'理由','coverage-publishing':'理由','coverage-order':'理由'}});
 assert.equal(forged.find(r=>r.id==='check.auto-security-transport').status,'not_run');assert(!forged.find(r=>r.id==='check.coverage-publishing').autoNotApplicable);assert.equal(forged.find(r=>r.id==='check.coverage-order').autoNotApplicable,true);
});
test('store.save ignores a stale or malformed autoNotApplicable sent by the client',t=>{
 const {store,id,config}=saved(t);
 for(const stale of [[],{'auto-security-transport':'x'},{'coverage-order':''}]){const v=store.view(id);store.save({id,version:v.version,config:{...v.config,autoNotApplicable:stale},profile:v.profile});assert.deepEqual(store.record(id).config.autoNotApplicable,config.autoNotApplicable);}
 const bare=new ProjectStore(path.join(path.dirname(store.directory),'bare')),plain=bare.save({config:{name:'Plain',baseURL:'https://plain.test',environment:'staging',autoNotApplicable:{'coverage-order':'x'},pages:[{id:'home',path:'/',canonical:'https://plain.test/',indexable:false}]}});
 assert(!('autoNotApplicable' in bare.record(plain).config));
});
