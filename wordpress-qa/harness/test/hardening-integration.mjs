import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startUI} from '../ui/server.mjs';
import {journalIntent,summarizeRecovery} from '../lib/recovery.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=path.join(root,'.selftest','hardening-'+Date.now());fs.mkdirSync(scratch,{recursive:true});
const posts=new Map([[900,{id:900,slug:'real-editor-content',author:1,content:'Keep this post',status:'publish'}]]);let next=1,leak=false;
const fixture=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost'),admin=req.headers.authorization==='fixture-admin';let raw='';for await(const c of req)raw+=c;const data=raw?JSON.parse(raw):{};
 const send=(status,payload)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(payload));};
 if(u.pathname.endsWith('/users/me'))return send(admin?200:401,{id:1,roles:['administrator']});
 if(u.pathname==='/wp-json/wp/v2/posts'){
  if(!admin)return send(403,{});
  if(req.method==='POST'){const id=next++,p={...data,id,author:1,link:base+'/?p='+id};posts.set(id,p);return send(201,p);}
  return send(200,[...posts.values()].filter(p=>p.slug===u.searchParams.get('slug')));
 }
 const id=Number(u.pathname.match(/posts\/(\d+)/)?.[1]||u.searchParams.get('p')),p=posts.get(id);
 if(!p)return send(404,{});
 if(req.method==='DELETE'){if(!admin)return send(403,{});posts.delete(id);return send(200,{deleted:true});}
 if(req.method==='POST'){if(!admin)return send(403,{});Object.assign(p,data);return send(200,p);}
 if(!admin&&p.status!=='publish'&&!leak)return send(403,{code:'rest_cannot_read'});
 return send(200,p);
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+fixture.address().port;
const config={name:'Hardening fixture',baseURL:base,environment:'local',allowTestWrites:true,timeoutMs:3000,pages:[{id:'home',path:'/',canonical:base+'/',indexable:true,links:false}],outputDir:path.join(scratch,'runs'),checks:[{id:'scheduled',suite:'scheduled',kind:'wp-scheduled',options:{scheduleDelayMs:30000,pollIntervalMs:50,maxWaitMs:35000}}]};
const file=path.join(scratch,'site.json');fs.writeFileSync(file,JSON.stringify(config));
const previous=process.env.WPQA_UI_ADMIN_HEADERS;process.env.WPQA_UI_ADMIN_HEADERS=JSON.stringify({Authorization:'fixture-admin'});
const app=await startUI({configPaths:[file],port:0});
async function until(fn,label){const deadline=Date.now()+45000;while(Date.now()<deadline){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+label);}
try{
 const boot=await (await fetch(app.url+'/api/bootstrap')).json(),id=boot.projects[0].id;
 async function api(route,data){const r=await fetch(app.url+'/api/projects/'+id+route,data===undefined?{}:{method:'POST',headers:{Origin:app.url,'x-qa-token':boot.token,'content-type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
 assert.equal((await api('/runs',{suite:'scheduled'})).status,202);
 const runId=await until(async()=>{const s=(await api('')).data;return s.active?.runId&&[...posts.values()].some(p=>p.status==='future')&&s.active.runId;},'scheduled mutation');
 assert.equal((await api('/stop',{})).status,202);
 await until(()=>fs.existsSync(path.join(config.outputDir,runId,'cancel.request.json')),'cancel file');
 await until(async()=>!(await api('')).data.busy,'cancel completion');
 const cancelled=(await api('/runs/'+runId)).data;
 assert.equal(cancelled.report.runStatus,'interrupted');assert.equal(cancelled.report.gatePassed,false);assert.deepEqual([...posts.keys()],[900]);
 assert.equal(cancelled.recovery.pending,0);
 const diag=fs.readFileSync(path.join(config.outputDir,runId,'diagnostics','scheduled.jsonl'),'utf8');assert.match(diag,/"phase":"failure"/);assert.match(diag,/"phase":"http"/);assert(!diag.includes('fixture-admin'));
 leak=true;assert.equal((await api('/runs',{suite:'scheduled'})).status,202);await until(async()=>!(await api('')).data.busy,'failure completion');
 const history=(await api('')).data.runs;const failedId=history.find(r=>r.runId!==runId).runId;const failed=(await api('/runs/'+failedId)).data.report;
 assert.equal(failed.rows.find(r=>r.id==='check.scheduled').status,'fail');assert.equal(failed.gatePassed,false);assert.deepEqual([...posts.keys()],[900]);
 const failedDiag=fs.readFileSync(path.join(config.outputDir,failedId,'diagnostics','scheduled.jsonl'),'utf8');assert.match(failedDiag,/leaked/);assert.match(failedDiag,/"phase":"failure"/);
 const marker='wpqa-'+randomUUID(),orphanId=next++;posts.set(orphanId,{id:orphanId,slug:marker,author:2,status:'private',content:marker});
 const runDir=path.join(config.outputDir,runId);await journalIntent(runDir,{marker,site:base,rest:'/wp-json/wp/v2',collection:'/wp-json/wp/v2/posts',owner:1});
 assert.equal((await api('/runs/'+runId)).data.recovery.pending,1);assert.equal((await api('/runs',{suite:'scheduled'})).status,409);
 assert.equal((await api('/runs/'+runId+'/recover',{})).status,409);assert(posts.has(orphanId));assert(posts.has(900));
 posts.get(orphanId).author=1;const recovery=await api('/runs/'+runId+'/recover',{});assert.equal(recovery.status,200,JSON.stringify(recovery.data));assert.deepEqual([...posts.keys()],[900]);assert.equal((await summarizeRecovery(runDir)).pending,0);
 console.log('Cancellation, failure evidence, recovery owner isolation and launch gate passed: '+scratch);
}finally{await app.close();await new Promise(r=>fixture.close(r));if(previous===undefined)delete process.env.WPQA_UI_ADMIN_HEADERS;else process.env.WPQA_UI_ADMIN_HEADERS=previous;}


