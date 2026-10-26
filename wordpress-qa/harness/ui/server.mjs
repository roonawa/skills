import {suites as extendedSuites} from '../lib/checks/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {BrowserLogin} from './browser-login.mjs';
import {ProjectStore} from './project-store.mjs';
import {ExternalAuth} from './external-auth.mjs';
import {discoverRegistration,registrationConfig,validateProfile,builtinModules} from './registration.mjs';
import { loadConfig,catalog } from '../lib/config.mjs';
import {writeReport} from '../lib/results.mjs';
import {summarizeRecovery} from '../lib/recovery.mjs';
import {preflight} from '../lib/preflight.mjs';
import {guidance} from '../lib/guidance.mjs';
import {confirmationPlan,validateConfirmation,selectSingleTest} from '../lib/confirmation.mjs';
import {operationRequest} from '../lib/operations.mjs';
import {buildIssueReport} from '../lib/issue-report.mjs';
import {autoReport} from '../lib/auto-report.mjs';
import {projectIsAlive,runIsAlive} from '../lib/run-lock.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicDir=path.join(root,'ui','public');
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
const reject=(status,message)=>{throw new HttpError(status,message);};
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function boundedPath(directory,relative) {
  const base=fs.realpathSync(directory),file=fs.realpathSync(path.resolve(directory,relative));
  const rel=path.relative(base,file);
  if(rel.startsWith('..')||path.isAbsolute(rel)) reject(403,'アクセスできないファイルです');
  return file;
}
async function body(req) {
  let data='';for await(const chunk of req){data+=chunk;if(data.length>1048576)reject(413,'リクエストが大きすぎます');}
  try{return JSON.parse(data);}catch{reject(400,'JSON形式が不正です');}
}
function projectInfo(project) {
  if(project.managed)return project.store.context(project.id);
  const ctx=loadConfig(project.file),c=ctx.config;
  const outputDir=path.resolve(ctx.configDir,c.outputDir??'runs');
  if(outputDir!==project.outputDir) reject(409,'出力先が変更されています。アプリを再起動してください');
  return {...ctx,outputDir,baselineDir:path.resolve(ctx.configDir,c.baselineDir??'baselines')};
}

