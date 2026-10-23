import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-external-auth-'));
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html lang="ja"><head><title>Fixture</title><link rel="canonical" href="${origin}/"></head><body>Fixture</body></html>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
fs.copyFileSync(path.resolve('../../debug-evidence/mannendo-staging/operations/common.mjs'),path.join(dir,'common.mjs'));
fs.writeFileSync(path.join(dir,'operation.mjs'),`export {authenticate} from './common.mjs'; export async function run({page,expect}) {await page.goto('/'); await expect(page.locator('body')).toContainText('Fixture');}`);
const config={name:'External auth',baseURL:origin,environment:'local',allowTestWrites:true,headersEnv:'WPQA_EXTERNAL_AUTH_HEADERS',outputDir:'runs',pages:[{id:'home',path:'/',canonical:origin+'/',indexable:true}],journeys:[{id:'operation',module:'operation.mjs',explicitOnly:true,runWithSuite:true,handlesAuthentication:true}],visuals:[],manual:[]};
fs.writeFileSync(path.join(dir,'site.json'),JSON.stringify(config));
try{
 const env={...process.env,WPQA_OPERATION_ID:'suite',WPQA_OPERATION_MODE:'preview'};delete env.WPQA_EXTERNAL_AUTH_HEADERS;
 const child=spawn(process.execPath,['bin/qa.mjs','run','--config',path.join(dir,'site.json'),'--suite','all'],{env,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});assert.equal(code,0,log);
 const run=fs.readdirSync(path.join(dir,'runs'),{withFileTypes:true}).find(d=>d.isDirectory());const result=JSON.parse(fs.readFileSync(path.join(dir,'runs',run.name,'results.json')));
 assert.deepEqual(result.rows.filter(r=>r.selected).map(r=>[r.id,r.status]),[['page.home','pass'],['links.home','pass'],['journey.operation','pass']]);console.log(JSON.stringify({ok:true,externalModule:dir,results:result.summary}));
}finally{await new Promise(resolve=>server.close(resolve));}
