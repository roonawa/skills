import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {journalIntent,readJournal,recover} from '../lib/recovery.mjs';
test('lost create response recovery requires unique marker, site and owner',async()=>{
 const runDir=await mkdtemp(path.join(os.tmpdir(),'wpqa-recover-'));const marker='wpqa-12345678-1234-1234-1234-123456789abc';let deletes=0,author=2;
 process.env.RECOVERY_TEST_HEADERS='{"Authorization":"fixture"}';
 const args={runDir,config:{baseURL:'https://fixture.test',environment:'staging',allowTestWrites:true},headersEnv:'RECOVERY_TEST_HEADERS',requestFactory:{newContext:async()=>({dispose:async()=>{},fetch:async(url,{method})=>({status:()=>200,json:async()=>{if(url.includes('/users/me'))return {id:1};if(method==='DELETE'){deletes++;return {deleted:true};}return [{id:17,slug:marker,author}];}})})}};
 try{await journalIntent(runDir,{marker,site:'https://fixture.test',rest:'/wp-json/wp/v2',collection:'/wp-json/wp/v2/posts',owner:1});assert.equal((await recover(args)).pending,1);assert.equal(deletes,0);author=1;assert.equal((await recover(args)).recovered,1);assert.equal(deletes,1);assert.equal((await readJournal(runDir))[0].state,'deleted');}finally{await rm(runDir,{recursive:true,force:true});}
});
test('recovery resolves per-entry credentials and keeps missing credentials pending',async()=>{
 const runDir=await mkdtemp(path.join(os.tmpdir(),'wpqa-custom-'));const seen=[],deleted=[];
 const entries=[{marker:'wpqa-12345678-1234-1234-1234-123456789ab1',owner:11,headersEnv:'WPQA_CUSTOM_RECOVERY_HEADERS'},{marker:'wpqa-12345678-1234-1234-1234-123456789ab2',owner:12},{marker:'wpqa-12345678-1234-1234-1234-123456789ab3',owner:13,headersEnv:'WPQA_MISSING_RECOVERY_HEADERS'}];
 const saved=process.env.WPQA_UI_ADMIN_HEADERS;process.env.WPQA_CUSTOM_RECOVERY_HEADERS=JSON.stringify({Authorization:'custom-secret'});process.env.WPQA_UI_ADMIN_HEADERS=JSON.stringify({Authorization:'legacy-secret'});delete process.env.WPQA_MISSING_RECOVERY_HEADERS;
 const requestFactory={newContext:async({extraHTTPHeaders})=>{const owner=extraHTTPHeaders.Authorization==='custom-secret'?11:12;seen.push(owner);return {dispose:async()=>{},fetch:async(url,{method})=>({status:()=>200,json:async()=>{if(url.includes('/users/me'))return {id:owner};if(method==='DELETE'){deleted.push(owner);return {deleted:true};}return [{id:owner,author:owner,slug:new URL(url).searchParams.get('slug')}];}})};}};
 try{for(const e of entries)await journalIntent(runDir,{...e,site:'https://fixture.test',rest:'/wp-json/wp/v2',collection:'/wp-json/wp/v2/posts'});const result=await recover({runDir,config:{baseURL:'https://fixture.test',environment:'staging',allowTestWrites:true},requestFactory});assert.deepEqual(result,{recovered:2,pending:1});assert.deepEqual(seen,[11,12]);assert.deepEqual(deleted,[11,12]);assert(!JSON.stringify(await readJournal(runDir)).includes('secret'));}finally{await rm(runDir,{recursive:true,force:true});delete process.env.WPQA_CUSTOM_RECOVERY_HEADERS;if(saved===undefined)delete process.env.WPQA_UI_ADMIN_HEADERS;else process.env.WPQA_UI_ADMIN_HEADERS=saved;}
});
test('interrupted owner reassignment permits only journaled old or planned owner',async()=>{
 const runDir=await mkdtemp(path.join(os.tmpdir(),'wpqa-owner-')),marker='wpqa-12345678-1234-1234-1234-123456789ab4';let author=3,deletes=0;
 process.env.RECOVERY_TRANSITION_HEADERS='{"Authorization":"fixture"}';
 const args={runDir,headersEnv:'RECOVERY_TRANSITION_HEADERS',config:{baseURL:'https://fixture.test',environment:'staging',allowTestWrites:true},requestFactory:{newContext:async()=>({dispose:async()=>{},fetch:async(url,{method})=>({status:()=>200,json:async()=>{if(url.includes('/users/me'))return {id:1};if(method==='DELETE'){deletes++;return {deleted:true};}return [{id:22,author,slug:marker}];}})})}};
 try{await journalIntent(runDir,{marker,id:22,owner:1,plannedOwner:2,credentialOwner:1,site:'https://fixture.test',rest:'/wp-json/wp/v2',collection:'/wp-json/wp/v2/posts'});assert.equal((await recover(args)).pending,1);assert.equal(deletes,0);author=2;assert.equal((await recover(args)).recovered,1);assert.equal(deletes,1);}finally{await rm(runDir,{recursive:true,force:true});delete process.env.RECOVERY_TRANSITION_HEADERS;}
});
