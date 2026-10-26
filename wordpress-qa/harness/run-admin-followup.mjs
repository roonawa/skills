import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {ExternalAuth} from './ui/external-auth.mjs';
const file='../../debug-evidence/mannendo-staging/site.json',config=JSON.parse(fs.readFileSync(file));
const env={...process.env,...new ExternalAuth('.ui/projects/external-auth').prepare('b1036ad97b52',config).env};
for(const args of [['--suite','admin']]){
 const result=spawnSync(process.execPath,['bin/qa.mjs','run','--config',file,...args],{env,encoding:'utf8',timeout:300000});
 console.log(args.join(' '), 'exit', result.status); console.log(result.stdout.slice(-1800));
 if(result.error)throw result.error;
 if(result.stderr)console.log(result.stderr.slice(-800));
}
