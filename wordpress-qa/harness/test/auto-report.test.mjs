import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {autoReport} from '../lib/auto-report.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wpqa-auto-report-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dir=path.join(root,'run');fs.mkdirSync(dir);
  const write=(file,data)=>{const target=path.join(dir,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.isBuffer(data)?data:JSON.stringify(data));};
  const report={runId:'current',name:'Fixture',baseURL:'https://example.test',environment:'test',configHash:'hash',startedAt:'2026-01-01',finishedAt:'2026-01-02',runStatus:'finished',rows:[{id:'javascript.home-pc',title:'Home',status:'fail',evidence:['artifacts/javascript-one.json','artifacts/screen.png']}]};
  const context={configHash:'hash',config:{pages:[{id:'home',path:'/home'}],visuals:[{id:'home-pc',pageId:'home',width:1280,height:900}]},report:{rows:[]}};
  write('results.json',report);write('context.json',context);
  write('artifacts/javascript-one.json',{jsErrors:[{message:'fixture exception'}]});write('artifacts/screen.png',png);
  return {root,dir,write,report,context};
}

test('writes a current-only report with registered supporting PNG and saved reproduction config',async t=>{
  const f=fixture(t),before=fs.readFileSync(path.join(f.dir,'results.json'));
  const result=await autoReport(f.dir);
  assert.equal(result.file,'issue-report.html');assert.equal(result.issueCount,1);assert.equal(result.failedCases,1);
  assert.deepEqual(result.warnings,[]);
  const html=fs.readFileSync(path.join(f.dir,result.file),'utf8');
  assert.match(html,/fixture exception/);assert.match(html,/https:\/\/example.test\/home/);assert.match(html,/1280px × 900px/);
  assert.ok(html.includes(`data:image/png;base64,${png.toString('base64')}`));
  assert.match(html,/過去結果は補っていません/);
  assert.deepEqual(fs.readFileSync(path.join(f.dir,'results.json')),before);
});

for(const state of [{runStatus:'running'},{runStatus:'interrupted'},{finishedAt:null},{rows:[{active:true}]}]){
  test(`rejects unfinished run ${JSON.stringify(state)}`,async t=>{
    const f=fixture(t);f.write('results.json',{...f.report,...state});
    await assert.rejects(async()=>autoReport(f.dir),/finished/i);
    assert.equal(fs.existsSync(path.join(f.dir,'issue-report.html')),false);
  });
}

for(const file of ['../outside.json','artifacts/../../outside.png','artifacts\\..\\outside.json','C:\\outside.json','/outside.json','artifacts/image.png:secret']){
  test(`rejects registered unsafe path ${file}`,async t=>{
    const f=fixture(t);f.report.rows[0].evidence.push(file);f.write('results.json',f.report);
    await assert.rejects(async()=>autoReport(f.dir),/path/i);
    assert.equal(fs.existsSync(path.join(f.dir,'issue-report.html')),false);
  });
}

test('does not embed an unregistered image referenced by a screenshot manifest',async t=>{
  const f=fixture(t);
  f.report.rows[0]={id:'axe.home',title:'Home',status:'fail',evidence:['axe.json','marked-screenshots.json']};
  f.write('results.json',f.report);
  f.write('axe.json',{violations:[{id:'link-name',nodes:[{target:['#link']}]}]});
  f.write('marked-screenshots.json',{shots:[{id:'hidden',rule:'link-name',target:['#link'],status:'captured'}]});
  f.write('hidden.png',png);
  await autoReport(f.dir);
  assert.doesNotMatch(fs.readFileSync(path.join(f.dir,'issue-report.html'),'utf8'),/data:image/);
});

test('embeds registered marked screenshots matching the issue selector',async t=>{
  const f=fixture(t);
  f.report.rows[0]={id:'axe.home',title:'Home',status:'fail',evidence:['axe.json','marked-screenshots.json','marked-001.png']};
  f.write('results.json',f.report);
  f.write('axe.json',{violations:[{id:'link-name',nodes:[{target:['#link']}]}]});
  f.write('marked-screenshots.json',{shots:[{id:'marked-001',number:1,rule:'link-name',target:['#link'],status:'captured'}]});
  f.write('marked-001.png',png);
  await autoReport(f.dir);
  const html=fs.readFileSync(path.join(f.dir,'issue-report.html'),'utf8');
  assert.ok(html.includes(`data:image/png;base64,${png.toString('base64')}`));
  assert.match(html,/赤枠・番号1/);
});

test('missing evidence produces builder warnings and invalid PNG is not embedded',async t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.dir,'artifacts/javascript-one.json'));f.write('artifacts/screen.png',Buffer.from('not png'));
  const result=await autoReport(f.dir);assert.equal(result.warnings.length,1);
  assert.doesNotMatch(fs.readFileSync(path.join(f.dir,'issue-report.html'),'utf8'),/data:image/);
});

test('rejects a mismatched saved config',async t=>{
  const f=fixture(t);f.write('context.json',{...f.context,configHash:'other'});
  await assert.rejects(async()=>autoReport(f.dir),/config mismatch/i);
});

test('rejects oversized JSON before parsing',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.dir,'results.json'),Buffer.alloc(16*1024*1024+1,32));
  await assert.rejects(async()=>autoReport(f.dir),/too large/i);
});

test('oversized registered PNG is not embedded',async t=>{
  const f=fixture(t),large=Buffer.alloc(12*1024*1024+1);png.copy(large);f.write('artifacts/screen.png',large);
  await autoReport(f.dir);
  assert.doesNotMatch(fs.readFileSync(path.join(f.dir,'issue-report.html'),'utf8'),/data:image/);
});

test('rejects directory links that escape the run',async t=>{
  const f=fixture(t),outside=path.join(f.root,'outside');fs.mkdirSync(outside);
  try{fs.symlinkSync(outside,path.join(f.dir,'escape'),process.platform==='win32'?'junction':'dir');}
  catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip(`Link creation unavailable: ${error.code}`);return;}throw error;}
  f.report.rows[0].evidence.push('escape/axe.json');f.write('results.json',f.report);
  await assert.rejects(async()=>autoReport(f.dir),/path/i);
});
