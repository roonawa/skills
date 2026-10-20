import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProjectStore} from '../ui/project-store.mjs';
import {BrowserLogin} from '../ui/browser-login.mjs';
const config={name:'Role test',baseURL:'https://example.test',environment:'staging',pages:[{id:'home',path:'/',indexable:false,canonical:'https://example.test/'}]};
test('role secrets are isolated, prepared, cleared and origin bound',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-roles-'));const codec=(s,d)=>d?Buffer.from(s,'base64').toString():Buffer.from(s).toString('base64');
 try{const store=new ProjectStore(dir,{codec});const id=store.save({config,auth:{roleCredentials:[{name:'content-editor',rest:{username:'editor',password:'secret'},browser:{cookies:[],origins:[]}}]}});let v=store.view(id);
 assert.deepEqual(v.credentials.roles['content-editor'],{rest:true,browser:true});assert(!JSON.stringify(v).includes('secret'));assert(store.prepare(id).env.WPQA_ROLE_CONTENT_EDITOR_HEADERS.includes('Basic'));assert.equal(store.prepare(id).env.WPQA_ROLE_CONTENT_EDITOR_STATE,'{"cookies":[],"origins":[]}');
 assert.throws(()=>store.save({id,version:v.version,config:{...config,baseURL:'https://other.test'},auth:{clearRest:true,clearBrowser:true}}),/URL変更/);
 store.save({id,version:v.version,config:{...config,baseURL:'https://other.test'},auth:{roleCredentials:[{name:'content-editor',clearRest:true,clearBrowser:true}]}});v=store.view(id);assert.deepEqual(v.credentials.roles,{});
 assert.throws(()=>store.save({config,auth:{roleCredentials:[{name:'__proto__',rest:{username:'x',password:'y'}}]}}));
 assert.throws(()=>store.save({config,auth:{roleCredentials:[{name:'editor'},{name:'editor'}]}}));
 assert.throws(()=>store.save({config:{...config,baseURL:'http://example.test'},auth:{roleCredentials:[{name:'editor',rest:{username:'x',password:'y'}}]}}),/HTTPS/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('UI cannot replace trusted adapter registry',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-adapters-'));try{const store=new ProjectStore(dir);const id=store.save({config:{...config,trustedAdapters:{evil:'C:/evil.mjs'}}});assert.deepEqual(store.context(id).config.trustedAdapters,{});}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('verified browser credentials cannot be saved to another role',()=>{
 const login=new BrowserLogin();login.session={id:'session',phase:'verified',baseURL:config.baseURL,projectId:null,role:'editor',state:{cookies:[],origins:[]}};
 assert.equal(login.status().role,'editor');assert.throws(()=>login.save('session',{baseURL:config.baseURL,role:'author'},()=>{}),/一致/);let saved=false;login.save('session',{baseURL:config.baseURL,role:'editor'},()=>{saved=true;});assert(saved);
});


