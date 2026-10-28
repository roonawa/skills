import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {zipFiles} from '../lib/zip.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixed=['Dockerfile','.dockerignore','package.json','package-lock.json','playwright.config.mjs','deploy/compose.yaml','deploy/Caddyfile','deploy/.env.example','deploy/install-guide.html'];
const files=[];
function add(name){const file=path.join(root,name);if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw Error('Not a regular file: '+name);files.push({name,data:fs.readFileSync(file)});}
function walk(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Symlink forbidden');const name=dir+'/'+entry.name;if(entry.name.startsWith('.'))continue;if(entry.isDirectory())walk(name);else if(/\.(mjs|js|html|css)$/.test(entry.name))add(name);}}
for(const name of fixed)add(name);for(const dir of ['bin','lib','builtin','tests','ui'])walk(dir);
files.sort((a,b)=>a.name.localeCompare(b.name));
const manifest=files.map(f=>({path:f.name,bytes:f.data.length,sha256:createHash('sha256').update(f.data).digest('hex')}));
files.push({name:'SHA256SUMS',data:manifest.map(f=>`${f.sha256}  ${f.path}`).join('\n')+'\n'},{name:'MANIFEST.json',data:JSON.stringify({version:'2026-10-28',excluded:['credentials','registered sites','test results','screenshots','sessions','node_modules','.git'],files:manifest},null,2)},{name:'START-HERE.txt',data:'導入手順書: deploy/install-guide.html\nこの配布物には認証情報・登録サイト・テスト結果は含まれていません。\n'});
const out=path.join(root,'dist','wordpress-qa-linux-2026-10-28.zip');fs.mkdirSync(path.dirname(out),{recursive:true});const zip=zipFiles(files.map(f=>({...f,name:'wordpress-qa-linux/'+f.name})));fs.writeFileSync(out,zip);fs.writeFileSync(out+'.sha256',createHash('sha256').update(zip).digest('hex')+'  '+path.basename(out)+'\n');console.log(JSON.stringify({file:out,files:files.length,bytes:zip.length}));