export async function startUI({configPaths=[],port=4310,demo=false,storeDir,loginOptions,trustedAdapters={}}) {
  const logins=new BrowserLogin(loginOptions);
  const store=storeDir?new ProjectStore(storeDir,{trustedAdapters}):null;
  const externalAuth=storeDir?new ExternalAuth(path.join(storeDir,'external-auth')):null;
  const token=randomBytes(24).toString('hex'),projects=new Map(),outputDirs=new Set();
  for(const filename of configPaths) {
    const ctx=loadConfig(filename),outputDir=path.resolve(ctx.configDir,ctx.config.outputDir??'runs');
    if(outputDirs.has(outputDir)) throw new Error('Each UI project must have a distinct outputDir');outputDirs.add(outputDir);
    const id=createHash('sha256').update(ctx.configPath).digest('hex').slice(0,12);
    projects.set(id,{id,file:ctx.configPath,outputDir});
  }
  function registerManaged(id){const ctx=store.context(id);projects.set(id,{id,file:ctx.configPath,outputDir:ctx.outputDir,managed:true,store});}
  if(store)for(const id of store.ids())registerManaged(id);
  let active=null,lastJob=null,closing=false,url;
  const jobs=new Set();
  const getProject=id=>{const p=projects.get(id);if(!p)reject(404,'登録されていないサイトです');return p;};
  function profileScope(p,current=projectInfo(p)){
    const profile=p.managed?store.record(p.id).profile:null;
    if(!profile)return null;
    const c=current.config,writeAllowed=['staging','local'].includes(c.environment)&&c.allowTestWrites===true&&profile.writes===true;
    const has=kind=>c.journeys.some(j=>j.module===builtinModules[kind]);
    return {mode:'saved-profile',writeAllowed,contactSubmit:writeAllowed&&profile.submit===true&&has('contact-submit'),bankOrder:writeAllowed&&profile.bankOrder===true&&has('bank-order'),postLifecycle:writeAllowed&&has('post-lifecycle'),scheduled:writeAllowed&&has('scheduled')};
  }
  function contactSubmission(directory){
    const file=path.join(directory,'profile-contact-pending.json');
    const exists=name=>{try{fs.lstatSync(name);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
    let locked=false;
    try{
      locked=exists(file+'.lock');
      if(!exists(file))return {status:'none',locked,blocked:locked,readOnly:true,inboxVerified:false};
      const stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw Error('Invalid journal');
      const saved=readJSON(boundedPath(directory,'profile-contact-pending.json'));
      if(!['pending','mail_sent'].includes(saved.status)||typeof saved.token!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(saved.token))throw Error('Invalid journal');
      return {status:saved.status,token:saved.token,locked,blocked:locked||saved.status==='pending',readOnly:true,inboxVerified:false};
    }catch{return {status:'unreadable',locked,blocked:true,readOnly:true,inboxVerified:false};}
  }
  function runPath(p,id) {
    if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,128}$/.test(id)) reject(400,'実行IDが不正です');
    try{return boundedPath(p.outputDir,id);}catch(e){if(e.status)throw e;reject(404,'実行履歴が見つかりません');}
  }
  function readRun(p,id){try{
    const directory=runPath(p,id),report=readJSON(boundedPath(directory,'results.json'));
    for(const row of report.rows??[]) {
      const checkId=row.id?.startsWith('check.')?row.id.slice(6):'';
      if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(checkId))continue;
      try {
        const journal=`diagnostics/${checkId}.jsonl`,file=boundedPath(directory,journal);
        if(!fs.statSync(file).isFile()||fs.statSync(file).size>8*1024*1024)continue;
        const events=fs.readFileSync(file,'utf8').split('\n').flatMap(line=>{try{const event=JSON.parse(line);return event&&typeof event==='object'&&!Array.isArray(event)?[event]:[];}catch{return [];}});
        if(events.length){
          row.diagnostics={checkId,kind:events[0].kind,events,journal};row.evidence=[...new Set([...(row.evidence??[]),journal])];
          for(const event of events)if(event.kind==='artifact'&&typeof event.file==='string')try{
            const artifact=boundedPath(directory,event.file);
            if(fs.statSync(artifact).isFile())row.evidence.push(path.relative(directory,artifact).split(path.sep).join('/'));
          }catch{}
          row.evidence=[...new Set(row.evidence)];
        }
      }catch{}
    }
    return report;
  }catch(e){if(e.status)throw e;reject(404,'結果がまだ保存されていません');}}
  function history(p,limit=100) {
    if(!fs.existsSync(p.outputDir))return [];
    return fs.readdirSync(p.outputDir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>{
      try {const directory=runPath(p,e.name),r=readJSON(path.join(directory,'results.json'));return {runId:e.name,startedAt:r.startedAt,finishedAt:r.finishedAt,runStatus:r.runStatus,gatePassed:r.gatePassed,summary:r.summary,pendingRecovery:summarizeRecovery(directory).pending};}catch{return null;}
    }).filter(Boolean).sort((a,b)=>(b.startedAt??b.runId).localeCompare(a.startedAt??a.runId)).filter((r,index)=>index<limit||r.pendingRecovery);
  }
  function jobState(job){return job?{projectId:job.projectId,kind:job.kind,runId:job.runId,state:job.state,exitCode:job.exitCode,log:job.log}:null;}
  function launch(p,args,kind,operationEnv={}) {
    if(closing)reject(503,'終了処理中です');if(active)reject(409,'別の処理が実行中です。完了を待ってください');
    if(['run','recover'].includes(kind)&&projectIsAlive(p.outputDir))reject(409,'以前の検査プロセスが生存している可能性があります。終了を待ってください。');
    if(logins.busy)reject(409,'ログインの保存またはキャンセル後に実行してください');
    const prepared=p.managed?store.prepare(p.id):externalAuth?.prepare(p.id,projectInfo(p).config)??{env:{}};
    if(kind==='run'&&fs.existsSync(p.outputDir))for(const entry of fs.readdirSync(p.outputDir,{withFileTypes:true}).filter(e=>e.isDirectory()))if(summarizeRecovery(runPath(p,entry.name)).pending)reject(409,'前回のテストデータが残っています。該当する実行履歴から回収してください');
    const job={projectId:p.id,kind,runId:null,state:'starting',log:'',exitCode:null};active=job;lastJob=job;
    const inheritedEnv={...process.env};
    delete inheritedEnv.WPQA_OPERATION_ID;delete inheritedEnv.WPQA_OPERATION_MODE;
    if(p.managed)for(const key of Object.keys(inheritedEnv))if(/^WPQA_(?:ROLE_.*|UI_ADMIN)_(HEADERS|STATE)$/i.test(key))delete inheritedEnv[key];
    const child=spawn(process.execPath,[path.join(root,'bin/qa.mjs'),...args],{cwd:root,env:{...inheritedEnv,...prepared.env,...operationEnv,FORCE_COLOR:'0'},stdio:['ignore','pipe','pipe','ipc']});
    job.cancel=()=>{if(child.connected)child.send({type:'cancel'});job.state='stopping';};
    const append=chunk=>{
      job.log=(job.log+chunk.toString().replace(/\x1b\[[0-9;]*m/g,'')).slice(-128000);
      if(job.runId)try{fs.writeFileSync(path.join(runPath(p,job.runId),'ui.log'),job.log);}catch{}
    };
    child.stdout.on('data',append);child.stderr.on('data',append);
    child.on('message',message=>{
      if(message.type==='run-started' && typeof message.runId==='string') {
        // Trust only a run inside the registered output directory, not an arbitrary child path.
        try {runPath(p,message.runId);job.runId=message.runId;job.state='running';}catch{}
      }
    });
    const done=new Promise(resolve=>{
      let ended=false;
      const finish=(code,error)=>{if(ended)return;ended=true;if(error)append(error.message);if(kind==='run'&&job.runId)try{const directory=runPath(p,job.runId),generated=autoReport(directory),report=readRun(p,job.runId);report.autoReport=generated;if(report.rows[0])report.rows[0].evidence=[...new Set([...(report.rows[0].evidence??[]),'issue-report.html'])];writeReport(directory,report);append('\n報告書を自動生成しました: issue-report.html\n');}catch(e){append('\n報告書の自動生成に失敗: '+e.message+'\n');}job.exitCode=code;job.state='finished';if(active===job)active=null;resolve(jobState(job));};
      child.once('error',e=>finish(2,e));child.once('close',code=>finish(code??2));
    });
    jobs.add(done);done.finally(()=>jobs.delete(done));return {job,done};
  }
  function saveSettings(data,projectId=null){
    if(active||closing)reject(409,'実行完了後に保存してください');
    const auth=data.auth??{},loginId=auth.browserLoginId;
    if(logins.busy&&!loginId)reject(409,'進行中のログインを確認・保存するか、キャンセルしてください');
    if(loginId&&auth.browser)reject(400,'ログインとファイル取込みは同時に指定できません');
    const role=auth.browserLoginRole;
    const persist=state=> {
      const savedAuth={...auth};
      delete savedAuth.browserLoginId;delete savedAuth.browserLoginRole;
      if(state&&role) {
        const credentials=[...(savedAuth.roleCredentials??[])];
        const index=credentials.findIndex(c=>c.name===role);
        if(index<0)credentials.push({name:role,browser:state});else credentials[index]={...credentials[index],browser:state};
        savedAuth.roleCredentials=credentials;
      } else if(state) savedAuth.browser=state;
      return store.save({id:projectId??undefined,version:data.version,config:data.config,auth:savedAuth,profile:data.profile});
    };
    try{return loginId?logins.save(loginId,{baseURL:data.config.baseURL,projectId,role},persist):persist();}catch(e){reject(400,e.message);}
  }
  const server=createServer(async(req,res)=>{
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      const address=server.address(),hosts=[`127.0.0.1:${address.port}`,`localhost:${address.port}`];
      if(!hosts.includes(req.headers.host))reject(403,'ローカルからアクセスしてください');
      const target=new URL(req.url,url),segments=target.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
      if(!['GET','POST'].includes(req.method))reject(405,'対応していない操作です');
      if(req.method==='POST') {
        if(!hosts.map(h=>`http://${h}`).includes(req.headers.origin)||req.headers['x-qa-token']!==token)reject(403,'操作元を確認できません。画面を再読込してください');
        if(!req.headers['content-type']?.startsWith('application/json'))reject(415,'JSON形式で送信してください');
      }
      if(target.pathname==='/api/bootstrap'&&req.method==='GET') {
        const list=[...projects.values()].map(p=>{
          try{const {config:c,configHash}=projectInfo(p);return {id:p.id,name:c.name,baseURL:c.baseURL,environment:c.environment,configHash};}
          catch(e){return {id:p.id,name:path.basename(p.file),error:e.message};}
        });return json(200,{token,projects:list,demo,canRegister:!!store});
      }
      if(target.pathname==='/api/logins/current'&&req.method==='GET')return json(200,{login:logins.status()});
      if(target.pathname==='/api/registration'&&req.method==='POST'){
        if(!store||active||closing)reject(409,'実行完了後に登録してください');
        const data=await body(req),profile=validateProfile(data.profile,data.environment);
        const session=logins.get(data.loginId);
        if(session.phase!=='verified'||session.projectId||session.role||session.baseURL!==data.baseURL||session.environment!==data.environment)reject(400,'このサイトの管理者ログインを確認してください');
        const discovery=await discoverRegistration({baseURL:data.baseURL,profile,state:session.state,publicPassword:data.publicPassword??''});
        const config=registrationConfig({...data,profile,discovery});
        const id=saveSettings({config,profile,auth:{browserLoginId:data.loginId,publicPassword:data.publicPassword??''}});
        registerManaged(id);return json(201,{id,pages:config.pages.length,cases:catalog(projectInfo(getProject(id)).config).length,warnings:discovery.warnings});
      }
      if(segments[0]==='api'&&segments[1]==='logins'&&req.method==='POST') {
        if(!store)reject(503,'サイト登録が無効です');
        const data=await body(req);
        if(active||closing)reject(409,'実行完了後にログインしてください');
        try{
          if(segments.length===2){
            if(data.projectId){const p=getProject(data.projectId),c=projectInfo(p).config;if(!p.managed&&(data.baseURL!==c.baseURL||data.environment!==c.environment||data.role))reject(400,'登録済みサイトの既定管理者としてログインしてください');}
            return json(201,await logins.start(data));
          }
          if(segments.length===4&&segments[3]==='verify')return json(200,await logins.verify(segments[2]));
          if(segments.length===4&&segments[3]==='cancel'){await logins.cancel(segments[2]);return json(200,{ok:true});}
        }catch(e){reject(e.status??400,e.message);}
        reject(404,'ログイン操作が見つかりません');
      }
      if(segments[0]==='api'&&segments[1]==='projects') {
        if(segments.length===2&&req.method==='POST') {
          if(!store)reject(503,'この起動ではサイト登録が無効です');if(active)reject(409,'実行完了後に登録してください');
          const data=await body(req);let id;
          id=saveSettings(data);
          registerManaged(id);return json(201,{id});
        }
        const p=getProject(segments[2]);
        if(segments[3]==='auth'&&segments.length===4){
          if(p.managed||!externalAuth)reject(400,'このサイトは設定を編集から認証を登録してください');
          const c=projectInfo(p).config;
          if(req.method==='GET')return json(200,{...externalAuth.status(p.id,c),baseURL:c.baseURL,environment:c.environment});
          if(active||closing||projectIsAlive(p.outputDir))reject(409,'実行完了後に認証を保存してください');
          const data=await body(req);if(Object.keys(data).some(k=>k!=='loginId')||typeof data.loginId!=='string')reject(400,'確認済みログインを指定してください');
          logins.save(data.loginId,{baseURL:c.baseURL,projectId:p.id},state=>externalAuth.save(p.id,c,state));
          return json(200,{ok:true,...externalAuth.status(p.id,c)});
        }
        if(segments[3]==='preflight'&&segments.length===4&&req.method==='GET'){
          const config=projectInfo(p).config,env=p.managed?store.prepare(p.id).env:{...process.env,...externalAuth?.prepare(p.id,config).env};
          return json(200,preflight(config,env));
        }
        if(segments[3]==='stop'&&segments.length===4&&req.method==='POST'){
          if(active?.projectId!==p.id||active.kind!=='run')reject(409,'停止対象の検査がありません');
          active.cancel();return json(202,{ok:true,message:'停止を要求しました。現在の処理の後片付けを待っています。'});
        }
        if(segments[3]==='settings'&&segments.length===4) {
          if(req.method==='GET')return json(200,p.managed?store.view(p.id):{config:projectInfo(p).config,managed:false,credentials:{rest:false,browser:false}});
          if(!p.managed)reject(403,'起動時に指定した設定はファイルで管理されています。新しいサイトとして登録してください');
          if(active)reject(409,'実行完了後に設定を変更してください');
          const data=await body(req);
          saveSettings(data,p.id);
          registerManaged(p.id);return json(200,{id:p.id});
        }
        if(segments.length===3&&req.method==='GET') {
          const current=projectInfo(p),{config:c,configHash}=current;
          return json(200,{project:{id:p.id,managed:!!p.managed,profileScope:profileScope(p,current),name:c.name,baseURL:c.baseURL,environment:c.environment,configPath:p.file,configHash,counts:{pages:c.pages.length,journeys:c.journeys.length,visuals:c.visuals.length},planned:catalog(c).length},runs:history(p),busy:!!active,active:jobState(active),lastJob:lastJob?.projectId===p.id?jobState(lastJob):null});
        }
        if(segments[3]==='operations'){
          const current=projectInfo(p),scope=profileScope(p,current);
          if(scope){
            if(segments.length===4&&req.method==='GET')return json(200,{configHash:current.configHash,baseURL:current.config.baseURL,environment:current.config.environment,profileScope:scope,enabled:false,operations:[],contactSubmission:contactSubmission(current.configDir)});
            if(req.method==='POST')reject(409,'登録時の実行範囲を使用します。送信結果が不明な記録はこの画面から解除・再送できません。');
          }
          if(segments.length===4&&req.method==='GET')return json(200,{configHash:current.configHash,baseURL:current.config.baseURL,environment:current.config.environment,enabled:current.config.allowTestWrites&&['staging','local'].includes(current.config.environment),operations:current.config.journeys.filter(j=>j.explicitOnly).map(j=>{let pending=null;if(j.submissionLock&&fs.existsSync(path.resolve(current.configDir,j.submissionLock))){const saved=readJSON(boundedPath(current.configDir,j.submissionLock));pending={token:saved.token,completion:saved.completion===true,cleanup:saved.cleanup??'結果を確認してください'};}return {id:j.id,title:j.title??j.id,description:j.reason??'',pending};})});
          if(segments.length===6&&segments[5]==='release'&&req.method==='POST'){
            if(active||closing)reject(409,'実行が終了してから確認してください');
            const data=await body(req),operation=current.config.journeys.find(j=>j.id===segments[4]&&j.explicitOnly);
            if(!operation?.submissionLock||data.configHash!==current.configHash||data.confirmed!==true||typeof data.notes!=='string'||!data.notes.trim()||data.notes.length>10000)reject(400,'現在の設定で前回結果・後片付けの確認内容を入力してください');
            const lock=boundedPath(current.configDir,operation.submissionLock),saved=readJSON(lock);
            if(data.token!==saved.token)reject(409,'前回の識別子が変わっています。開き直してください');
            fs.writeFileSync(lock+'.resolved-'+randomUUID()+'.json',JSON.stringify({...saved,resolvedAt:new Date().toISOString(),resolution:data.notes},null,2),{flag:'wx'});fs.unlinkSync(lock);
            return json(200,{ok:true});
          }
          if(segments.length===5&&req.method==='POST'){
            const data=await body(req);let prepared;
            try{prepared=operationRequest(current.config,current.configHash,segments[4],data);}catch(e){reject(400,e.message);}
            const {job}=launch(p,['run','--config',p.file,'--suite','journey','--id','journey.'+prepared.operation.id],'run',prepared.env);return json(202,jobState(job));
          }
        }
        if(segments[3]==='runs'&&segments.length===4&&req.method==='POST') {
          const data=await body(req);if(!['all','audit','journey','visual','admin',...Object.keys(extendedSuites)].includes(data.suite))reject(400,'検査範囲が不正です');const current=projectInfo(p);
          const operations=!profileScope(p,current)&&['all','journey'].includes(data.suite)?current.config.journeys.filter(j=>j.runWithSuite&&j.explicitOnly):[];
          let env={};if(operations.length){
            const options={configHash:current.configHash,mode:'preview',password:'',...data.operation};
            // Preview is the normal default; real submission requires an explicit checkbox.
            if(options.mode==='preview')options.confirmed=true;
            try{env=operationRequest(current.config,current.configHash,operations[0].id,options).env;}catch(e){reject(400,e.message);}
            env.WPQA_OPERATION_ID='suite';
          }
          const {job}=launch(p,['run','--config',p.file,'--suite',data.suite],'run',env);return json(202,jobState(job));
        }
        if(segments[3]==='runs'&&segments[4]) {
          const id=segments[4],report=readRun(p,id),directory=runPath(p,id);
          if(segments[5]==='confirmation'&&segments.length===7){
            const row=report.rows.find(r=>r.id===segments[6]);if(!row)reject(404,'検査項目が見つかりません');
            const current=projectInfo(p),plan=confirmationPlan(row);
            if(req.method==='GET')return json(200,{...plan,changed:current.configHash!==report.configHash});
            if(req.method==='POST'){
              const data=await body(req);
              if(active||closing||runIsAlive(directory)||report.runStatus!=='finished'||current.configHash!==report.configHash)reject(409,'実行完了後、現在の設定と一致する履歴で確認してください');
              let result;try{result=validateConfirmation(plan,data);}catch(e){reject(400,e.message);}
              const audit={...result,timestamp:new Date().toISOString(),runId:id,rowId:row.id,configHash:current.configHash,previousStatus:row.status};
              const original=path.join(directory,'automated-results.json');if(!fs.existsSync(original))fs.writeFileSync(original,JSON.stringify(report,null,2),{flag:'wx'});
              fs.mkdirSync(path.join(directory,'manual-reviews'),{recursive:true});
              const evidence=`manual-reviews/${randomUUID()}.json`;fs.writeFileSync(path.join(directory,evidence),JSON.stringify(audit,null,2),{flag:'wx'});
              row.details={...row.details,confirmation:audit};row.status=result.outcome;
              row.reason=(data.finish?'確認完了':'確認途中')+'：'+result.steps.map(s=>`${plan.steps.find(p=>p.id===s.id).title}: ${s.status} ${s.evidence}`).join('\n')+'\n'+result.notes;
              row.evidence=[...new Set([...(row.evidence??[]),evidence])];
              row.review={...audit,reviewId:evidence,evidence:result.steps.map(s=>s.evidence).filter(Boolean)};
              writeReport(directory,report);return json(200,{ok:true,report});
            }
          }
          if(segments[5]==='execute'&&segments.length===6&&req.method==='POST'){
            const data=await body(req),current=projectInfo(p);
            if(report.runStatus!=='finished'||current.configHash!==report.configHash)reject(409,'現在の設定で完了した履歴を選択してください');
            const row=report.rows.find(r=>r.id===data.rowId);if(!row)reject(404,'検査項目が見つかりません');
            if(current.config.journeys.some(j=>j.explicitOnly&&row.id==='journey.'+j.id))reject(400,'操作テストの画面で送信内容を確認して実行してください');
            try{selectSingleTest(catalog(current.config),row.id);}catch(e){reject(400,e.message);}
            const {job}=launch(p,['run','--config',p.file,'--suite',row.suite,'--id',row.id],'run');return json(202,jobState(job));
          }
          if(segments[5]==='issue-report'&&segments.length===6&&req.method==='POST'){
            if(report.runStatus!=='finished'||!report.finishedAt||runIsAlive(directory))reject(409,'完了した実行を選択してください');
            const data=await body(req);
            if(typeof data.includeHistory!=='boolean'||typeof (data.notes??'')!=='string'||(data.notes??'').length>10000)reject(400,'報告書の指定が不正です');
            const previous=data.includeHistory?history(p,10000).filter(r=>r.runId!==id).map(r=>readRun(p,r.runId)):[];
            const generated=buildIssueReport({current:report,previous,includeHistory:data.includeHistory,notes:data.notes??'',readImage:(runId,file)=>{
              const source=runId===id?report:previous.find(r=>r.runId===runId);
              if(!file.endsWith('.png')||!source?.rows.some(r=>(r.evidence??[]).includes(file)))throw new Error('Unregistered image');
              const image=boundedPath(runPath(p,runId),file);
              if(fs.statSync(image).size>12*1024*1024)throw new Error('Image too large');
              const buffer=fs.readFileSync(image);
              if(buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Invalid PNG');
              return `data:image/png;base64,${buffer.toString('base64')}`;
            },readConfig:runId=>{
              const context=readJSON(boundedPath(runPath(p,runId),'context.json'));
              const source=runId===id?report:previous.find(r=>r.runId===runId);
              if(context.configHash!==source?.configHash)throw new Error('Config mismatch');
              const {pages,visuals,policies}=context.config;return {pages,visuals,policies};
            },readEvidence:(runId,file)=>{
              const source=runId===id?report:previous.find(r=>r.runId===runId);
              if(!source?.rows.some(r=>(r.evidence??[]).includes(file)))reject(403,'未登録の証拠です');
              const evidence=boundedPath(runPath(p,runId),file);
              if(fs.statSync(evidence).size>16*1024*1024)throw new Error('Evidence too large');
              return readJSON(evidence);
            }});
            fs.writeFileSync(path.join(directory,'issue-report.html'),generated.html);
            return json(200,{file:'issue-report.html',issueCount:generated.issueCount,failedCases:generated.failedCases,warnings:generated.warnings});
          }
          if(segments.length===5&&req.method==='GET') {
            let log='';try{log=fs.readFileSync(path.join(directory,'ui.log'),'utf8');}catch{}
            const {configHash}=projectInfo(p);
            const candidates=report.rows.filter(r=>r.id.startsWith('snapshot.')&&fs.existsSync(path.join(directory,'candidates',`${r.id}.png`))).map(r=>r.id);
            return json(200,{report,log,candidates,recovery:summarizeRecovery(directory),canApprove:report.configHash===configHash&&!active&&!runIsAlive(directory),orphaned:['running','starting'].includes(report.runStatus)&&active?.runId!==id&&!runIsAlive(directory)});
          }
          if(segments[5]==='guidance'&&segments.length===7&&req.method==='GET'){
            const row=report.rows.find(r=>r.id===segments[6]);if(!row)reject(404,'検査項目が見つかりません');
            const current=projectInfo(p),env=p.managed?store.prepare(p.id).env:process.env;
            return json(200,guidance({config:current.config,row,env,changed:current.configHash!==report.configHash,managed:!!p.managed}));
          }
          if(segments[5]==='recover'&&segments.length===6&&req.method==='POST'){
            if(active)reject(409,'実行中は回収できません');
            if(projectIsAlive(p.outputDir)||runIsAlive(directory))reject(409,'検査プロセスが生存している可能性があるため回収できません');
            if(['running','starting'].includes(report.runStatus)){
              report.runStatus='interrupted';report.finishedAt=new Date().toISOString();
              for(const row of report.rows)if(row.active){row.active=false;row.status='blocked';row.reason='中断された検査です。再実行が必要です。';}
              writeReport(directory,report);
            }
            const {done}=launch(p,['recover','--config',p.file,'--run',directory],'recover');
            const outcome=await done;return json(outcome.exitCode===0?200:409,{ok:outcome.exitCode===0,message:outcome.log});
          }
          if(segments[5]==='approve'&&segments.length===6&&req.method==='POST') {
            const data=await body(req);if(data.confirmed!==true)reject(400,'画像の確認が必要です');
            if(typeof data.id!=='string'||!/^snapshot\.[a-z][a-z0-9-]{0,63}$/.test(data.id))reject(400,'画像IDが不正です');
            projectInfo(p);const {done}=launch(p,['approve-baseline','--config',p.file,'--run',directory,'--id',data.id],'approve');
            const outcome=await done;return json(outcome.exitCode===0?200:409,{ok:outcome.exitCode===0,message:outcome.log});
          }
          if(segments[5]==='review'&&segments.length===6&&req.method==='POST') {
            const data=await body(req);
            Object.assign(report,readRun(p,id));
            if(active||closing||report.runStatus!=='finished'||!report.finishedAt)reject(409,'実行完了後にレビューしてください');
            const {configHash}=projectInfo(p);
            if(report.configHash!==configHash)reject(409,'設定が変更されています。現在の設定で再実行してください');
            if(!data||Object.keys(data).some(k=>!['rowId','outcome','reviewer','notes','evidence'].includes(k)))reject(400,'レビュー項目が不正です');
            const row=report.rows.find(r=>r.id===data.rowId);
            if(!row||row.manualReview!==true)reject(400,'この項目は手動レビュー対象ではありません');
            if(!['pass','fail','not_applicable'].includes(data.outcome))reject(400,'レビュー結果が不正です');
            if(!['reviewer','notes'].every(k=>typeof data[k]==='string'&&data[k].trim()&&data[k].length<=10000)||!Array.isArray(data.evidence)||!data.evidence.length||data.evidence.length>50||data.evidence.some(e=>typeof e!=='string'||!e.trim()||e.length>10000))reject(400,'確認者・判断理由・証拠が必要です');
            const audit={reviewId:randomUUID(),runId:id,configHash,timestamp:new Date().toISOString(),id:row.id,previousStatus:row.status,outcome:data.outcome,reviewer:data.reviewer.trim(),notes:data.notes.trim(),evidence:data.evidence.map(e=>e.trim())};
            const original=path.join(directory,'automated-results.json');
            if(!fs.existsSync(original))fs.writeFileSync(original,JSON.stringify(report,null,2),{flag:'wx'});
            const auditDir=path.join(directory,'manual-reviews');fs.mkdirSync(auditDir,{recursive:true});
            const auditFile=`manual-reviews/${audit.reviewId}.json`;
            fs.writeFileSync(path.join(directory,auditFile),JSON.stringify(audit,null,2),{flag:'wx'});
            row.status=data.outcome;row.reason=audit.notes;row.review=audit;row.evidence=[...new Set([...(row.evidence??[]),auditFile])];
            writeReport(directory,report);
            return json(200,{ok:true,report});
          }
          if(segments.length>=6&&req.method==='GET') {
            const relative=segments[5]==='files'&&segments.length===6?target.searchParams.get('path'):segments.slice(5).join('/');
            const allowed=new Set(['report.html','issue-report.html','results.json','ui.log',...report.rows.flatMap(r=>r.evidence??[])]);
            for(const row of report.rows) if(/^snapshot\.[a-z][a-z0-9-]{0,63}$/.test(row.id))allowed.add(`candidates/${row.id}.png`);
            if(!allowed.has(relative))reject(403,'台帳に登録されていないファイルです');
            let file;try{file=boundedPath(directory,relative);}catch(e){if(e.status)throw e;reject(404,'証拠ファイルがありません');}
            const ext=path.extname(file).toLowerCase();const type=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.html':'text/html; charset=utf-8','.zip':'application/zip'})[ext]??'text/plain; charset=utf-8';
            res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:");
            res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',type);
            if(ext==='.zip')res.setHeader('Content-Disposition','attachment; filename="trace.zip"');
            return res.end(fs.readFileSync(file));
          }
        }
        reject(404,'APIが見つかりません');
      }
      if(req.method!=='GET')reject(404,'ページが見つかりません');
      const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/case-generator.js':'case-generator.js','/settings.js':'settings.js','/external-auth.js':'external-auth.js','/registration.js':'registration.js','/coverage-editor.js':'coverage-editor.js','/options-form.js':'options-form.js'};
      const name=files[target.pathname];if(!name)reject(404,'ページが見つかりません');
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
      res.end(fs.readFileSync(path.join(publicDir,name)));
    }catch(e){if(!res.headersSent)json(e.status??500,{error:e.status?e.message:'処理に失敗しました。設定と保存先を確認してください。'});else res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  url=`http://127.0.0.1:${server.address().port}`;
  return {url,close:async()=>{closing=true;await logins.close();await Promise.allSettled([...jobs]);await new Promise(r=>server.close(r));}};
}
