import fs from 'node:fs';
import path from 'node:path';
import {startUI} from './server.mjs';
import {codecFromFile} from './secret-codec.mjs';

try{
 const required=name=>{if(!process.env[name])throw Error(`${name} が必要です`);return process.env[name];};
 const origin=required('WPQA_PUBLIC_ORIGIN'),keyFile=required('WPQA_ENCRYPTION_KEY_FILE'),usersFile=required('WPQA_USERS_FILE');
 const directory=path.resolve(required('WPQA_DATA_DIR'));
 const codec=codecFromFile(keyFile),users=JSON.parse(fs.readFileSync(usersFile,'utf8'));
 const app=await startUI({host:'0.0.0.0',port:4310,storeDir:path.join(directory,'projects'),credentialCodec:codec,shared:{origin,users},auditFile:path.join(directory,'audit.jsonl')});
 console.log(`WordPress QA 社内試用版: ${origin} （TLSプロキシ経由のみで利用）`);
 let closing=false;const close=async()=>{if(closing)return;closing=true;await app.close();};
 process.on('SIGINT',close);process.on('SIGTERM',close);
}catch(error){console.error(error.message);process.exitCode=1;}
