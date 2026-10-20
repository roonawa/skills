import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProjectStore,protect} from '../ui/project-store.mjs';
const config={name:'Site',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',canonical:'https://example.test/',indexable:false}],admin:[{id:'tz',source:'rest',path:'/wp-json/wp/v2/settings',field:'timezone',expected:'Asia/Tokyo'}]};
test('managed sites persist with encrypted credentials, version conflicts and host binding',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-store-'));let secret='';
 const codec=(s,decode)=>decode?secret:(secret=s,'opaque-encrypted');
 try{
  const store=new ProjectStore(dir,{codec});
  const id=store.save({config,auth:{rest:{username:'qa',password:'test-secret'}}});
  const view=store.view(id);assert.equal(view.credentials.rest,true);
  assert.ok(!JSON.stringify(view).includes('test-secret'));assert.ok(!fs.readFileSync(store.file(id),'utf8').includes('test-secret'));
  assert.equal(new ProjectStore(dir,{codec}).view(id).config.name,'Site');
  assert.ok(store.prepare(id).env.WPQA_UI_ADMIN_HEADERS.includes('Basic '));
  assert.throws(()=>store.save({id,version:'old',config}),/更新/);
  assert.throws(()=>store.save({id,version:view.version,config:{...config,baseURL:'https://other.test'}}),/URL変更/);
  assert.throws(()=>store.save({config:{...config,journeys:[{id:'evil',module:'C:/evil.js'}]}}),/コード/);
  assert.throws(()=>store.save({config,auth:{browser:{cookies:[{domain:'other.test',name:'a',value:'b',path:'/'}],origins:[]}}}),/ホスト/);
  const other=store.save({config:{...config,baseURL:'https://example.test/'},auth:{browser:{cookies:[],origins:[{origin:'https://example.test',localStorage:[]}]}}});
  assert.equal(store.view(other).config.baseURL,'https://example.test');
  assert.throws(()=>store.save({config,auth:{clearRest:true,rest:{username:'qa',password:'test'}}}),/同時/);
  store.save({id,version:view.version,config,auth:{clearRest:true}});assert.equal(store.view(id).credentials.rest,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Windows credential encryption round trips without plaintext',{skip:process.platform!=='win32'},()=>{
 const raw='qa-test-秘密';const sealed=protect(raw);assert.ok(!sealed.includes(raw));assert.equal(protect(sealed,true),raw);
});
