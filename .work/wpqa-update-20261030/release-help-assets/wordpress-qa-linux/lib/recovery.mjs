import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import { readFile, appendFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
const filename='recovery-journal.json';
export async function readJournal(runDir){try{const lines=(await readFile(path.join(runDir,filename),'utf8')).trim().split('\n');for(let i=lines.length-1;i>=0;i--){try{return JSON.parse(lines[i]);}catch{}}throw new Error('Invalid recovery journal');}catch(e){if(e.code==='ENOENT')return [];throw e;}}
export async function saveJournal(runDir,entries){if(!runDir)return;await mkdir(runDir,{recursive:true});const target=path.join(runDir,filename);await appendFile(target,'\n'+JSON.stringify(entries)+'\n',{mode:0o600});const handle=await open(target,'r+');try{await handle.sync();}finally{await handle.close();}}
export async function journalIntent(runDir,entry){if(!runDir)return;const entries=await readJournal(runDir);entries.push({...entry,state:'pending'});await saveJournal(runDir,entries);}
export async function journalUpdate(runDir,marker,patch){if(!runDir)return;const entries=await readJournal(runDir);const entry=entries.find(e=>e.marker===marker);assert(entry,'Missing recovery intent');Object.assign(entry,patch);await saveJournal(runDir,entries);}
export async function recover({runDir,config,requestFactory,headersEnv='WPQA_UI_ADMIN_HEADERS',record=()=>{}}){
 assert(config.environment!=='production'&&config.allowTestWrites===true,'BLOCKED: recovery requires non-production and allowTestWrites=true');
 const base=new URL(config.baseURL), entries=await readJournal(runDir);let recovered=0;
 for(const e of entries.filter(e=>e.state==='pending')){let c;try{
 const credentialEnv=e.headersEnv??headersEnv;assert(typeof credentialEnv==='string'&&/^[A-Z_][A-Z0-9_]*$/.test(credentialEnv),'Invalid recovery credential name');
 const extraHTTPHeaders=JSON.parse(process.env[credentialEnv]||'null');assert(extraHTTPHeaders&&!Array.isArray(extraHTTPHeaders)&&typeof extraHTTPHeaders==='object'&&Object.keys(extraHTTPHeaders).length&&Object.values(extraHTTPHeaders).every(v=>typeof v==='string'),'BLOCKED: recovery credentials missing or invalid');
 c=await requestFactory.newContext({extraHTTPHeaders,timeout:config.timeoutMs||30000});
 async function fetch(p,method='GET'){const u=new URL(p,base);assert.equal(u.origin,base.origin);const r=await c.fetch(u.href,{method,maxRedirects:0});assert(r.status()<300||r.status()>=400,'Recovery redirect refused');return r;}
 assert.equal(e.site,base.origin,'Recovery site mismatch');assert(/^wpqa-[0-9a-f-]{36}$/.test(e.marker),'Recovery marker invalid');assert(/^\/[a-zA-Z0-9_\/-]+$/.test(e.collection),'Recovery collection invalid');
 const me=await fetch(e.rest+'/users/me?context=edit');assert.equal(me.status(),200);assert.equal((await me.json()).id,e.credentialOwner||e.owner,'Recovery authenticated owner mismatch');
 const found=await fetch(e.collection+'?context=edit&status[]=draft&status[]=pending&status[]=private&status[]=future&status[]=publish&status[]=trash&slug='+encodeURIComponent(e.marker));assert.equal(found.status(),200);const items=await found.json();assert(Array.isArray(items)&&items.length<=1,'Recovery lookup ambiguous');
 if(!items.length){e.state='absent';await saveJournal(runDir,entries);continue;}
 const p=items[0];assert.equal(p.slug,e.marker,'Recovery marker mismatch');const allowedOwners=[e.owner];if(e.plannedOwner!==undefined&&e.plannedOwner!==null){assert(Number.isInteger(e.plannedOwner)&&e.plannedOwner>0&&Number.isInteger(e.id)&&e.id>0,'Recovery owner transition invalid');allowedOwners.push(e.plannedOwner);}assert(allowedOwners.includes(p.author),'Recovery object owner mismatch');assert(Number.isInteger(p.id)&&p.id>0);if(e.id)assert.equal(p.id,e.id,'Recovery ID mismatch');
 const response=await fetch(e.collection+'/'+p.id+'?force=true','DELETE');assert.equal(response.status(),200);assert.equal((await response.json()).deleted,true);e.state='deleted';recovered++;await saveJournal(runDir,entries);await record({phase:'recovery-deleted',postId:p.id});
 }catch{await record({phase:'recovery-pending',marker:e.marker});}finally{if(c)await c.dispose();}}
 return {recovered,pending:entries.filter(e=>e.state==='pending').length};
}


export function summarizeRecovery(runDir){let entries=[];try{const lines=readFileSync(path.join(runDir,filename),'utf8').trim().split('\n');let valid=false;for(let i=lines.length-1;i>=0;i--){try{entries=JSON.parse(lines[i]);valid=true;break;}catch{}}assert(valid,'Invalid recovery journal');}catch(e){if(e.code!=='ENOENT')throw e;}const items=entries.filter(e=>e.state==="pending").map(({marker,id,site})=>({marker,id,site}));return {pending:items.length,count:entries.length,items};}
