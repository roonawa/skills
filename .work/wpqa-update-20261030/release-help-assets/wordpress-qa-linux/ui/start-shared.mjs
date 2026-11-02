import fs from 'node:fs';
import '../lib/shared-runtime.mjs';
import path from 'node:path';
import {startUI} from './server.mjs';
import {codecFromFile} from './secret-codec.mjs';

try{
 const required=name=>{if(!process.env[name])throw Error(`${name} が必要です`);return process.env[name];};
 const origin=required('WPQA_PUBLIC_ORIGIN'),keyFile=required('WPQA_ENCRYPTION_KEY_FILE'),usersFile=required('WPQA_USERS_FILE');
 const directory=path.resolve(required('WPQA_DATA_DIR'));
 const codec=codecFromFile(keyFile),users=JSON.parse(fs.readFileSync(usersFile,'utf8'));
 const admins=required('WPQA_ADMINS').split(',').map(x=>x.trim()).filter(Boolean);
 if(!admins.length||admins.some(name=>!users.some(u=>u.name===name)))throw Error('WPQA_ADMINSには登録済み利用者名を指定してください');
 required('WPQA_EGRESS_PROXY');required('WPQA_BROWSER_CHROMIUM');required('WPQA_BROWSER_FIREFOX');
 const maxDataMB=Number(process.env.WPQA_MAX_DATA_MB??8192);if(!Number.isInteger(maxDataMB)||maxDataMB<512||maxDataMB>1048576)throw Error('保存容量上限が不正です');
 const app=await startUI({host:'0.0.0.0',port:4310,storeDir:path.join(directory,'projects'),credentialCodec:codec,shared:{origin,users},auditFile:path.join(directory,'audit.jsonl'),systemOptions:{directory:path.join(directory,'system'),policyFile:required('WPQA_POLICY_FILE'),admins,enforceEgress:true,maxDataMB}});
 console.log(`WordPress QA 社内試用版: ${origin} （TLSプロキシ経由のみで利用）`);
 let closing=false;const close=async()=>{if(closing)return;closing=true;await app.close();};
 process.on('SIGINT',close);process.on('SIGTERM',close);
}catch(error){console.error(error.message);process.exitCode=1;}
