import {latestResults} from '../lib/latest-results.mjs';
import {attachGapPlans,gapVersion,evidenceGapInput} from '../lib/evidence-gaps.mjs';
import {releaseVersion} from '../lib/release-version.mjs';
import {deletionPlan,deleteSiteData} from './project-removal.mjs';
import {pipeline} from 'node:stream/promises';
import {completePreparation,prepareSaved,preparationWidens} from './automatic-preparation.mjs';
import {discoverAutomation} from './automation-discovery.mjs';
import {collectExamEvidence} from '../lib/exam-evidence.mjs';
import {preparationEvidence,applyEvidenceDecision,unresolvedPreparation,requiredRegistrationInputs} from './evidence-preparation.mjs';
import {applyAutomationPlan,mergeAutomationConfig,resolveAutomationProfile} from './automation-plan.mjs';
import {registrationTrace} from './registration-diagnostics.mjs';
import {suites as extendedSuites} from '../lib/checks/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {createSharedAccess} from './shared-access.mjs';
import {BrowserLogin} from './browser-login.mjs';
import {RemoteLogin} from './remote-login.mjs';
import {SystemSettings} from './system-settings.mjs';
import {AiAssistant,estimateEditorCalls} from './ai-assistant.mjs';
import {checkStorage,auditAppend} from './resource-guard.mjs';
import {ProjectStore} from './project-store.mjs';
import {ExternalAuth} from './external-auth.mjs';
import {discoverRegistration,registrationConfig,validateProfile,builtinModules,profileJourneys} from './registration.mjs';
import {generateCases,linkRegistrationCoverage,addSecurityChecks,syncPerformanceBudget} from './public/case-generator.js';
import { loadConfig,catalog } from '../lib/config.mjs';
import {writeReport} from '../lib/results.mjs';
import {enrichFailures} from '../lib/failure-explanations.mjs';
import {resultDownload} from '../lib/result-download.mjs';
import {buildExam,validateExamItems,customerExamHtml,customerImageWarnings} from '../lib/site-exam.mjs';
import {summarizeRecovery} from '../lib/recovery.mjs';
import {preflight} from '../lib/preflight.mjs';
import {guidance} from '../lib/guidance.mjs';
import {confirmationPlan,validateConfirmation,selectSingleTest,selectTests} from '../lib/confirmation.mjs';
import {triage} from './todo-triage.mjs';
import {storedNotApplicable} from '../lib/auto-not-applicable.mjs';
import {operationRequest} from '../lib/operations.mjs';
import {buildIssueReport} from '../lib/issue-report.mjs';
import {buildDesignerReport} from '../lib/designer-report.mjs';
import {buildEditorReport} from '../lib/editor-report/index.mjs';
import {groupRows} from '../lib/editor-report/causes.mjs';
import {autoReport} from '../lib/auto-report.mjs';
import {projectIsAlive,runIsAlive} from '../lib/run-lock.mjs';
import {redactor} from '../lib/evidence.mjs';
import {collectIssues,unconfirmedCount} from '../lib/handoff-issues.mjs';
import {buildHandoffText,compareHandoff,buildCompareText,nextRecord} from '../lib/handoff-text.mjs';
import {handoffDir,newHandoffId,isHandoffId,saveHandoff,latestHandoff,readHandoff} from '../lib/handoff-store.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicDir=path.join(root,'ui','public');
class HttpError extends Error {constructor(status,message,extra){super(message);this.status=status;Object.assign(this,extra);}}
const reject=(status,message)=>{throw new HttpError(status,message);};
// ログイン保存の失敗理由は利用者向けの日本語の文言だけを返す。システムの英語のエラー（パス等を含み得る）は汎用の失敗のまま隠す。
const userFacing=e=>{if(e instanceof HttpError||/[぀-ヿ一-鿿]/.test(String(e?.message)))reject(e.status??400,e.message);throw e;};
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function boundedPath(directory,relative) {
  const base=fs.realpathSync(directory),file=fs.realpathSync(path.resolve(directory,relative));
  const rel=path.relative(base,file);
  if(rel.startsWith('..')||path.isAbsolute(rel)) reject(403,'アクセスできないファイルです');
  return file;
}
const evidenceJSON=directory=>file=>{const f=boundedPath(directory,file);if(fs.statSync(f).size>8*1024*1024)throw Error('Evidence too large');return readJSON(f);};
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

