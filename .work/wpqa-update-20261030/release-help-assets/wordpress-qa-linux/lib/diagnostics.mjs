import fs from 'node:fs';
import path from 'node:path';
export function scopedFile(runDir,filename) {
  const root=fs.realpathSync(runDir),file=fs.realpathSync(path.resolve(root,filename));
  const relative=path.relative(root,file);
  if(!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(file).isFile()) throw new Error('Evidence file outside run directory');
  return {file,relative:relative.split(path.sep).join('/')};
}
export function restoreDiagnostics(runDir,row) {
  const id=row.id?.startsWith('check.')?row.id.slice(6):'';
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id))return row;
  try {
    const {file,relative}=scopedFile(runDir,`diagnostics/${id}.jsonl`);
    if(fs.statSync(file).size>8*1024*1024)return row;
    const events=[];
    for(const line of fs.readFileSync(file,'utf8').split('\n')) {
      if(!line.trim())continue;
      try {const event=JSON.parse(line);if(event&&typeof event==='object'&&!Array.isArray(event))events.push(event);}catch{/* A worker may stop mid-line. */}
    }
    if(events.length) {
      row.diagnostics={checkId:id,kind:events[0].kind,events,journal:relative};
      row.evidence=[...new Set([...(row.evidence??[]),relative])];
      for(const event of events)if(event.kind==='artifact'&&typeof event.file==='string') {
        try {row.evidence.push(scopedFile(runDir,event.file).relative);}catch{}
      }
      row.evidence=[...new Set(row.evidence)];
    }
  }catch{/* No durable journal yet, or invalid path. */}
  return row;
}
