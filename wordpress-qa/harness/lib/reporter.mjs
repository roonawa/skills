import fs from 'node:fs';
import path from 'node:path';
import { classify, writeReport } from './results.mjs';
import {redactor} from './evidence.mjs';
import {scopedFile,restoreDiagnostics} from './diagnostics.mjs';
export default class Reporter {
  constructor(){this.ctx=JSON.parse(fs.readFileSync(process.env.WPQA_CONTEXT,'utf8'));this.report=this.ctx.report;this.clean=redactor(this.ctx.config);}
  onBegin() {this.report.runStatus='running';writeReport(this.ctx.runDir,this.report);}
  onTestBegin(test) {
    const row=this.report.rows.find(r=>test.title.startsWith(`${r.id} |`));
    if(row) {row.active=true;row.reason='実行中';writeReport(this.ctx.runDir,this.report);}
  }
  onTestEnd(test,result) {
    const row=this.report.rows.find(r=>test.title.startsWith(`${r.id} |`)); if(!row) return;
    row.active=false;row.status=classify(result,test.annotations);row.durationMs=result.duration;
    row.reason=this.clean(test.annotations.find(a=>a.type==='qa-review')?.description ?? result.errors.map(e=>e.message??'').join('\n') ?? '');
    row.evidence=[];
    for(const attachment of result.attachments) {
      if(!attachment.path) continue;
      let scoped;try{scoped=scopedFile(this.ctx.runDir,attachment.path);}catch{continue;}
      if(attachment.name==='extended-result'){try{row.details=this.clean(JSON.parse(fs.readFileSync(scoped.file,'utf8')));}catch{}}
      if(attachment.name==='extended-evidence'){try{row.diagnostics=this.clean(JSON.parse(fs.readFileSync(scoped.file,'utf8')));}catch{}}
      if(row.suite==='admin'&&attachment.name==='admin-setting') {try{row.setting=JSON.parse(fs.readFileSync(attachment.path,'utf8'));}catch{}}
      row.evidence.push(scoped.relative);
    }
    restoreDiagnostics(this.ctx.runDir,row);
    writeReport(this.ctx.runDir,this.report);
  }
  onError(error) { this.report.errors.push(this.clean(error.message??String(error)));writeReport(this.ctx.runDir,this.report); }
  onEnd(result) {
    if(result.status!=='passed' && !this.report.rows.some(r=>['fail','blocked'].includes(r.status))) this.report.errors.push(`Runner: ${result.status}`);
    this.report.runStatus=result.status==='interrupted'?'interrupted':'finished';
    for(const row of this.report.rows) row.active=false;
    this.report.finishedAt=new Date().toISOString();writeReport(this.ctx.runDir,this.report);
  }
}
