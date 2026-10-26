import fs from 'node:fs';import path from 'node:path';import {writeReport} from './lib/results.mjs';import {loadConfig,catalog} from './lib/config.mjs';
const base=path.resolve('../../debug-evidence/mannendo-staging'),root=path.join(base,'runs'),ctx=loadConfig(path.join(base,'site.json'));
const runs=fs.readdirSync(root).filter(d=>d>='2026-10-23T08-32'&&!d.endsWith('linked-summary')).sort().flatMap(d=>{try{const r=JSON.parse(fs.readFileSync(path.join(root,d,'results.json')));return r.runStatus==='finished'?[r]:[];}catch{return[];}});
const latest=runs.at(-1);if(latest.configHash!==ctx.configHash)throw Error('Latest run must match config');
const source='2026-10-23T05-57-42-899Z-3cb87f5c',obs=JSON.parse(fs.readFileSync(path.join(base,'coverage-evidence/admin-observations.json')));
const submitted=JSON.parse(fs.readFileSync(path.join(root,source,'results.json')));
if(obs.order.id!==1036||obs.order.amount!==1466||obs.order.status!=='キャンセル'||!obs.order.token.includes(source)||obs.contact.id!==2593||obs.contact.serverStatus!=='mail_sent'||!obs.contact.token.includes(source))throw Error('Historical observation correlation failed');
const baseURL='http://127.0.0.1:4310',project='b1036ad97b52';const boot=await(await fetch(baseURL+'/api/bootstrap')).json();
const reviews=[
 ['coverage-order-record','pass','10月23日の受注1036を識別子・銀行振込・金額1466円で照合。実施済み注文の証拠レビュー。新規注文の再実行ではない。','order-1036-cancelled.png'],
 ['coverage-order-cleanup','pass','10月23日に受注1036をキャンセル。注文一覧と開き直した詳細で確認済み。後続注文には流用しない。','order-1036-cancelled.png'],
 ['contact-mail-config-review','fail','10月23日のCF7設定実査で送信元ドメイン不一致2件と防御不足1件。未着を確認した意味ではない。','contact-mail-settings.png'],
 ['contact-storage-review','fail','10月23日のFlamingo2593は本文保存済みだが、件名[your-subject]と送信者[your-name] <[your-email]>が未展開。','contact-stored-2593.png']
];
for(const [id,j]of [['coverage-contact-success','contact-operation'],['order-completed-evidence','bank-operation']]){const row=submitted.rows.find(r=>r.id==='journey.'+j);if(row?.status!=='pass'||!row.reason.includes('完了画面確認済み'))throw Error('Submitted evidence missing');reviews.push([id,'pass',`10月23日の送信実行${source}の${row.id}を照合。${row.reason} 現在の送信やメール到達の合格とは扱わない。`,j==='bank-operation'?'order-1036-cancelled.png':'contact-stored-2593.png']);}
const navIds=['search-product','search-empty','search-special','menu','menu-navigation'].map(id=>'journey.coverage-'+id);
const navSources=navIds.map(id=>{for(const run of [...runs].reverse()){const row=run.rows.find(r=>r.id===id&&r.selected);if(row)return {id,status:row.status,run:run.runId};}return {id,status:'not_run'};});
if(navSources.every(r=>r.status==='pass'&&r.run.startsWith('2026-10-26')))reviews.push(['coverage-navigation','pass','10月26日の再検査を照合。商品検索・該当なし・特殊文字・メニュー開閉・問い合わせへの遷移すべて合格。採用元: '+JSON.stringify(navSources),'coverage-links.json']);
for(const [id,outcome,notes,png]of reviews){
 const evidence=[path.join(base,'coverage-evidence',png),...(id==='coverage-navigation'?navSources.map(r=>baseURL+`/api/projects/${project}/runs/${r.run}/files?path=report.html`):[path.join(base,'coverage-evidence/admin-observations.json')])];
 if(id==='coverage-contact-success'||id==='order-completed-evidence')evidence.push(baseURL+`/api/projects/${project}/runs/${source}/files?path=report.html`);
 const response=await fetch(baseURL+`/api/projects/${project}/runs/${latest.runId}/review`,{method:'POST',headers:{'Content-Type':'application/json','Origin':baseURL,'X-QA-Token':boot.token},body:JSON.stringify({rowId:'check.'+id,outcome,reviewer:'Codex（10月23日実査・保存証拠を10月26日に照合）',notes,evidence})});if(!response.ok)throw Error(await response.text());
}
// Aggregate without modifying any source verdict. The UI run explicitly records provenance.
const updated=JSON.parse(fs.readFileSync(path.join(root,latest.runId,'results.json')));runs[runs.length-1]=updated;
const map=new Map(catalog(ctx.config).map(r=>[r.id,{...r,selected:false}]));
for(const r of runs)for(const row of r.rows)if(map.has(row.id)&&(row.selected||row.review))map.set(row.id,{...row,sourceRunId:r.runId});
const id=new Date().toISOString().replace(/[:.]/g,'-')+'-linked-summary',dir=path.join(root,id);fs.mkdirSync(dir,{recursive:true});
const rows=[...map.values()];for(const row of rows){
 const src=row.sourceRunId;row.active=false;row.reason=`【${src?'採用元 '+src:'未実施'}】\n`+(row.reason??'');
 const check=ctx.config.checks.find(c=>'check.'+c.id===row.id);if(check&&row.status==='blocked')row.reason+='\n【整備後の残課題】'+(check.options.instructions??'');
 row.evidence=(row.evidence??[]).filter(f=>src&&fs.existsSync(path.join(root,src,f))).map(f=>{const dest=path.join('sources',src,f);fs.mkdirSync(path.dirname(path.join(dir,dest)),{recursive:true});fs.copyFileSync(path.join(root,src,f),path.join(dir,dest));return dest.split(path.sep).join('/');});
 row.selected=false;
}
for(const f of ['coverage-links.json','admin-observations.json','order-1036-cancelled.png','contact-stored-2593.png','contact-mail-settings.png','robots-observation.json']){fs.copyFileSync(path.join(base,'coverage-evidence',f),path.join(dir,f));}
const robot=rows.find(r=>r.id==='check.staging-robots-disallow');robot.evidence.push('robots-observation.json');robot.reason+='\n実測: Disallow: /wp-admin/ のみ。管理画面の検索非公開方針との整合性を確認し、SEO/robots設定または静的robots.txtを修正する。閲覧パスワード保護があるため公開・検索掲載済みとは断定しない。';
for(const row of rows.filter(r=>r.id.startsWith('check.')))row.evidence=[...new Set([...row.evidence,'coverage-links.json'])];
for(const [caseId,,,png]of reviews){const row=rows.find(r=>r.id==='check.'+caseId);row.evidence.push('admin-observations.json',png);}
const result={...updated,name:'万年堂：実行結果と実査証拠の統合（新たな全件実行ではありません）',runId:id,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),runtime:'証拠統合。各項目の採用元runを参照。手動レビューは確認日を明記。',rows,errors:[],runStatus:'finished',aggregation:{sourceRuns:runs.map(r=>r.runId),createdAt:new Date().toISOString(),notAFreshRun:true}};
writeReport(dir,result);console.log(JSON.stringify({runId:id,summary:result.summary,url:baseURL+`/api/projects/${project}/runs/${id}/files?path=report.html`}));
