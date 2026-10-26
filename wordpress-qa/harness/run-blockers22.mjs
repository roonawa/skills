import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ExternalAuth} from './ui/external-auth.mjs';
const file='../../debug-evidence/mannendo-staging/site.json',config=JSON.parse(fs.readFileSync(file));
const env={...process.env,...new ExternalAuth('.ui/projects/external-auth').prepare('b1036ad97b52',config).env};
for(const kind of process.argv.slice(2).length?process.argv.slice(2):['inventory','contact-schema','post-lifecycle','scheduled']){
 const r=spawnSync(process.execPath,['bin/qa.mjs','run','--config',file,'--suite','journey','--id','journey.admin-progress-'+kind],{env,encoding:'utf8',timeout:300000});
 console.log(kind,r.status,r.stdout.slice(-2200),r.stderr.slice(-400));if(r.error)throw r.error;
 const journal='../../debug-evidence/mannendo-staging/coverage-evidence/admin-progress-owned.json';if(fs.existsSync(journal)&&JSON.parse(fs.readFileSync(journal)).pending)throw Error('Pending test post cleanup; stop subsequent writes');
}