export async function startUI({configPaths=[],port=4310,demo=false,storeDir,loginOptions,trustedAdapters={},shared,credentialCodec,host='127.0.0.1',auditFile,registrationDiscovery=discoverRegistration,publicDiscovery=discoverAutomation,systemOptions={},aiOptions,editorRecheckClient}) {
  if(!shared&&host!=='127.0.0.1')throw Error('外部待受は共有モードのみです');
  if(shared&&(configPaths.length||typeof credentialCodec!=='function'))throw Error('共有版は暗号化キーとUI登録サイトのみ対応します。外部設定は移行が必要です');
  const access=shared?createSharedAccess(shared):null;
  if(auditFile)fs.mkdirSync(path.dirname(auditFile),{recursive:true});
  const logins=shared?new RemoteLogin(loginOptions):new BrowserLogin(loginOptions);
  const store=storeDir?new ProjectStore(storeDir,{trustedAdapters,codec:credentialCodec}):null;
  const system=store?new SystemSettings({directory:systemOptions.directory??path.join(storeDir,'system'),codec:store.codec,policyFile:systemOptions.policyFile??path.join(storeDir,'system','egress.json'),admins:systemOptions.admins??[]}):null;
  const ai=system?new AiAssistant(system,aiOptions):null;
  const isAdmin=actor=>!access||system?.admins.includes(actor?.name);
  const allowTarget=baseURL=>{if(systemOptions.enforceEgress&&!system.view().destinations.some(e=>e.origin===new URL(baseURL).origin))reject(403,'管理者の「接続先の許可設定」に対象サイトを登録してください');};
  const admission=()=>{if(systemOptions.enforceEgress)checkStorage(storeDir,systemOptions.maxDataMB??8192);};
  const externalAuth=storeDir?new ExternalAuth(path.join(storeDir,'external-auth'),{codec:credentialCodec}):null;
  const hiddenFile=storeDir?path.join(storeDir,'.hidden-sites.json'):null;
  const hiddenIds=new Set(hiddenFile&&fs.existsSync(hiddenFile)?JSON.parse(fs.readFileSync(hiddenFile,'utf8')):[]);
  const token=randomBytes(24).toString('hex'),projects=new Map(),outputDirs=new Set();
  for(const filename of configPaths) {
    const ctx=loadConfig(filename),outputDir=path.resolve(ctx.configDir,ctx.config.outputDir??'runs');
    if(outputDirs.has(outputDir)) throw new Error('Each UI project must have a distinct outputDir');outputDirs.add(outputDir);
    const id=createHash('sha256').update(ctx.configPath).digest('hex').slice(0,12);
    projects.set(id,{id,file:ctx.configPath,outputDir});
  }
  function registerManaged(id){const ctx=store.context(id);if(!hiddenIds.has(id))projects.set(id,{id,file:ctx.configPath,outputDir:ctx.outputDir,managed:true,store});}
  if(store)for(const id of store.ids())registerManaged(id);
  for(const id of hiddenIds)projects.delete(id);
  let active=null,lastJob=null,closing=false,url,preparing=null,editorJob=null;
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
    admission();allowTarget(projectInfo(p).config.baseURL);
    if(closing)reject(503,'終了処理中です');if(active)reject(409,'別の処理が実行中です。完了を待ってください');if(editorJob)reject(409,'編集者向け報告書の作成が終わってから実行してください');
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
    let capacityTimer;
    const append=chunk=>{
      job.log=(job.log+chunk.toString().replace(/\x1b\[[0-9;]*m/g,'')).slice(-128000);
      if(job.runId)try{fs.writeFileSync(path.join(runPath(p,job.runId),'ui.log'),job.log);}catch{}
    };
    child.stdout.on('data',append);child.stderr.on('data',append);
    if(systemOptions.enforceEgress)capacityTimer=setInterval(()=>{try{admission();}catch(e){append('\n'+e.message+'。検査を停止し、回収が必要なデータを履歴に残します。\n');job.cancel();clearInterval(capacityTimer);}},10000);
    child.on('message',message=>{
      if(message.type==='run-started' && typeof message.runId==='string') {
        // Trust only a run inside the registered output directory, not an arbitrary child path.
        try {runPath(p,message.runId);job.runId=message.runId;job.state='running';}catch{}
      }
    });
    const done=new Promise(resolve=>{
      let ended=false;
      const finish=async(code,error)=>{if(ended)return;ended=true;clearInterval(capacityTimer);if(error)append(error.message);if(kind==='run'&&job.runId)try{const directory=runPath(p,job.runId),generated=autoReport(directory),report=readRun(p,job.runId);report.autoReport=generated;if(report.rows[0])report.rows[0].evidence=[...new Set([...(report.rows[0].evidence??[]),'issue-report.html'])];writeReport(directory,report);append('\n報告書を自動生成しました: issue-report.html\n');}catch(e){append('\n報告書の自動生成に失敗: '+e.message+'\n');}if(kind==='run'&&job.runId&&system?.view().enabled&&system.view().evidenceApproved&&!closing)try{const directory=runPath(p,job.runId),report=readRun(p,job.runId);if(report.runStatus==='finished'){job.state='running';const exam=buildExam(readExamEvidence(directory,report).report);await completeEvidence(p,directory,exam);append('Claudeで採点保留の不足証拠・追加確認を整理しました。点数の推測は行っていません。\n');}}catch(e){append('不足証拠のAI整理: '+e.message+'\n');}job.exitCode=code;job.state='finished';if(active===job)active=null;resolve(jobState(job));};
      child.once('error',e=>finish(2,e));child.once('close',code=>finish(code??2));
    });
    jobs.add(done);done.finally(()=>jobs.delete(done));return {job,done};
  }
  function readExamEvidence(directory,report){
    return collectExamEvidence(enrichFailures(report,evidenceJSON(directory)),file=>{const f=boundedPath(directory,file);if(fs.statSync(f).size>8*1024*1024)throw Error('Evidence too large');return fs.readFileSync(f);});
  }
  function readGapRecord(directory){
    if(!fs.existsSync(path.join(directory,'evidence-completion.json')))return null;
    const file=boundedPath(directory,'evidence-completion.json');if(fs.statSync(file).size>2*1024*1024)throw Error('Evidence plan too large');return readJSON(file);
  }
  async function completeEvidence(p,directory,exam){
    const cached=readGapRecord(directory);
    if(cached?.version===gapVersion&&cached.fingerprint===exam.fingerprint&&cached.examVersion===(exam.version??null))return cached;
    if(!ai)throw Error('AI設定がありません');
    const record=await ai.completeAssessmentEvidence(exam,projectInfo(p).config);
    const destination=path.join(directory,'evidence-completion.json');
    if(fs.existsSync(destination))boundedPath(directory,'evidence-completion.json');
    const tmp=destination+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(record),{flag:'wx',mode:0o600});fs.renameSync(tmp,destination);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
    return record;
  }
  async function completeObservedPreparation(config,profile,discovery){
    return completePreparation(config,profile,discovery,{ai,aiEnabled:!!system?.view().enabled&&system.view().approved&&system.view().evidenceApproved});
  }
  async function autoPrepare(p){
    if(!p.managed)return null;
    if(active||closing||logins.busy||preparing||projectIsAlive(p.outputDir))reject(409,'検査・ログイン・設定補完の完了後に実行してください');
    if(editorJob)reject(409,'編集者向け報告書の作成が終わってから実行してください');
    const record=store.record(p.id);
    if(!unresolvedPreparation(record.config,record.profile??{}).length)return null;
    preparing={projectId:p.id,kind:'prepare',state:'preparing',log:'サイト情報を取得し、設定を自動補完しています。'};
    try{
      admission();allowTarget(record.config.baseURL);
      const secrets=record.sealed?JSON.parse(store.codec(record.sealed,true)):{};
      const result=await prepareSaved(record,{secrets,registrationDiscovery,publicDiscovery,ai,aiEnabled:!!system?.view().enabled&&system.view().approved&&system.view().evidenceApproved});
      if(closing||store.record(p.id).version!==record.version||projectIsAlive(p.outputDir))reject(409,'取得中に設定または実行状態が変わりました。再実行してください');
      if(preparationWidens(record,result))reject(400,'自動補完は操作許可を変更できません');
      saveSettings({config:result.config,...(record.profile?{profile:result.profile}:{}),version:record.version,auth:{}},p.id,{compileAutomation:false});registerManaged(p.id);
      fs.mkdirSync(path.join(storeDir,p.id),{recursive:true});fs.writeFileSync(path.join(storeDir,p.id,'preparation-summary.json'),JSON.stringify(result.summary),{mode:0o600});return result.summary;
    }finally{preparing=null;}
  }
  // 画面から届いた profile：プラグイン一覧は保存済み（登録・再取得で取得したもの）だけを使い、関係ありに戻す選択は送られたときだけ置き換える。
  function clientProfile(profile,stored){
    if(!profile||typeof profile!=='object'||Array.isArray(profile))return profile;
    const a=profile.automation&&typeof profile.automation==='object'&&!Array.isArray(profile.automation)?profile.automation:undefined,keep=stored?.automation??{};
    if(a===undefined&&profile.automation!==undefined)return profile;
    const {pluginInventory,...rest}=a??{},next={...rest,...(keep.pluginInventory?{pluginInventory:keep.pluginInventory}:{}),...(a&&Object.hasOwn(a,'relevantOverrides')||!keep.relevantOverrides?{}:{relevantOverrides:keep.relevantOverrides})};
    return a===undefined&&!Object.keys(next).length?profile:{...profile,automation:next};
  }
  function saveSettings(data,projectId=null,{compileAutomation=true,owner}={}){
    admission();allowTarget(data.config.baseURL);
    if(active||closing)reject(409,'実行完了後に保存してください');
    if(projectId&&data.version!==store.record(projectId).version)throw new HttpError(409,'別の画面で設定が更新されました。閉じてから再度開いてください',{conflict:true});
    const auth=data.auth??{},loginId=auth.browserLoginId;
    if(shared&&loginId)logins.assertOwner(loginId,owner);
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
      const profile=data.profile??(projectId?store.record(projectId).profile:undefined);
      let config=data.config;
      if(profile&&compileAutomation){
        const validated=validateProfile(profile,config.environment);
        config=syncPerformanceBudget(applyAutomationPlan(linkRegistrationCoverage({checks:[],manual:[],admin:[],...config,journeys:profileJourneys(validated)},validated),validated,{}),validated);
        // Saving can regenerate coverage placeholders without doing discovery.
        // Stored browser baselines still provide the executable admin coverage.
        const observedGroups=['reading','discussion','permalink','plugins'].filter(group=>(config.admin??[]).some(row=>row.id.startsWith('observed-'+group+'-')&&row.source==='browser'&&Object.hasOwn(row,'expected')));
        config.checks=config.checks.filter(check=>!(check.kind==='unconfigured'&&observedGroups.some(group=>check.id==='coverage-admin-'+group)));
      }
      return store.save({id:projectId??undefined,version:data.version,config,auth:savedAuth,profile:data.profile,sensitivePaths:data.sensitivePaths});
    };
    try{return loginId?logins.save(loginId,{baseURL:data.config.baseURL,projectId,role},persist):persist();}catch(e){reject(400,e.message);}
  }
  const server=createServer(async(req,res)=>{
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      const address=server.address(),hosts=[`127.0.0.1:${address.port}`,`localhost:${address.port}`];
      const actor=access?await access.authenticate(req):null;
      if(!access&&!hosts.includes(req.headers.host))reject(403,'ローカルからアクセスしてください');
      const target=new URL(req.url,url),segments=target.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
      if(!['GET','POST'].includes(req.method))reject(405,'対応していない操作です');
      if(req.method==='POST') {
        if(preparing)reject(409,'設定の自動補完中です。完了を待ってください');
        if(!(access?[access.origin]:hosts.map(h=>`http://${h}`)).includes(req.headers.origin)||req.headers['x-qa-token']!==(actor?.token??token))reject(403,'操作元を確認できません。画面を再読込してください');
        if(!req.headers['content-type']?.startsWith('application/json'))reject(415,'JSON形式で送信してください');
        if(actor&&auditFile){
          const event={timestamp:new Date().toISOString(),user:actor.name,method:req.method,path:target.pathname.slice(0,300)};
          auditAppend(auditFile,{...event,phase:'request'});
          res.once('finish',()=>{try{auditAppend(auditFile,{...event,phase:'response',status:res.statusCode});}catch{console.error('Audit response write failed');}});
        }
        if(access&&segments[0]==='api'&&segments[1]==='registration')reject(409,'共有版では設定画面から登録してください');
      }
      if(target.pathname==='/api/bootstrap'&&req.method==='GET') {
        const list=[...projects.values()].map(p=>{
          try{const {config:c,configHash}=projectInfo(p);return {id:p.id,name:c.name,baseURL:c.baseURL,environment:c.environment,configHash};}
          catch(e){return {id:p.id,name:path.basename(p.file),error:e.message};}
        });return json(200,{token:actor?.token??token,projects:list,demo,canRegister:!!store,canRemove:!!hiddenFile,releaseVersion,shared:!!access,user:actor?.name??null,browserLogin:!!store,remoteBrowserLogin:!!access&&!!store,systemAdmin:isAdmin(actor)});
      }
      if(target.pathname==='/api/system/settings'){
        if(!system)reject(503,'設定保存先がありません');
        if(req.method==='GET')return json(200,{...system.view(),canEdit:isAdmin(actor)});
        if(!isAdmin(actor))reject(403,'この設定は管理者のみ変更できます');
        if(active||logins.busy||ai.busy)reject(409,'検査・ログイン・AI処理の完了後に設定してください');
        if(editorJob)reject(409,'編集者向け報告書の作成が終わってから実行してください');
        try{return json(200,system.save(await body(req)));}catch(e){reject(400,e.message);}
      }
      if(target.pathname==='/api/ai/propose'&&req.method==='POST'){
        if(!ai)reject(503,'AI設定がありません');admission();if(editorJob)reject(409,'編集者向け報告書の作成が終わってから実行してください');const data=await body(req);
        try{return json(200,await ai.propose(data.config,data.answers??{},actor?.name??'local'));}catch(e){reject(400,e.message);}
      }
      if(target.pathname==='/api/ai/apply'&&req.method==='POST'){
        if(!ai)reject(503,'AI設定がありません');const data=await body(req);
        try{return json(200,ai.apply(data.id,data.config,data.indices,actor?.name??'local'));}catch(e){reject(400,e.message);}
      }
      if(target.pathname==='/api/logins/current'&&req.method==='GET')return json(200,{login:access&&logins.session?.owner!==actor.name?null:logins.status()});
      if(target.pathname==='/api/registration'&&req.method==='POST'){
        if(!store||active||closing)reject(409,'実行完了後に登録してください');
        const trace=registrationTrace(event=>fs.appendFileSync(path.join(storeDir,'registration-events.jsonl'),JSON.stringify(event)+'\n',{mode:0o600}));
        const data=await trace.step('input',()=>body(req));let profile=await trace.step('input',()=>validateProfile(clientProfile(data.profile),data.environment,{discoveryPending:true}));
        const session=await trace.step('authentication',()=>logins.get(data.loginId));
        if(session.phase!=='verified'||session.projectId||session.role||session.baseURL!==data.baseURL||session.environment!==data.environment)reject(400,'このサイトの管理者ログインを確認してください');
        const discovery=await trace.step('discovery',()=>registrationDiscovery({baseURL:data.baseURL,profile,state:session.state,publicPassword:data.publicPassword??'',trace}));
        profile=resolveAutomationProfile(profile,discovery);
        const seed=generateCases({securityAdminPath:profile.adminPath,name:data.name,baseURL:data.baseURL,environment:data.environment,allowTestWrites:profile.writes,admin:[],pages:discovery.pages.map((p,i)=>({id:'page-'+i,path:p.path,canonical:new URL(p.path,data.baseURL).href,indexable:profile.indexable}))});
        const completed=await completeObservedPreparation(seed,profile,discovery);profile=completed.profile;
        const needed=requiredRegistrationInputs(profile,discovery);
        if(needed.length)return json(200,{requiresInput:true,profile,questions:needed,preparation:completed.summary});
        const additions=completed.config.checks.filter(c=>!['unconfigured','human-review'].includes(c.kind)&&c.id.startsWith('coverage-'));
        const additionsById=new Map((profile.automation?.additionalChecks??[]).map(c=>[c.id,c]));for(const c of additions)if(!additionsById.has(c.id))additionsById.set(c.id,c);
        profile.automation={...profile.automation,additionalChecks:[...additionsById.values()]};
        let config=await trace.step('generate',()=>registrationConfig({...data,profile,discovery}));
        let aiPreparation=null;
        if(ai&&system.view().enabled&&system.view().approved){
          try{
            const proposed=await ai.propose(config,profile.performanceMs?{maxLoadMs:profile.performanceMs}:{},actor?.name??'local');
            const originalIds=new Set(config.checks.map(c=>c.id));
            config=ai.apply(proposed.id,config,proposed.proposal.cases.map((_,i)=>i),actor?.name??'local').config;
            const additions=config.checks.filter(c=>!originalIds.has(c.id));
            profile.automation={...profile.automation,additionalChecks:[...(profile.automation?.additionalChecks??[]),...additions]};
            aiPreparation={reviewed:proposed.reviews.length,added:additions.length,questions:proposed.proposal.questions.length,batches:proposed.batchCount};
            discovery.warnings.push(`Claudeが${aiPreparation.reviewed}項目の準備を確認し、${aiPreparation.added}件の読み取り検査を追加しました。追加確認事項は${aiPreparation.questions}件です。検査の合否は実行後に判定します。`);
          }catch{discovery.warnings.push('Claude補完は完了しませんでした。自動取得した検査で登録を継続します。API設定・利用上限を確認後、サイト設定の「自動取得してClaudeで補完」で再試行できます。');}
        }
        const id=await trace.step('save',()=>saveSettings({config,profile,auth:{browserLoginId:data.loginId,roleCredentials:data.roleCredentials??[],publicPassword:discovery.publicPasswordRequired===false?'':data.publicPassword??''}},null,{owner:actor?.name}));
        await trace.step('register',()=>registerManaged(id));fs.mkdirSync(path.join(storeDir,id),{recursive:true});fs.writeFileSync(path.join(storeDir,id,'preparation-summary.json'),JSON.stringify({...completed.summary,remaining:unresolvedPreparation(config,profile),createdAt:new Date().toISOString()}),{mode:0o600});return json(201,{id,pages:config.pages.length,cases:catalog(projectInfo(getProject(id)).config).length,warnings:discovery.warnings,aiPreparation,preparation:{...completed.summary,remaining:unresolvedPreparation(config,profile)}});
      }
      if(segments[0]==='api'&&segments[1]==='logins'&&req.method==='POST') {
        if(!store)reject(503,'サイト登録が無効です');
        const data=await body(req);
        if(active||closing)reject(409,'実行完了後にログインしてください');
        if(editorJob)reject(409,'編集者向け報告書の作成が終わってから実行してください');
        try{
          if(segments.length===2){
            admission();allowTarget(data.baseURL);
            if(data.projectId){const p=getProject(data.projectId),c=projectInfo(p).config;if(!p.managed&&(data.baseURL!==c.baseURL||data.environment!==c.environment||data.role))reject(400,'登録済みサイトの既定管理者としてログインしてください');}
            return json(201,access?await logins.startOwned(data,actor.name):await logins.start(data));
          }
          if(access&&!(segments[3]==='cancel'&&!logins.busy))logins.assertOwner(segments[2],actor.name);
          if(access&&segments.length===4&&segments[3]==='operate')return json(200,await logins.operate(segments[2],actor.name,data));
          if(segments.length===4&&segments[3]==='verify')return json(200,await logins.verify(segments[2]));
          if(segments.length===4&&segments[3]==='cancel'){await logins.cancel(segments[2]);return json(200,{ok:true});}
        }catch(e){reject(e.status??400,e.message);}
        reject(404,'ログイン操作が見つかりません');
      }
      if(segments[0]==='api'&&segments[1]==='projects') {
        if(segments.length===2&&req.method==='POST') {
          if(!store)reject(503,'この起動ではサイト登録が無効です');if(active)reject(409,'実行完了後に登録してください');
          const data=await body(req);let id;
          id=saveSettings({...data,profile:clientProfile(data.profile)},null,{owner:actor?.name});
          registerManaged(id);return json(201,{id});
        }
        const p=getProject(segments[2]);
        if(segments[3]==='removal'&&segments.length===4&&req.method==='GET'){
          if(!isAdmin(actor))return json(200,{canDelete:false,reason:'完全削除は管理者のみ実行できます。一覧からの除外は可能です。'});
          if(!p.managed)return json(200,{canDelete:false,reason:'設定ファイルから登録したサイトは一覧からの除外のみ対応しています。元の設定・結果は管理担当者が管理しています。'});
          try{const {targets,...plan}=deletionPlan(store,p.id);return json(200,{canDelete:true,...plan});}catch(e){return json(200,{canDelete:false,reason:e.message});}
        }
        if(segments[3]==='remove'&&segments.length===4&&req.method==='POST'){
          if(!hiddenFile)reject(503,'この起動では一覧の変更を保存できません');
          const data=await body(req);
          if(data.confirmed!==true||typeof data.configHash!=='string')reject(400,'対象サイトの削除を確認してください');
          if(active||preparing||closing||logins.busy||ai?.busy||projectIsAlive(p.outputDir))reject(409,'検査・ログイン・AI処理の完了後に削除してください');
          if(editorJob)reject(409,'編集者向け報告書の作成が終わってから実行してください');
          if(data.configHash!==projectInfo(p).configHash)reject(409,'サイト設定が変更されました。画面を再読み込みしてください');
          if(data.mode!==undefined&&!['hide','delete'].includes(data.mode))reject(400,'削除方法が不正です');
          if(data.mode==='delete'){
            if(!isAdmin(actor))reject(403,'完全削除は管理者のみ実行できます');
            if(!p.managed)reject(400,'このサイトは一覧からの除外のみ対応しています');
            try{deleteSiteData(store,p.id,{name:data.name,hash:data.hash});}catch(e){reject(409,e.message);}
            projects.delete(p.id);return json(200,{removed:true,dataRetained:false});
          }
          const next=[...new Set([...hiddenIds,p.id])],temp=hiddenFile+'.tmp';
          fs.writeFileSync(temp,JSON.stringify(next),{mode:0o600});fs.renameSync(temp,hiddenFile);
          hiddenIds.add(p.id);projects.delete(p.id);return json(200,{removed:true,dataRetained:true});
        }
        if(segments[3]==='auth'&&segments.length===4){
          if(p.managed){
            admission();allowTarget(projectInfo(p).config.baseURL);
            if(req.method!=='POST')reject(405,'POSTのみ対応しています');
            if(active||closing||projectIsAlive(p.outputDir))reject(409,'検査の終了後に保存してください');
            const data=await body(req);if(Object.keys(data).some(k=>!['loginId','role','version'].includes(k))||typeof data.loginId!=='string')reject(400,'確認済みログインを指定してください');
            const record=store.record(p.id);if(data.version!==record.version)reject(409,'設定が更新されています。再読み込み後に保存してください');
            if(access)logins.assertOwner(data.loginId,actor.name);
            // ログインの確認・保存で失敗した理由は利用者向けの文言なので、汎用の失敗に置き換えずに返す。
            try{
              await logins.verify(data.loginId);
              logins.save(data.loginId,{baseURL:record.config.baseURL,projectId:p.id,role:data.role},state=>store.save({id:p.id,version:record.version,config:record.config,profile:record.profile,auth:data.role?{roleCredentials:[{name:data.role,browser:state}]}:{browser:state}}));
            }catch(e){userFacing(e);}
            registerManaged(p.id);return json(200,{ok:true,version:store.record(p.id).version});
          }
          if(!externalAuth)reject(400,'認証の保存先がありません');
          const c=projectInfo(p).config;
          if(req.method==='GET')return json(200,{...externalAuth.status(p.id,c),baseURL:c.baseURL,environment:c.environment});
          if(active||closing||projectIsAlive(p.outputDir))reject(409,'実行完了後に認証を保存してください');
          const data=await body(req);if(Object.keys(data).some(k=>k!=='loginId')||typeof data.loginId!=='string')reject(400,'確認済みログインを指定してください');
          if(access)logins.assertOwner(data.loginId,actor.name);
          try{logins.save(data.loginId,{baseURL:c.baseURL,projectId:p.id},state=>externalAuth.save(p.id,c,state));}catch(e){userFacing(e);}
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
        if(segments[3]==='preparation'&&segments.length===4&&req.method==='GET'){
          if(!p.managed)reject(404,'登録済みサイトの準備情報ではありません');
          const file=path.join(storeDir,p.id,'preparation-summary.json');
          return json(200,fs.existsSync(file)?readJSON(file):{mode:'not-recorded',remaining:unresolvedPreparation(store.record(p.id).config,store.record(p.id).profile??{})});
        }
        if(segments[3]==='todo'&&segments.length===4&&req.method==='GET'){
          if(!p.managed)return json(200,{managed:false});
          const record=store.record(p.id);
          return json(200,{managed:true,environment:record.config.environment,version:record.version,...triage(addSecurityChecks(structuredClone(record.config),record.profile?.adminPath??'/wp-admin/'),record.profile??null,{adminLogin:record.credentials?.browser===true,notApplicable:storedNotApplicable(record.config)})});
        }
        if(segments[3]==='rediscover'&&segments.length===4&&req.method==='POST'){
          if(!p.managed)reject(403,'外部設定のサイトは再取得できません');
          if(active||closing||logins.busy||projectIsAlive(p.outputDir))reject(409,'検査・ログインの完了後に再取得してください');
          const data=await body(req),record=store.record(p.id);
          if(Object.keys(data).some(k=>!['version','preview'].includes(k))||typeof data.version!=='string'||data.preview!==undefined&&typeof data.preview!=='boolean')reject(400,'保存済み設定のversionを指定してください');
          if(data.version!==record.version)reject(409,'別の画面で設定が更新されました。設定を開き直してください');
          const publicFallback=async warning=>{
            const secrets=record.sealed?JSON.parse(store.codec(record.sealed,true)):{};
            const cookies=(secrets.browser?.cookies??[]).filter(c=>/^(?:bid_\d+_)?password_protected_/.test(c.name)&&!/(?:^|_)password_protected_cookie_test$/.test(c.name));
            const first=record.config.pages?.[0]?.path??'/',sitePath=record.profile?.sitePath??(first.endsWith('/')?first:first.slice(0,first.lastIndexOf('/')+1));
            const profile=record.profile??{sitePath,writes:false};
            const automation=await publicDiscovery({baseURL:record.config.baseURL,profile,pages:record.config.pages,publicHeaders:cookies.length?{Cookie:cookies.map(c=>c.name+'='+c.value).join('; ')}:{}});
            const completed=await completeObservedPreparation(record.config,profile,{automation,authenticated:false,pages:record.config.pages});const config=completed.config;
            config.checks=config.checks.map(c=>c.kind==='unconfigured'?(record.config.checks.find(old=>old.id===c.id)??c):c);
            const adoptedIds=config.checks.filter(c=>c.kind!=='unconfigured'&&record.config.checks.some(old=>old.id===c.id&&old.kind==='unconfigured')).map(c=>c.id);
            const preparation={...completed.summary,warning:[warning,completed.summary.warning].filter(Boolean).join(' ')};
            if(active||closing||logins.busy||projectIsAlive(p.outputDir)||store.record(p.id).version!==record.version)reject(409,'取得中に状態が変わりました。設定は変更していません');
            if(data.preview)return json(200,{config,profile:record.profile??{},version:record.version,warnings:[warning],preparation,preview:true});
            await saveSettings({version:record.version,config,auth:{}},p.id,{compileAutomation:false});registerManaged(p.id);
            fs.mkdirSync(path.join(storeDir,p.id),{recursive:true});fs.writeFileSync(path.join(storeDir,p.id,'preparation-summary.json'),JSON.stringify(preparation),{mode:0o600});
            return json(200,{id:p.id,version:store.view(p.id).version,pages:config.pages.length,warnings:[warning],preparation});
          };
          if(!record.profile||!record.credentials.browser)return publicFallback('管理設定は取得せず、登録済み公開URLから読み取り検査だけを準備しました。管理画面の認証・標準操作設定は未確認のままです。');
          if(!record.credentials.browser)reject(409,'管理者のブラウザー認証を登録して保存してください');
          // Discovery only reads the target. Never run journeys or adapters here.
          const secrets=record.sealed?JSON.parse(store.codec(record.sealed,true)):{};
          if(!secrets.browser)reject(409,'保存済み管理者認証がありません');
          const trace=registrationTrace(event=>fs.appendFileSync(path.join(storeDir,'registration-events.jsonl'),JSON.stringify(event)+'\n',{mode:0o600}));
          const initial=await trace.step('input',()=>validateProfile(record.profile,record.config.environment));
          if(initial.writes===true&&record.config.allowTestWrites!==true)reject(409,'保存済みの操作許可が一致しません。設定を確認してください');
          let discovery;try{discovery=await trace.step('discovery',()=>registrationDiscovery({baseURL:record.config.baseURL,profile:initial,state:secrets.browser,publicPassword:secrets.publicPassword??'',trace}));}catch{return publicFallback('管理画面の取得を完了できませんでした。公開URLから読み取り検査のみ再取得し、管理設定・認証は未確認として保持します。');}
          const completed=await completeObservedPreparation(record.config,resolveAutomationProfile(initial,discovery),discovery);
          const profile=completed.profile;
          // Inference must never grant permission to mutate a target site.
          for(const key of ['writes','submit','bankOrder'])if(profile[key]===true&&initial[key]!==true)reject(409,'自動取得では操作許可を追加できません');
          const generated=await trace.step('generate',()=>registrationConfig({name:record.config.name,baseURL:record.config.baseURL,environment:record.config.environment,profile,discovery}));
          const config=mergeAutomationConfig(completed.config,generated);
          if(active||closing||logins.busy||projectIsAlive(p.outputDir))reject(409,'検査・ログインが開始されたため再取得結果は保存していません');
          if(store.record(p.id).version!==record.version)reject(409,'再取得中に設定が更新されました。結果は保存していません。設定を開き直してください');
          if(data.preview)return json(200,{config,profile,version:record.version,warnings:discovery.warnings??[],preparation:{...completed.summary,remaining:unresolvedPreparation(config,profile)},preview:true});
          await trace.step('save',()=>saveSettings({version:record.version,config,profile,auth:{}},p.id,{compileAutomation:false}));
          registerManaged(p.id);
          return json(200,{id:p.id,version:store.view(p.id).version,pages:config.pages.length,warnings:discovery.warnings??[]});
        }
        if(segments[3]==='settings'&&segments.length===4) {
          if(req.method==='GET')return json(200,p.managed?store.view(p.id):{config:projectInfo(p).config,managed:false,credentials:{rest:false,browser:false}});
          if(!p.managed)reject(403,'起動時に指定した設定はファイルで管理されています。新しいサイトとして登録してください');
          if(active)reject(409,'実行完了後に設定を変更してください');
          const data=await body(req);
          saveSettings(data?.profile===undefined?data:{...data,profile:clientProfile(data.profile,store.record(p.id).profile)},p.id,{owner:actor?.name});
          registerManaged(p.id);return json(200,{id:p.id});
        }
        if(segments.length===3&&req.method==='GET') {
          const current=projectInfo(p),{config:c,configHash}=current;
          return json(200,{project:{id:p.id,managed:!!p.managed,profileScope:profileScope(p,current),name:c.name,baseURL:c.baseURL,environment:c.environment,configPath:p.file,configHash,counts:{pages:c.pages.length,journeys:c.journeys.length,visuals:c.visuals.length},planned:catalog(c).length},runs:history(p),busy:!!active||!!preparing,active:jobState(active??preparing),lastJob:lastJob?.projectId===p.id?jobState(lastJob):null});
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
        if(segments[3]==='latest-results'&&segments.length===4&&req.method==='GET'){
          const current=projectInfo(p),reports=[];let unreadableRuns=0;
          for(const entry of history(p,Infinity)){try{reports.push(readRun(p,entry.runId));}catch{unreadableRuns++;}}
          return json(200,{...latestResults(catalog(current.config),current.configHash,reports),unreadableRuns});
        }
        if(segments[3]==='runs'&&segments.length===4&&req.method==='POST') {
          const data=await body(req);if(!['all','standard','interaction','audit','journey','visual','admin',...Object.keys(extendedSuites)].includes(data.suite))reject(400,'検査範囲が不正です');
          let ids=null;if(data.ids!==undefined){if(!Array.isArray(data.ids)||!data.ids.length||data.ids.some(x=>typeof x!=='string'||!x||x.length>200||x.includes(',')))reject(400,'実行する検査はidsに行IDの配列で指定してください');ids=[...new Set(data.ids)];if(ids.length>50)reject(400,'一度に指定できる検査は50件までです');}
          // ids は指定した行だけを実行する。設定が必要・対象外・存在しない行が1つでもあれば実行しない。
          const pickIds=config=>{if(!ids)return;if(ids.some(id=>config.journeys.some(j=>j.explicitOnly&&id==='journey.'+j.id)))reject(400,'操作テストの画面で送信内容を確認して実行してください');try{selectTests(catalog(config,data.suite),ids);}catch(e){reject(400,e.message);}};
          if(ids){const before=projectInfo(p).config;pickIds(p.managed?addSecurityChecks(structuredClone(before),store.record(p.id).profile?.adminPath??'/wp-admin/'):before);}
          if(editorJob)reject(409,'編集者向け報告書の作成が終わってから実行してください');
          if(p.managed&&!active&&!preparing&&!logins.busy){const saved=store.record(p.id),config=addSecurityChecks(structuredClone(saved.config),saved.profile?.adminPath??'/wp-admin/');if(config.checks.length!==(saved.config.checks??[]).length){store.save({id:p.id,version:saved.version,config,profile:saved.profile});registerManaged(p.id);}}const preparation=await autoPrepare(p);const current=projectInfo(p);pickIds(current.config);
          const operations=!ids&&!profileScope(p,current)&&['all','journey'].includes(data.suite)?current.config.journeys.filter(j=>j.runWithSuite&&j.explicitOnly):[];
          let env={};if(operations.length){
            const options={configHash:current.configHash,mode:'preview',password:'',...data.operation};
            // Preview is the normal default; real submission requires an explicit checkbox.
            if(options.mode==='preview')options.confirmed=true;
            try{env=operationRequest(current.config,current.configHash,operations[0].id,options).env;}catch(e){reject(400,e.message);}
            env.WPQA_OPERATION_ID='suite';
          }
          const {job}=launch(p,['run','--config',p.file,'--suite',data.suite,...(ids?['--id',ids.join(',')]:[])],'run',env);if(preparation)job.log='設定の自動補完: '+preparation.adopted+'件を紐付け・生成。'+(preparation.warning??'')+'\n';return json(202,{...jobState(job),preparation});
        }
        if(segments[3]==='runs'&&segments[4]) {
          const id=segments[4],report=readRun(p,id),directory=runPath(p,id);
          if(['exam','exam-ai','exam-evidence','exam-evidence-run','customer-report'].includes(segments[5])&&segments.length===6){
            if(report.runStatus!=='finished'||!report.finishedAt||runIsAlive(directory))reject(409,'完了した診断結果を選択してください');
            const readAssessment=r=>collectExamEvidence(enrichFailures(r,evidenceJSON(directory)),file=>{const f=boundedPath(directory,file);if(fs.statSync(f).size>8*1024*1024)throw Error('Evidence too large');return fs.readFileSync(f);});
            const bundle=readAssessment(report),enriched=bundle.report;
            const storage=path.join(directory,'site-exam.json');let saved=null;
            if(fs.existsSync(storage)){const f=boundedPath(directory,'site-exam.json');if(fs.statSync(f).size>2*1024*1024)reject(413,'評価ファイルが大きすぎます');saved=readJSON(f);}
            const exam=attachGapPlans(buildExam(enriched,saved),readGapRecord(directory));exam.presentationWarnings=customerImageWarnings(exam,bundle.image);
            if(segments[5]==='exam'&&req.method==='GET')return json(200,exam);
            if(segments[5]==='exam'&&req.method==='POST'){
              admission();
              if(active||closing)reject(409,'処理の終了後に評価を保存してください');
              const data=await body(req);if(data.fingerprint!==exam.fingerprint||data.version!==exam.version)reject(409,'結果または評価が更新されました。評価を再取得してください');
              const latest=fs.existsSync(storage)?readJSON(boundedPath(directory,'site-exam.json')):null;
              const currentReport=readAssessment(readRun(p,id)).report;
              if(latest?.version!==saved?.version||buildExam(currentReport).fingerprint!==exam.fingerprint)reject(409,'結果または評価が更新されました。評価を再取得してください');
              let items;try{items=validateExamItems(data.items,exam);}catch(e){reject(400,e.message);}
              const record={fingerprint:exam.fingerprint,version:randomUUID(),savedAt:new Date().toISOString(),items};
              if(fs.existsSync(storage)&&fs.lstatSync(storage).isSymbolicLink())reject(403,'評価の保存先が不正です');
              const temp=storage+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(record),{flag:'wx',mode:0o600});fs.renameSync(temp,storage);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
              const updated=buildExam(enriched,record);return json(200,{...updated,presentationWarnings:customerImageWarnings(updated,bundle.image)});
            }
            if(['exam-evidence','exam-evidence-run'].includes(segments[5])&&req.method==='POST'){
              admission();if(active||closing||preparing||logins.busy)reject(409,'処理の終了後に実行してください');if(editorJob)reject(409,'編集者向け報告書の作成が終わってから実行してください');
              const data=await body(req);if(data.fingerprint!==exam.fingerprint||data.version!==exam.version)reject(409,'結果が更新されています。評価を再取得してください');
              if(segments[5]==='exam-evidence'){
                try{return json(200,attachGapPlans(exam,await completeEvidence(p,directory,exam)));}catch(e){reject(400,e.message);}
              }
              const current=projectInfo(p);if(current.configHash!==report.configHash)reject(409,'設定が更新されています。現在の設定で検査を実行してください');
              const plan=exam.evidenceCompletion?.plans?.find(x=>x.issueId===data.issueId&&x.caseIds.includes(data.rowId));
              const pending=exam.issues.filter(i=>i.certainty==='pending'),index=pending.findIndex(i=>i.id===data.issueId),entry=evidenceGapInput(exam,current.config).find(x=>x.index===index);
              const allowed=entry?.cases.some(c=>c.rerunPermitted&&pending[index].cases[c.ref].id===data.rowId);
              const row=report.rows.find(r=>r.id===data.rowId);
              if(!plan||!allowed||!row)reject(400,'実行可能な証拠取得検査ではありません');
              try{selectSingleTest(catalog(current.config),row.id);}catch(e){reject(400,e.message);}
              const {job}=launch(p,['run','--config',p.file,'--suite',row.suite,'--id',row.id],'run');return json(202,jobState(job));
            }
            if(segments[5]==='exam-ai'&&req.method==='POST'){
              admission();if(editorJob)reject(409,'編集者向け報告書の作成が終わってから実行してください');
              if(!ai)reject(503,'AI設定がありません');const data=await body(req);if(data.fingerprint!==exam.fingerprint||data.version!==exam.version)reject(409,'結果が更新されています。評価を再取得してください');
              try{return json(200,{fingerprint:exam.fingerprint,version:exam.version,suggestions:await ai.explain(exam.issues)});}catch(e){reject(400,e.message);}
            }
            if(segments[5]==='customer-report'&&req.method==='GET'){
              res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
              if(target.searchParams.get('download')==='1')res.setHeader('Content-Disposition','attachment; filename="site-exam-report.html"');
              res.end(customerExamHtml(enriched,exam,bundle.image));return;
            }
            reject(405,'対応していない操作です');
          }
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
          if(['handoff','handoff-compare'].includes(segments[5])&&segments.length===6&&req.method==='POST'){
            if(report.runStatus!=='finished'||!report.finishedAt||runIsAlive(directory))reject(409,'完了した実行を選択してください');
            const data=await body(req),compare=segments[5]==='handoff-compare',keys=data[compare?'uncheckedAddedKeys':'excludedKeys']??[];
            if(!Array.isArray(keys)||keys.length>500||keys.some(k=>typeof k!=='string'||!/^[a-f0-9]{32}$/.test(k))||typeof data.save!=='boolean'||(data.handoffId!==undefined&&!isHandoffId(data.handoffId)))reject(400,'引き継ぎの指定が不正です');
            const current=projectInfo(p),dir=handoffDir(p.outputDir),handoffId=data.handoffId??newHandoffId(),siteName=current.config.name;
            // 別の実行の記録は上書きさせない（同じ実行で作った記録だけ上書きできる）。
            const own=data.handoffId===undefined?null:readHandoff(dir,handoffId);if(own&&own.sourceRunId!==id)reject(400,'引き継ぎIDが不正です');
            const clean=redactor(current.config,{...process.env,...(p.managed?store.prepare(p.id).env:externalAuth?.prepare(p.id,current.config).env)}),read=evidenceJSON(directory),enriched={...enrichFailures(report,read),runId:id};
            // 課題キーは伏せ字前の値のハッシュにする（秘密の集合が変わっても同じキーになり、証拠の文字は外へ出ない）。rawKey は比較に要る接頭辞だけ残す。表示用の文字だけを伏せる。
            const issues=collectIssues({report:enriched,readEvidence:(_run,file)=>read(file)}).map(i=>({...i,key:createHash('sha256').update(i.key).digest('hex').slice(0,32),rawKey:/^(unclassified|timeout):/.exec(i.rawKey??'')?.[0]??'',...Object.fromEntries(['rowTitle','title','actual','admin','code','verify'].filter(k=>typeof i[k]==='string').map(k=>[k,clean(i[k])])),urls:i.urls.map(clean)}));
            const brief=({key,rowTitle,level,title,urls,reason})=>({key,rowTitle,level,title,urls,...(['same-check-failing','not-rechecked'].includes(reason)?{reason}:{})}),actorName=actor?.name??null;
            if(!compare){
              const known=new Set(issues.map(i=>i.key)),excludedKeys=[...new Set(keys.filter(k=>known.has(k)))],unconfirmed=unconfirmedCount(enriched);
              const text=buildHandoffText({report:enriched,siteName,issues,excludedKeys,unconfirmed,publicOrigin:process.env.WPQA_PUBLIC_ORIGIN,projectId:p.id,clean});
              if(data.save)try{saveHandoff(dir,{handoffId,createdAt:new Date().toISOString(),actor:actorName??'',sourceRunId:id,sourceFinishedAt:report.finishedAt,siteName,issues:text.included,excludedKeys});}catch(e){reject(400,e.message);}
              return json(200,{handoffId,subject:text.subject,body:text.body,truncated:text.truncated,issues:issues.map(i=>({...brief(i),owner:i.owner})),excludedKeys,unconfirmed});
            }
            if(report.aggregation?.notAFreshRun||(Array.isArray(report.sources)&&report.sources.length))reject(409,'集約結果は再診断として比較できません。新しい実行を選択してください');
            const record=latestHandoff(dir,{exclude:own?.handoffId}),at=r=>Date.parse(r?.finishedAt??r?.startedAt);
            let source=null;try{source=record&&readRun(p,record.sourceRunId);}catch{}
            if(!record||record.sourceRunId===id||!((source?at(source):Date.parse(record.sourceFinishedAt))<at(report)))reject(409,'比較できる引き継ぎ記録がありません');
            const comparison=compareHandoff({record,report:enriched,issues}),text=buildCompareText({comparison,report:enriched,uncheckedAddedKeys:keys,clean});
            if(data.save)try{saveHandoff(dir,nextRecord({record,comparison,uncheckedAddedKeys:keys,report:enriched,siteName,handoffId,actor:actorName}));}catch(e){reject(400,e.message);}
            const {scopeGap,...lists}=comparison;
            return json(200,{handoffId,baseline:{handoffId:record.handoffId,sourceRunId:record.sourceRunId,createdAt:record.createdAt},comparison:Object.fromEntries(Object.entries(lists).map(([k,v])=>[k,v.map(brief)])),scopeGap,body:text.body,truncated:text.truncated});
          }
          if(['issue-report','designer-report'].includes(segments[5])&&segments.length===6&&req.method==='POST'){
            if(report.runStatus!=='finished'||!report.finishedAt||runIsAlive(directory))reject(409,'完了した実行を選択してください');
            const data=await body(req);
            if(typeof data.includeHistory!=='boolean'||typeof (data.notes??'')!=='string'||(data.notes??'').length>10000)reject(400,'報告書の指定が不正です');
            const previous=data.includeHistory?history(p,10000).filter(r=>r.runId!==id).map(r=>readRun(p,r.runId)):[];
            const designer=segments[5]==='designer-report',outputName=designer?'designer-report.html':'issue-report.html';
            const output=path.join(directory,outputName);
            if(fs.existsSync(output)&&fs.lstatSync(output).isSymbolicLink())reject(403,'報告書の保存先を確認してください');
            let bytesRead=0;
            const cached=new Map(),limitedRead=(file,limit)=>{
              if(cached.has(file))return cached.get(file);
              const stat=fs.statSync(file);
              if(!stat.isFile()||stat.size>limit||bytesRead+stat.size>64*1024*1024)throw new Error('Report evidence too large');
              const buffer=fs.readFileSync(file);bytesRead+=buffer.length;
              if(buffer.length>limit||bytesRead>64*1024*1024)throw new Error('Report evidence too large');
              cached.set(file,buffer);return buffer;
            };
            const generated=(designer?buildDesignerReport:buildIssueReport)({current:report,previous,includeHistory:data.includeHistory,notes:data.notes??'',readImage:(runId,file)=>{
              const source=runId===id?report:previous.find(r=>r.runId===runId);
              if(!file.endsWith('.png')||!source?.rows.some(r=>(r.evidence??[]).includes(file)))throw new Error('Unregistered image');
              const image=boundedPath(runPath(p,runId),file);
              const buffer=limitedRead(image,12*1024*1024);
              if(buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Invalid PNG');
              return `data:image/png;base64,${buffer.toString('base64')}`;
            },readConfig:runId=>{
              const context=JSON.parse(limitedRead(boundedPath(runPath(p,runId),'context.json'),16*1024*1024).toString('utf8'));
              const source=runId===id?report:previous.find(r=>r.runId===runId);
              if(context.configHash!==source?.configHash)throw new Error('Config mismatch');
              const {pages,visuals,policies}=context.config;return {pages,visuals,policies};
            },readEvidence:(runId,file)=>{
              const source=runId===id?report:previous.find(r=>r.runId===runId);
              if(!source?.rows.some(r=>(r.evidence??[]).includes(file)))reject(403,'未登録の証拠です');
              const evidence=boundedPath(runPath(p,runId),file);
              return JSON.parse(limitedRead(evidence,16*1024*1024).toString('utf8'));
            }});
            if(Buffer.byteLength(generated.html)>64*1024*1024)reject(413,'報告書が大きすぎます。履歴補完を外して再生成してください');
            const temporary=output+'.'+randomUUID()+'.tmp';
            try{fs.writeFileSync(temporary,generated.html,{flag:'wx'});fs.renameSync(temporary,output);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
            return json(200,{file:outputName,issueCount:generated.issueCount,failedCases:generated.failedCases,warnings:generated.warnings});
          }
          if(segments[5]==='editor-report'&&segments.length===6&&['GET','POST'].includes(req.method)){
            // 編集者向け報告書：登録済みサイトの完了した実行だけ。AI の条件と残り回数を確かめてから、取得も Claude も始める。
            const files={editor:'editor-report.html',basis:'editor-report-basis.html'},exists=name=>fs.existsSync(path.join(directory,name));
            if(!p.managed){if(req.method==='GET')return json(200,{available:false,reason:'登録済みサイトのみ作成できます',groups:0,calls:0,remaining:0,files:{editor:exists(files.editor),basis:exists(files.basis)},stage:null});reject(403,'登録済みサイトのみ作成できます');}
            const finished=report.runStatus==='finished'&&!!report.finishedAt&&!runIsAlive(directory);
            const readContext=()=>{try{const file=boundedPath(directory,'context.json');if(fs.statSync(file).size>16*1024*1024)return null;const context=JSON.parse(fs.readFileSync(file,'utf8'));if(context.configHash!==report.configHash)return null;const {pages,visuals,policies}=context.config;return {pages,visuals,policies};}catch{return null;}};
            const config=readContext(),view=system.view(),remaining=system.remaining();
            const groups=groupRows(report,{environment:report.environment,config}).groups.filter(g=>['editor','admin','tech','not-site'].includes(g.category)).length,calls=estimateEditorCalls(groups+1);
            const busy=!!editorJob||!!active||closing||!!preparing||logins.busy||ai.busy;
            const reason=!finished?'完了した実行を選択してください':!(view.enabled&&view.approved&&view.evidenceApproved&&view.configured)?'AIの利用設定（有効化・承認・取得情報の送信許可）を確認してください':remaining<calls?`本日のAI利用の残り回数が足りません（必要 ${calls} 回・残り ${remaining} 回）`:busy?'ほかの処理が終わってから作成してください':null;
            const stage=editorJob?.projectId===p.id&&editorJob.runId===id?editorJob.stage:null;
            if(req.method==='GET')return json(200,{available:!reason,...(reason?{reason}:{}),groups,calls,remaining,files:{editor:exists(files.editor),basis:exists(files.basis)},stage});
            if(reason)reject(409,reason);
            const data=await body(req);if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length)reject(400,'報告書の指定が不正です');
            if(editorJob||active||closing||preparing||logins.busy||ai.busy)reject(409,'ほかの処理が終わってから作成してください');
            for(const name of Object.values(files)){const output=path.join(directory,name);if(fs.existsSync(output)&&fs.lstatSync(output).isSymbolicLink())reject(403,'報告書の保存先を確認してください');}
            const record=store.record(p.id),baseURL=report.baseURL??record.config.baseURL;
            admission();allowTarget(baseURL);
            editorJob={projectId:p.id,runId:id,stage:'facts'};
            const stageNames={facts:'結果の整理',recheck:'サイトの再確認',writing:'文章の作成',checking:'文章の確認',rendering:'報告書の作成'};
            try{
              const secrets=record.sealed?JSON.parse(store.codec(record.sealed,true)):{};
              const first=record.config.pages?.[0]?.path??'/',sitePath=record.profile?.sitePath??(first.endsWith('/')?first:first.slice(0,first.lastIndexOf('/')+1));
              const allowedOrigins=systemOptions.enforceEgress?view.destinations.map(d=>d.origin):[new URL(baseURL).origin];
              let bytesRead=0;
              const readEvidence=file=>{
                if(typeof file!=='string'||!file.endsWith('.json')||!report.rows.some(r=>(r.evidence??[]).includes(file)))throw new Error('Unregistered evidence');
                const evidence=boundedPath(directory,file),stat=fs.statSync(evidence);
                if(!stat.isFile()||stat.size>16*1024*1024||bytesRead+stat.size>64*1024*1024)throw new Error('Report evidence too large');
                const buffer=fs.readFileSync(evidence);bytesRead+=buffer.length;
                if(bytesRead>64*1024*1024)throw new Error('Report evidence too large');
                return JSON.parse(buffer.toString('utf8'));
              };
              let generated;
              try{
                generated=await buildEditorReport({report,readEvidence,config,site:{name:record.config.name,baseURL,environment:report.environment??record.config.environment},sitePath,allowedOrigins,publicPassword:secrets.publicPassword??'',...(editorRecheckClient?{client:editorRecheckClient}:{}),ai,onStage:s=>{if(editorJob)editorJob.stage=s;}});
              }catch(e){
                const where=stageNames[editorJob?.stage]??'作成';
                if(/^文章の確認に通りませんでした/.test(e?.message))reject(422,e.message);
                if(/[぀-ヿ一-鿿]/.test(String(e?.message)))reject(422,`${where}の段階で止まりました：${e.message}`);
                reject(500,`${where}の段階で編集者向け報告書を作成できませんでした。時間をおいて再試行してください`);
              }
              if(Buffer.byteLength(generated.html)+Buffer.byteLength(generated.basisHtml)>64*1024*1024)reject(413,'報告書が大きすぎます');
              for(const [name,html] of [[files.editor,generated.html],[files.basis,generated.basisHtml]]){
                const output=path.join(directory,name),temporary=output+'.'+randomUUID()+'.tmp';
                try{fs.writeFileSync(temporary,html,{flag:'wx'});fs.renameSync(temporary,output);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
              }
              return json(200,{file:files.editor,basis:files.basis,counts:generated.counts,aiCalls:generated.aiCalls,warnings:generated.warnings});
            }finally{editorJob=null;}
          }
          if(segments.length===5&&req.method==='GET') {
            Object.assign(report,enrichFailures(report,evidenceJSON(directory)));
            let log='';try{log=fs.readFileSync(path.join(directory,'ui.log'),'utf8');}catch{}
            const {configHash}=projectInfo(p);
            const candidates=report.rows.filter(r=>r.id.startsWith('snapshot.')&&fs.existsSync(path.join(directory,'candidates',`${r.id}.png`))).map(r=>r.id);
            return json(200,{report,log,candidates,designerReport:fs.existsSync(path.join(directory,'designer-report.html')),recovery:summarizeRecovery(directory),canApprove:report.configHash===configHash&&!active&&!runIsAlive(directory),orphaned:['running','starting'].includes(report.runStatus)&&active?.runId!==id&&!runIsAlive(directory)});
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
          if(segments.length===6&&segments[5]==='download'&&req.method==='GET'){
            if(['running','starting','planned'].includes(report.runStatus)||runIsAlive(directory))reject(409,'検査の終了後にダウンロードしてください');
            const zip=resultDownload(report,name=>{const file=boundedPath(directory,name);if(fs.statSync(file).size>128*1024*1024)throw Error('File too large');return fs.readFileSync(file);});
            res.setHeader('Content-Type','application/zip');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Disposition',`attachment; filename="qa-results-${id.replace(/[^a-zA-Z0-9_-]/g,'_')}.zip"`);return res.end(zip);
          }
          if(segments.length>=6&&req.method==='GET') {
            const relative=segments[5]==='files'&&segments.length===6?target.searchParams.get('path'):segments.slice(5).join('/');
            const allowed=new Set(['report.html','issue-report.html','designer-report.html','editor-report.html','editor-report-basis.html','results.json','ui.log',...report.rows.flatMap(r=>r.evidence??[])]);
            for(const row of report.rows) if(/^snapshot\.[a-z][a-z0-9-]{0,63}$/.test(row.id))allowed.add(`candidates/${row.id}.png`);
            if(!allowed.has(relative))reject(403,'台帳に登録されていないファイルです');
            let file;try{file=boundedPath(directory,relative);}catch(e){if(e.status)throw e;reject(404,'証拠ファイルがありません');}
            const ext=path.extname(file).toLowerCase();const type=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.html':'text/html; charset=utf-8','.zip':'application/zip'})[ext]??'text/plain; charset=utf-8';
            res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:");
            res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',type);
            if(ext==='.zip')res.setHeader('Content-Disposition','attachment; filename="trace.zip"');
            if(relative==='designer-report.html'&&target.searchParams.get('download')==='1')res.setHeader('Content-Disposition',`attachment; filename="designer-report-${id.replace(/[^a-zA-Z0-9_-]/g,'_')}.html"`);
            await pipeline(fs.createReadStream(file),res);return;
          }
        }
        reject(404,'APIが見つかりません');
      }
      if(req.method!=='GET')reject(404,'ページが見つかりません');
      const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/automation-inputs.js':'automation-inputs.js','/interaction-profile.js':'interaction-profile.js','/case-generator.js':'case-generator.js','/settings.js':'settings.js','/external-auth.js':'external-auth.js','/registration.js':'registration.js','/coverage-editor.js':'coverage-editor.js','/options-form.js':'options-form.js','/designer-report.js':'designer-report.js'};
      files['/preparation-wizard.js']='preparation-wizard.js';
      files['/remote-login.js']='remote-login.js';
      files['/ai-settings.js']='ai-settings.js';files['/ai-preparation.js']='ai-preparation.js';
      files['/site-exam.js']='site-exam.js';files['/risk-rubric.js']='risk-rubric.js';
      const helpFiles={'/help/user-manual.html':'user-manual.html','/help/site-exam-guide.html':'site-exam-guide.html','/help/security-ai-guide.html':'security-ai-guide.html'};
      const helpName=helpFiles[target.pathname];
      if(helpName)res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'");
      const name=helpName??files[target.pathname];if(!name)reject(404,'ページが見つかりません');
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
      res.end(fs.readFileSync(path.join(helpName?path.join(root,'deploy'):publicDir,name)));
    }catch(e){if(e.status===401)res.setHeader('WWW-Authenticate','Basic realm="WordPress QA Pilot", charset="UTF-8"');if(!res.headersSent)json(e.status??500,{error:e.status?e.message:'処理に失敗しました。設定と保存先を確認してください。',...(e.diagnosticId?{diagnosticId:e.diagnosticId,stage:e.stage,code:e.code}:{}),...(e.conflict?{conflict:true}:{})});else res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  url=`http://127.0.0.1:${server.address().port}`;
  return {url,close:async()=>{closing=true;await logins.close();await Promise.allSettled([...jobs]);await new Promise(r=>server.close(r));}};
}



