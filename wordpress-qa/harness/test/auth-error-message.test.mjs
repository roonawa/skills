import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startUI} from '../ui/server.mjs';
import {ProjectStore} from '../ui/project-store.mjs';
import {registrationConfig} from '../ui/registration.mjs';

// 登録済みサイトへのログイン保存で失敗したとき、汎用の「処理に失敗しました」ではなく理由を返す。
test('saving a login to a registered site returns the reason when it fails',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-auth-error-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false};
 const store=new ProjectStore(dir),id=store.save({config:registrationConfig({name:'Auth',baseURL:'https://example.test',environment:'staging',profile,discovery:{pages:[{path:'/'}],warnings:[]}}),profile});
 const state={cookies:[{domain:'example.test',path:'/',name:'wordpress_logged_in_fixture',value:'private-cookie'}],origins:[]};
 // 新規登録用に確認済みのログイン（保存先のサイトが違う）を使う。
 const app=await startUI({port:0,storeDir:dir,loginOptions:{resume:{id:'resumed-login',baseURL:'https://example.test',environment:'staging',phase:'verified',state}},publicDiscovery:async()=>({public:{},admin:{}})});t.after(()=>app.close());
 const boot=await(await fetch(app.url+'/api/bootstrap')).json();
 const r=await fetch(`${app.url}/api/projects/${id}/auth`,{method:'POST',headers:{Origin:app.url,'X-QA-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify({loginId:'resumed-login',version:store.record(id).version})});
 const data=await r.json();
 assert.equal(r.status,400,JSON.stringify(data));
 assert.match(data.error,/確認済みログインと保存先が一致しません/);
 assert(!JSON.stringify(data).includes('private-cookie'));
});
