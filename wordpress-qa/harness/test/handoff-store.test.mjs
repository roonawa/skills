import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {handoffDir,newHandoffId,saveHandoff,latestHandoff} from '../lib/handoff-store.mjs';
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'handoff-'));
const rec=(id,n,extra={})=>({handoffId:id,createdAt:new Date(Date.UTC(2026,0,1,0,0,n)).toISOString(),actor:'a',sourceRunId:'run-1',sourceFinishedAt:'2026-01-01T00:00:00Z',siteName:'S',issues:[],excludedKeys:[],...extra});
const idN=n=>'h-abc-'+n.toString(16).padStart(8,'0');
test('handoffDir is sibling of output dir and named after it',()=>{assert.equal(handoffDir(path.join('x','y','output')),path.join('x','y','handoffs-output'));assert.notEqual(handoffDir(path.join('x','a')),handoffDir(path.join('x','b')));});
test('newHandoffId matches format',()=>assert.match(newHandoffId(),/^h-[a-z0-9]+-[a-f0-9]{8}$/));
test('save and latest round trip',()=>{
  const d=path.join(tmp(),'handoffs');
  assert.equal(latestHandoff(d),null);
  saveHandoff(d,rec(idN(1),1));saveHandoff(d,rec(idN(2),2,{siteName:'新'}));
  assert.equal(latestHandoff(d).siteName,'新');
  assert.deepEqual(fs.readdirSync(d).sort(),[idN(1)+'.json',idN(2)+'.json']);
});
test('same id overwrites without consuming the 20 limit',()=>{
  const d=path.join(tmp(),'handoffs');
  for(let i=0;i<5;i++)saveHandoff(d,rec(idN(1),1,{actor:'v'+i}));
  assert.equal(fs.readdirSync(d).length,1);
  assert.equal(latestHandoff(d).actor,'v4');
});
test('keeps newest 20',()=>{
  const d=path.join(tmp(),'handoffs');
  for(let i=0;i<25;i++)saveHandoff(d,rec(idN(i),i));
  const files=fs.readdirSync(d);
  assert.equal(files.length,20);
  for(let i=0;i<5;i++)assert.ok(!files.includes(idN(i)+'.json'));
  assert.ok(files.includes(idN(5)+'.json'));
});
test('rejects bad id and symlinked dir',()=>{
  const base=tmp(),d=path.join(base,'handoffs');
  assert.throws(()=>saveHandoff(d,rec('../evil',1)),/引き継ぎID/);
  assert.throws(()=>saveHandoff(d,rec('h-ABC-12345678',1)),/引き継ぎID/);
  const real=path.join(base,'real');fs.mkdirSync(real);
  const link=path.join(base,'link');
  try{fs.symlinkSync(real,link,'junction');}catch{return;}
  assert.throws(()=>saveHandoff(link,rec(idN(1),1)),/シンボリックリンク/);
  assert.equal(fs.readdirSync(real).length,0);
});
test('rejects symlinked record file',()=>{
  const base=tmp(),d=path.join(base,'handoffs');fs.mkdirSync(d);
  const target=path.join(base,'t.json');fs.writeFileSync(target,'{}');
  try{fs.symlinkSync(target,path.join(d,idN(1)+'.json'),'file');}catch{return;}
  assert.throws(()=>saveHandoff(d,rec(idN(1),1)),/シンボリックリンク/);
  assert.equal(fs.readFileSync(target,'utf8'),'{}');
});
test('corrupt file is ignored by latestHandoff',()=>{
  const d=path.join(tmp(),'handoffs');
  saveHandoff(d,rec(idN(1),1));
  fs.writeFileSync(path.join(d,idN(2)+'.json'),'{bad');
  fs.writeFileSync(path.join(d,idN(3)+'.json'),'{"createdAt":"2099-01-01T00:00:00Z"}');
  assert.equal(latestHandoff(d).handoffId,idN(1));
});
