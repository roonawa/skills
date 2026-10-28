import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {hashPassword} from '../ui/shared-access.mjs';

// Run locally by the deployment administrator. Never print credentials to logs.
const [directory,...names]=process.argv.slice(2);
if(!directory||!names.length||names.length>50||new Set(names).size!==names.length||names.some(n=>!/^[a-zA-Z0-9_-]{1,64}$/.test(n)))throw Error('Usage: node bin/init-pilot.mjs NEW_DIRECTORY alice bob');
const target=path.resolve(directory);
fs.mkdirSync(target,{mode:0o700}); // deliberately refuses to overwrite an existing directory
const users=[],credentials=[];
for(const name of names){const password=randomBytes(24).toString('base64url');users.push({name,...hashPassword(password)});credentials.push({name,password});}
fs.writeFileSync(path.join(target,'key'),randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});
fs.writeFileSync(path.join(target,'users.json'),JSON.stringify(users,null,2),{flag:'wx',mode:0o600});
fs.writeFileSync(path.join(target,'initial-passwords.json'),JSON.stringify(credentials,null,2),{flag:'wx',mode:0o600});
console.log(`初期設定を ${target} に保存しました。initial-passwords.json は管理者が個別配布し、サーバーにはマウントしないでください。`);
