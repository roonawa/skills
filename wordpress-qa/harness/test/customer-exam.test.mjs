import test from 'node:test';
import assert from 'node:assert/strict';
import {collectExamEvidence} from '../lib/exam-evidence.mjs';
import {buildExam,validateExamItems,customerExamHtml,customerImageWarnings} from '../lib/site-exam.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bKcAAAAASUVORK5CYII=','base64');
const report={runId:'r',baseURL:'https://site.test',configHash:'h',rows:[{id:'snapshot.home',title:'フォームの入力欄',status:'fail',evidence:['axe.json','marked-screenshots.json','marked-demo.png'],failures:[{key:'axe:label',title:'入力欄の説明が不足しています',impact:'読み上げ利用者が入力内容を判断できません。',admin:'フォーム編集で項目名を関連付けてください。'}]}]};
function fixture(){const files={'axe.json':Buffer.from('{"finding":"label"}'),'marked-screenshots.json':Buffer.from(JSON.stringify({shots:[{id:'marked-demo',status:'captured',rule:'label'}]})),'marked-demo.png':png};const collect=()=>collectExamEvidence(report,f=>{if(!files[f])throw Error('missing');return files[f];});return {files,collect};}
function evaluation(exam){const g=exam.issues[0];return {id:g.id,scores:[3,4,2],certainty:'confirmed',reviewed:true,source:'manual',summary:'入力欄の名前が読み上げられず、何を入力する欄か分からない',impact:g.impact,action:g.action,reasons:['入力する情報を判別できず、対象利用者が主要な問い合わせ操作を完了できないため。','認証せず問い合わせ画面を開き、通常のキーボード操作で現象を再現できたため。','今回確認した影響は問い合わせフォームの導線に限られ、他ページへの波及は未確認のため。'],proofs:[0,1,2].map(()=>({file:'axe.json',observation:'入力欄をTabキーで選択すると項目名の読み上げがなく、用途を判別できないことを確認した。'})),steps:['問い合わせページを開く。','Tabキーで対象の入力欄へ移動し、読み上げ内容を確認する。'],expected:'入力欄を選択したとき、その欄に入力する情報の名前が読み上げられる。',observed:'入力欄を選択しても項目名の読み上げがなく、入力内容の用途を特定できなかった。',reproductionVerified:true,imageFiles:['marked-demo.png'],imagesReviewed:true};}
test('confirmed evaluation needs readable evidence, substantive per-axis reasoning, observations and verified reproduction',()=>{
 const {collect}=fixture(),exam=buildExam(collect().report),valid=evaluation(exam);assert.equal(validateExamItems([valid],exam).length,1);
 for(const change of [{reasons:['[snapshot.home]','[snapshot.home]','[snapshot.home]']},{reproductionVerified:false},{reviewed:false},{proofs:valid.proofs.map(p=>({...p,file:'absent.json'}))},{proofs:valid.proofs.map(p=>({...p,observation:'未確認'}))},{steps:[]},{imagesReviewed:false},{imageFiles:['unregistered.png']}])assert.throws(()=>validateExamItems([{...valid,...change}],exam));
});
test('changed or removed evidence invalidates saved scores even if filenames and results are unchanged',()=>{
 const {files,collect}=fixture(),first=buildExam(collect().report),saved={fingerprint:first.fingerprint,items:validateExamItems([evaluation(first)],first),savedAt:'now'};
 files['axe.json']=Buffer.from('{"finding":"changed"}');assert.equal(buildExam(collect().report,saved).stale,true);
 delete files['axe.json'];const missing=buildExam(collect().report);assert.throws(()=>validateExamItems([evaluation(missing)],missing));
});
test('customer HTML embeds approved marked images and separates provisional from confirmed evaluations',()=>{
 const {collect}=fixture(),bundle=collect(),exam=buildExam(bundle.report),item=evaluation(exam);const saved={fingerprint:exam.fingerprint,items:validateExamItems([item],exam),savedAt:'now'};
 const html=customerExamHtml(bundle.report,buildExam(bundle.report,saved),bundle.image);assert(html.includes('data:image/png;base64,'));assert(html.includes('問題箇所'));assert(!html.includes('再現・確認手順'));assert(!html.includes('対応方法'));assert(!html.includes('専門的な評価基準'));assert(!html.includes('未確認の項目'));assert(html.includes('確定評価'));assert(!html.includes('下書き・暫定版'));
 saved.items[0].certainty='provisional';const draft=customerExamHtml(bundle.report,buildExam(bundle.report,saved),bundle.image);assert(draft.includes('下書き・暫定版'));assert(draft.includes('暫定評価（未確定）'));assert(draft.includes('35 / 100'));
 saved.items[0].imageFiles=[];assert(!customerExamHtml(bundle.report,buildExam(bundle.report,saved),bundle.image).includes('data:image/png;base64,'));
});
test('malformed and unrelated image manifests are not exposed as evidence for the issue',()=>{
 const {files,collect}=fixture();files['marked-demo.png']=Buffer.from('<svg onload="alert(1)">');assert.equal(buildExam(collect().report).issues[0].cases[0].images.length,0);
 files['marked-demo.png']=png;files['marked-screenshots.json']=Buffer.from(JSON.stringify({shots:[{id:'marked-demo',status:'captured',rule:'unrelated'}]}));assert.equal(buildExam(collect().report).issues[0].cases[0].images.length,0);
});

test('customer image preflight reports missing and oversized images without changing scores',()=>{
 const exam={issues:[{id:'a',title:'対象',score:15,imageFiles:['missing','large','good']}]};
 const warnings=customerImageWarnings(exam,f=>f==='missing'?null:f==='large'?'data:image/png;base64,'+'A'.repeat(24*1024*1024):'data:image/png;base64,AAAA');
 assert.equal(warnings.length,2);assert(warnings[0].message.includes('読み込めません'));assert(warnings[1].message.includes('容量'));assert.equal(exam.issues[0].score,15);
});
