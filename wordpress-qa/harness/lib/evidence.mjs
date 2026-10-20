import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Never persist credentials, filled form data, or URL query secrets in diagnostic evidence.
export function redactor(config={},env=process.env){
 const secrets=new Set();
 const collect=value=>{
  if(typeof value==='string'&&value.length>0)secrets.add(value);
  else if(Array.isArray(value))value.forEach(collect);
  else if(value&&typeof value==='object')Object.values(value).forEach(collect);
 };
 const references=new Set();
 const findReferences=value=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(/Env$/.test(key)&&typeof item==='string')references.add(item);else findReferences(item);}};
 findReferences(config);
 for(const [key,value] of Object.entries(env))if((references.has(key)||/^WPQA_.*(?:HEADERS|STATE|PASSWORD|SECRET)$/.test(key))&&value){
  collect(value);
  try{const parsed=JSON.parse(value);if(Array.isArray(parsed?.cookies)||Array.isArray(parsed?.origins)){for(const c of parsed.cookies??[])collect(c.value);for(const o of parsed.origins??[])for(const v of o.localStorage??[])collect(v.value);}else collect(parsed);}catch{collect(value);}
 }
 for(const c of config.checks??[])for(const s of c.options?.steps??[])if(['fill','setInputFiles'].includes(s.action))collect(s.value);
 const cleanString=value=>{
  let text=String(value);
  for(const secret of [...secrets].sort((a,b)=>b.length-a.length))text=text.split(secret).join('[REDACTED]');
  return text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/=._~-]+/gi,'$1 [REDACTED]')
   .replace(/https?:\/\/[^\s"'<>]+/g,url=>{try{const u=new URL(url);u.username='';u.password='';for(const key of [...u.searchParams.keys()])u.searchParams.set(key,'[REDACTED]');u.hash='';return u.href;}catch{return '[URL]';}}).slice(0,16000);
 };
 const clean=(value,key='',depth=0)=>{
  if(depth>12)return '[DEPTH LIMIT]';
  if(/^(?:authorization|cookie|set-cookie|password|secret|storageState|headers|requestBody|responseBody)$/i.test(key))return '[REDACTED]';
  if(typeof value==='string')return cleanString(value);
  if(value instanceof Error)return {name:value.name,message:cleanString(value.message),stack:cleanString(value.stack??''),...(value.actual!==undefined?{actual:clean(value.actual,'actual',depth+1)}:{}),...(value.expected!==undefined?{expected:clean(value.expected,'expected',depth+1)}:{})};
  if(Array.isArray(value))return value.slice(0,500).map(v=>clean(v,'',depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,100).map(([k,v])=>[k,clean(v,k,depth+1)]));
  return value;
 };
 return clean;
}
export function createEvidence({runDir,check,config,env}){
 const clean=redactor(config,env),dir=path.join(runDir,'diagnostics');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,check.id+'.jsonl'),events=[];
 const record=event=>{const safe=clean({timestamp:new Date().toISOString(),...event});events.push(safe);fs.appendFileSync(file,JSON.stringify(safe)+'\n',{mode:0o600});return safe;};
 record({phase:'start',checkId:check.id,kind:check.kind});
 return {record,events,file,clean,summary:()=>({checkId:check.id,kind:check.kind,events:[...events],journal:'diagnostics/'+check.id+'.jsonl'})};
}
export function digest(value){return {sha256:createHash('sha256').update(String(value)).digest('hex'),length:String(value).length};}
