import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadConfig,catalog } from '../lib/config.mjs';

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
  let data='';for await(const chunk of req){data+=chunk;if(data.length>8192)reject(413,'リクエストが大きすぎます');}
  try{return JSON.parse(data);}catch{reject(400,'JSON形式が不正です');}
}
function projectInfo(project) {
  const ctx=loadConfig(project.file),c=ctx.config;
  const outputDir=path.resolve(ctx.configDir,c.outputDir??'runs');
  if(outputDir!==project.outputDir) reject(409,'出力先が変更されています。アプリを再起動してください');
  return {...ctx,outputDir,baselineDir:path.resolve(ctx.configDir,c.baselineDir??'baselines')};
}

export async function startUI({configPaths,port=4310,demo=false}) {
  if(!configPaths?.length) throw new Error('At least one registered config is required');
  const token=randomBytes(24).toString('hex'),projects=new Map(),outputDirs=new Set();
  for(const filename of configPaths) {
    const ctx=loadConfig(filename),outputDir=path.resolve(ctx.configDir,ctx.config.outputDir??'runs');
    if(outputDirs.has(outputDir)) throw new Error('Each UI project must have a distinct outputDir');outputDirs.add(outputDir);
    const id=createHash('sha256').update(ctx.configPath).digest('hex').slice(0,12);
    projects.set(id,{id,file:ctx.configPath,outputDir});
  }
  let active=null,lastJob=null,closing=false,url;
  const jobs=new Set();
  const getProject=id=>{const p=projects.get(id);if(!p)reject(404,'登録されていないサイトです');return p;};
  function runPath(p,id) {
    if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,128}$/.test(id)) reject(400,'実行IDが不正です');
    try{return boundedPath(p.outputDir,id);}catch(e){if(e.status)throw e;reject(404,'実行履歴が見つかりません');}
  }
  function readRun(p,id){try{return readJSON(path.join(runPath(p,id),'results.json'));}catch(e){if(e.status)throw e;reject(404,'結果がまだ保存されていません');}}
  function history(p) {
    if(!fs.existsSync(p.outputDir))return [];
    return fs.readdirSync(p.outputDir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>{
      try {const r=readRun(p,e.name);return {runId:e.name,startedAt:r.startedAt,finishedAt:r.finishedAt,runStatus:r.runStatus,gatePassed:r.gatePassed,summary:r.summary};}catch{return null;}
    }).filter(Boolean).sort((a,b)=>(b.startedAt??b.runId).localeCompare(a.startedAt??a.runId)).slice(0,100);
  }
  function jobState(job){return job?{projectId:job.projectId,kind:job.kind,runId:job.runId,state:job.state,exitCode:job.exitCode,log:job.log}:null;}
  function launch(p,args,kind) {
    if(closing)reject(503,'終了処理中です');if(active)reject(409,'別の処理が実行中です。完了を待ってください');
    const job={projectId:p.id,kind,runId:null,state:'starting',log:'',exitCode:null};active=job;lastJob=job;
    const child=spawn(process.execPath,[path.join(root,'bin/qa.mjs'),...args],{cwd:root,env:{...process.env,FORCE_COLOR:'0'},stdio:['ignore','pipe','pipe','ipc']});
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
      const finish=(code,error)=>{if(ended)return;ended=true;if(error)append(error.message);job.exitCode=code;job.state='finished';if(active===job)active=null;resolve(jobState(job));};
      child.once('error',e=>finish(2,e));child.once('close',code=>finish(code??2));
    });
    jobs.add(done);done.finally(()=>jobs.delete(done));return {job,done};
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
        });return json(200,{token,projects:list,demo});
      }
      if(segments[0]==='api'&&segments[1]==='projects') {
        const p=getProject(segments[2]);
        if(segments.length===3&&req.method==='GET') {
          const {config:c,configHash}=projectInfo(p);
          return json(200,{project:{id:p.id,name:c.name,baseURL:c.baseURL,environment:c.environment,configPath:p.file,configHash,counts:{pages:c.pages.length,journeys:c.journeys.length,visuals:c.visuals.length},planned:catalog(c).length},runs:history(p),busy:!!active,active:jobState(active),lastJob:lastJob?.projectId===p.id?jobState(lastJob):null});
        }
        if(segments[3]==='runs'&&segments.length===4&&req.method==='POST') {
          const data=await body(req);if(!['all','audit','journey','visual'].includes(data.suite))reject(400,'検査範囲が不正です');projectInfo(p);
          const {job}=launch(p,['run','--config',p.file,'--suite',data.suite],'run');return json(202,jobState(job));
        }
        if(segments[3]==='runs'&&segments[4]) {
          const id=segments[4],report=readRun(p,id),directory=runPath(p,id);
          if(segments.length===5&&req.method==='GET') {
            let log='';try{log=fs.readFileSync(path.join(directory,'ui.log'),'utf8');}catch{}
            const {configHash}=projectInfo(p);
            const candidates=report.rows.filter(r=>r.id.startsWith('snapshot.')&&fs.existsSync(path.join(directory,'candidates',`${r.id}.png`))).map(r=>r.id);
            return json(200,{report,log,candidates,canApprove:report.configHash===configHash&&!active,orphaned:['running','starting'].includes(report.runStatus)&&active?.runId!==id});
          }
          if(segments[5]==='approve'&&segments.length===6&&req.method==='POST') {
            const data=await body(req);if(data.confirmed!==true)reject(400,'画像の確認が必要です');
            if(typeof data.id!=='string'||!/^snapshot\.[a-z][a-z0-9-]{0,63}$/.test(data.id))reject(400,'画像IDが不正です');
            projectInfo(p);const {done}=launch(p,['approve-baseline','--config',p.file,'--run',directory,'--id',data.id],'approve');
            const outcome=await done;return json(outcome.exitCode===0?200:409,{ok:outcome.exitCode===0,message:outcome.log});
          }
          if(segments.length>=6&&req.method==='GET') {
            const relative=segments[5]==='files'&&segments.length===6?target.searchParams.get('path'):segments.slice(5).join('/');
            const allowed=new Set(['report.html','results.json','ui.log',...report.rows.flatMap(r=>r.evidence??[])]);
            for(const row of report.rows) if(/^snapshot\.[a-z][a-z0-9-]{0,63}$/.test(row.id))allowed.add(`candidates/${row.id}.png`);
            if(!allowed.has(relative))reject(403,'台帳に登録されていないファイルです');
            let file;try{file=boundedPath(directory,relative);}catch(e){if(e.status)throw e;reject(404,'証拠ファイルがありません');}
            const ext=path.extname(file).toLowerCase();const type=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.html':'text/html; charset=utf-8','.zip':'application/zip'})[ext]??'text/plain; charset=utf-8';
            res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self'");
            res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',type);
            if(ext==='.zip')res.setHeader('Content-Disposition','attachment; filename="trace.zip"');
            return res.end(fs.readFileSync(file));
          }
        }
        reject(404,'APIが見つかりません');
      }
      if(req.method!=='GET')reject(404,'ページが見つかりません');
      const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
      const name=files[target.pathname];if(!name)reject(404,'ページが見つかりません');
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
      res.end(fs.readFileSync(path.join(publicDir,name)));
    }catch(e){if(!res.headersSent)json(e.status??500,{error:e.status?e.message:'処理に失敗しました。設定と保存先を確認してください。'});else res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  url=`http://127.0.0.1:${server.address().port}`;
  return {url,close:async()=>{closing=true;await Promise.allSettled([...jobs]);await new Promise(r=>server.close(r));}};
}
