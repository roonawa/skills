import fs from 'node:fs';
import path from 'node:path';
import { classify, writeReport } from './results.mjs';
export default class Reporter {
  constructor(){this.ctx=JSON.parse(fs.readFileSync(process.env.WPQA_CONTEXT,'utf8'));this.report=this.ctx.report;}
  onBegin() {this.report.runStatus='running';writeReport(this.ctx.runDir,this.report);}
  onTestBegin(test) {
    const row=this.report.rows.find(r=>test.title.startsWith(`${r.id} |`));
    if(row) {row.active=true;row.reason='実行中';writeReport(this.ctx.runDir,this.report);}
  }
  onTestEnd(test,result) {
    const row=this.report.rows.find(r=>test.title.startsWith(`${r.id} |`)); if(!row) return;
    row.active=false;row.status=classify(result,test.annotations);row.durationMs=result.duration;
    row.reason=test.annotations.find(a=>a.type==='qa-review')?.description ?? result.errors.map(e=>e.message??'').join('\n') ?? '';
    row.evidence=[];
    for(const attachment of result.attachments) {
      if(!attachment.path) continue;
      const relative=path.relative(this.ctx.runDir,attachment.path);
      if(!relative.startsWith('..')&&!path.isAbsolute(relative)) row.evidence.push(relative.split(path.sep).join('/'));
    }
    writeReport(this.ctx.runDir,this.report);
  }
  onError(error) { this.report.errors.push(error.message??String(error));writeReport(this.ctx.runDir,this.report); }
  onEnd(result) {
    if(result.status!=='passed' && !this.report.rows.some(r=>['fail','blocked'].includes(r.status))) this.report.errors.push(`Runner: ${result.status}`);
    this.report.runStatus=result.status==='interrupted'?'interrupted':'finished';
    for(const row of this.report.rows) row.active=false;
    this.report.finishedAt=new Date().toISOString();writeReport(this.ctx.runDir,this.report);
  }
}
