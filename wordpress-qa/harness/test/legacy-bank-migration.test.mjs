import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {beginBankAttempt,bankMarker} from '../builtin/wordpress-profile/bank-order.mjs';
test('migration cannot bypass a legacy submitted order without verified cancellation',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-legacy-bank-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'operations'));const legacy=path.join(dir,'operations','bank-pending.json');
 const config={baseURL:'https://fixture.test',environment:'staging',allowTestWrites:true};const context={config,configDir:dir,runDir:dir};
 fs.writeFileSync(legacy,JSON.stringify({submissionStarted:true,completion:true}));
 assert.throws(()=>beginBankAttempt(config,context,bankMarker('legacy')),/legacy bank attempt/);
 assert.equal(fs.existsSync(path.join(dir,'profile-bank-pending.json')),false);
 fs.writeFileSync(legacy,JSON.stringify({submissionStarted:true,completion:true,cancelled:true}));
 const journal=beginBankAttempt(config,context,bankMarker('resolved'));journal.finish('not_started');journal.close();
});
