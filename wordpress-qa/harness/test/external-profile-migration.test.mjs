import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ExternalAuth} from '../ui/external-auth.mjs';
import {catalog,validateConfig} from '../lib/config.mjs';
import {generateInteractionChecks} from '../ui/public/interaction-profile.js';
test('external migration preserves profile on auth refresh and keeps admin cookies out of public checks',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-external-profile-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const codec=(v,decode)=>decode?Buffer.from(v,'base64').toString():Buffer.from(v).toString('base64');
 const store=new ExternalAuth(dir,{codec}),id='b1036ad97b52',config={baseURL:'https://fixture.test',environment:'staging',headersEnv:'PUBLIC_GATE',admin:[]};
 const state={cookies:[{name:'wordpress_logged_in_fixture',value:'admin-secret',domain:'fixture.test',path:'/'},{name:'bid_password_protected_auth',value:'gate-secret',domain:'fixture.test',path:'/'}],origins:[]};
 store.save(id,config,state);const record=store.read(id,config);record.profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false};fs.writeFileSync(store.file(id),JSON.stringify(record));
 store.save(id,config,state);const {env}=store.prepare(id,config);
 assert.deepEqual(JSON.parse(env.WPQA_UI_PROFILE),{...record.profile,adminPath:'/wp-admin/',maxPages:200});assert.match(env.WPQA_UI_ADMIN_STATE,/admin-secret/);assert(!env.PUBLIC_GATE.includes('admin-secret'));assert.match(env.PUBLIC_GATE,/gate-secret/);
});
test('interaction run scope selects all common operations without selecting submission journeys',()=>{
 const c=validateConfig(generateInteractionChecks({name:'Fixture',baseURL:'https://fixture.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://fixture.test/',indexable:false}],journeys:[{id:'custom',module:'./never-execute.mjs'}]},{}));
 const selected=catalog(c,'interaction').filter(r=>r.selected);assert.equal(selected.length,4);assert(selected.every(r=>r.kind==='site-interaction'));assert(catalog(c,'all').find(r=>r.id==='journey.custom').selected);
});
