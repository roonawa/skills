import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {buildDesignerReport} from '../lib/designer-report.mjs';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const run=(rows,extra={})=>({runId:'now',name:'Fixture',baseURL:'https://example.test',environment:'staging',configHash:'same',startedAt:'2026-02-01',finishedAt:'2026-02-01',runStatus:'finished',rows,...extra});
const row=(id,status='fail',extra={})=>({id,title:id,status,evidence:[],...extra});
const node=(target,html='<input type="text">')=>({target:[target],html,failureSummary:'保存済みの測定結果'});
const axe=violations=>({url:'https://example.test/form?view=one',testEnvironment:{windowWidth:390,windowHeight:844},violations});

test('non-design failures have distinct admin-first instructions, limits and verification',()=>{
  const current=run([
    row('page.category','fail',{reason:'canonical mismatch'}),
    row('policy.soft-404','fail',{reason:'HTTP 302 not in 404'}),
    row('journey.gap-network-failure','fail',{reason:'submitting'}),
    row('check.contact-mail-config-review','fail',{reason:'送信元ドメイン不一致'}),
    row('check.contact-storage-review','fail',{reason:'Flamingo 件名未展開'}),
    row('check.staging-robots-disallow','fail',{reason:'robots rule missing'})
  ]);
  const result=buildDesignerReport({current});const $=load(result.html);
  assert.equal(result.failedCases,6);assert.equal($('article.handoff-issue').length,6);
  for(const article of $('article.handoff-issue').toArray()){
    assert.ok($(article).find('li').length>=3);
    assert.match($(article).text(),/担当：/);assert.match($(article).text(),/修正完了の確認/);
    assert.match($(article).text(),/再検査は実施していません/);
  }
  assert.match($.text(),/flamingo_email/);assert.match($.text(),/その他の設定/);
  assert.match($.text(),/本文が保存されている場合/);assert.match($.text(),/未着.*確認した結果ではありません/);
  assert.match($.text(),/これだけで今回のrobots検査が合格するとは限らない/);
  assert.match($.text(),/閲覧認証への転送/);assert.match($.text(),/文言変更だけでは修正不可/);
  assert.equal($('a[href="https://contactform7.com/save-submitted-messages-with-flamingo/"]').length,1);
  const unrelated=buildDesignerReport({current:run([row('check.unknown','fail',{reason:'unknown failure'})])});
  assert.doesNotMatch(unrelated.html,/flamingo_email/);
});

test('groups four axe rules, splits evidenced form/quantity labels and derives counts',()=>{
  const rows=['pc','sp'].map(id=>row('axe.'+id,'fail',{evidence:['axe.json']}));
  const data=axe([
    {id:'color-contrast',nodes:[{...node('.caption','<p>Caption</p>'),any:[{data:{fgColor:'#aaa',bgColor:'#fff',contrastRatio:2.3,expectedContrastRatio:'4.5:1'}}]}]},
    {id:'label-content-name-mismatch',nodes:[node('#action','<button aria-label="Other">Visible</button>')]},
    {id:'label',nodes:[node('#email','<input type="email" name="email">'),node('#qty','<input type="number" name="quantity">'),node('#other','<input type="number" name="unknown">')]},
    {id:'link-name',nodes:[node('#link','<a href="/next"></a>')]}
  ]);
  const result=buildDesignerReport({current:run(rows),readEvidence:()=>data});
  assert.equal(result.issueCount,6);assert.equal(result.failedCases,2);assert.equal(result.counts.fail,2);
  const $=load(result.html);assert.equal($('article.design-issue').length,6);
  assert.match($.text(),/フォーム入力/);assert.match($.text(),/数量入力/);assert.match($.text(),/用途未特定/);
  assert.match($.text(),/2.3/);assert.match($.text(),/4.5:1/);assert.match($.text(),/390px/);
  assert.equal($('a[href="https://example.test/form?view=one"]').length>0,true);
  assert.match($.text(),/axe.pc/);assert.match($.text(),/axe.sp/);assert.match($.text(),/管理画面/);
  assert.doesNotMatch(result.html,/<input|<button aria-label/);
});

test('history selects only compatible older finished runs and reads their config and evidence',()=>{
  const current=run([row('axe.pc','not_run'),row('layout.pc','pass'),row('snapshot.pc','review')]);
  const old=run([row('axe.pc','fail',{evidence:['axe.json']})],{runId:'old',startedAt:'2026-01-01',finishedAt:'2026-01-01'});
  const bad={...old,runId:'wrong',configHash:'different',startedAt:'2026-01-31'};
  const future={...old,runId:'future',startedAt:'2026-03-01'};
  const reads=[];
  const result=buildDesignerReport({current,previous:[bad,future,old],includeHistory:true,
    readEvidence:(id)=>{reads.push(id);return {violations:[{id:'link-name',nodes:[node('#old')]}]};},
    readConfig:(id)=>{assert.equal(id,'old');return {pages:[{id:'guide',path:'/old-guide'}],visuals:[{id:'pc',pageId:'guide',width:1280,height:900}]};}
  });
  assert.deepEqual(reads,['old']);assert.equal(result.counts.fail,1);assert.equal(result.counts.review,1);assert.equal(result.counts.pass,1);
  assert.match(result.html,/https:\/\/example.test\/old-guide/);assert.match(result.html,/1280px/);assert.match(result.html,/過去結果/);
  assert.match(result.html,/2026-01-01/);assert.equal(current.rows[0].status,'not_run');
  const currentOnly=buildDesignerReport({current,previous:[old],readEvidence:()=>{throw Error('must not read');}});
  assert.equal(currentOnly.issueCount,0);assert.equal(currentOnly.counts.not_run,1);
});

test('embeds matching registered images once, preserves unavailable reasons and never reads manifest paths',()=>{
  const current=run([row('axe.pc','fail',{evidence:['axe.json','marked-screenshots.json','marked-1-hash.png','marked-2-hash.png']})]);
  const reads=[];
  const result=buildDesignerReport({current,readEvidence:(_id,file)=>file==='axe.json'?axe([{id:'link-name',nodes:[node('#one'),node('#hidden'),node('#missing')]}]):{shots:[
    {id:'marked-1',number:1,rule:'link-name',target:['#one'],status:'captured',url:'https://example.test/form',viewport:{width:390,height:844},capturedAt:'2026-01-01'},
    {id:'marked-2',number:2,rule:'link-name',target:['#other'],status:'captured'},
    {id:'hidden',rule:'link-name',target:['#hidden'],status:'unavailable',reason:'対象要素が非表示です'},
    {id:'../../private',file:'../../secret.png',rule:'link-name',target:['#missing'],status:'captured'}
  ]},readImage:(_id,file)=>{reads.push(file);return png;}});
  assert.deepEqual(reads,['marked-1-hash.png']);
  const $=load(result.html);assert.equal($('img').length,1);assert.equal($('img').attr('src'),png);
  assert.match($.text(),/代表画像/);assert.match($.text(),/対象要素が非表示です/);assert.match($.text(),/画像.*未登録|対応.*画像.*なし/);
  assert.doesNotMatch(result.html,/secret\.png|\.\.\/private/);
});

test('bounds image reads and rejects unsafe image data without failing the report',()=>{
  const rows=Array.from({length:40},(_,i)=>row('snapshot.case-'+i,'fail',{evidence:[`images/case-${i}.png`]}));
  let reads=0;
  const result=buildDesignerReport({current:run(rows),readImage:()=>{reads++;return png;}});
  assert.equal(result.failedCases,40);assert.ok(reads<=32);assert.ok(result.warnings.length>0);
  const unsafe=buildDesignerReport({current:run([row('layout.pc','fail',{evidence:['screen.png']})]),readImage:()=>png+'" onerror="alert(1)'});
  assert.equal(load(unsafe.html)('img').length,0);assert.ok(unsafe.warnings.length>0);
});

test('allocates representatives across groups before a second case and explicitly omits remaining images',()=>{
  const rows=[],evidence=new Map(),reads=[],manifestReads=[];
  const groups=[['contrast','color-contrast','<p>Text</p>',40],['form','label','<input type="email">',3],['quantity','label','<input name="quantity" type="number">',3],['mismatch','label-content-name-mismatch','<button>Text</button>',3],['link','link-name','<a></a>',3]];
  for(const [group,rule,html,count] of groups)for(let i=0;i<count;i++){
    const prefix=`${group}-${i}`,target=`#${prefix}`;
    rows.push(row('axe.'+prefix,'fail',{evidence:[`${prefix}/axe.json`,`${prefix}/marked-screenshots.json`,`${prefix}/marked-001.png`]}));
    evidence.set(`${prefix}/axe.json`,axe([{id:rule,nodes:[node(target,html)]}]));
    evidence.set(`${prefix}/marked-screenshots.json`,{shots:[{id:'marked-001',number:1,rule,target:[target],status:'captured'}]});
  }
  const result=buildDesignerReport({current:run(rows),readEvidence:(_id,file)=>{if(file.endsWith('marked-screenshots.json'))manifestReads.push(file);return evidence.get(file);},readImage:(_id,file)=>{reads.push(file);return png;}});
  assert.equal(result.issueCount,5);assert.equal(result.failedCases,52);
  assert.deepEqual(reads.slice(0,5),groups.map(([group])=>`${group}-0/marked-001.png`));
  assert.equal(reads.length,10);assert.equal(manifestReads.length,10);
  const $=load(result.html);
  for(const article of $('article.design-issue').toArray())assert.equal($(article).find('img').length,2);
  const omitted=$('details.case').filter((_,el)=>$(el).find('summary').text().includes('axe.contrast-2')).first();
  assert.match(omitted.text(),/代表画像を参照（個別画像は省略）/);
  assert.doesNotMatch(omitted.text(),/画像は未取得/);
  assert.equal($(omitted.find('a').filter((_,el)=>$(el).text().includes('代表画像')).attr('href')).is('figure'),true);
});

test('failed image candidates cannot consume every later group budget',()=>{
  const contrastNodes=Array.from({length:40},(_,i)=>node('#c'+i,'<p>Text</p>'));
  const current=run([row('axe.contrast','fail',{evidence:['contrast/axe.json','contrast/marked-screenshots.json',...contrastNodes.map((_,i)=>`contrast/marked-${i}.png`)]}),row('axe.label','fail',{evidence:['label/axe.json','label/marked-screenshots.json','label/marked-001.png']})]);
  const reads=[];
  const result=buildDesignerReport({current,readEvidence:(_id,file)=>file==='contrast/axe.json'?axe([{id:'color-contrast',nodes:contrastNodes}]):file==='contrast/marked-screenshots.json'?{shots:contrastNodes.map((n,i)=>({id:'marked-'+i,rule:'color-contrast',target:n.target,status:'captured'}))}:file==='label/axe.json'?axe([{id:'label',nodes:[node('#email','<input type="email">')]}]):{shots:[{id:'marked-001',rule:'label',target:['#email'],status:'captured'}]},readImage:(_id,file)=>{reads.push(file);return file.startsWith('contrast/')?'invalid':png;}});
  assert.deepEqual(reads,['contrast/marked-0.png','label/marked-001.png']);
  assert.equal(load(result.html)('article.design-issue').last().find('img').length,1);
});

test('supports root marked-001.png and preserves public /home URLs in reproduction',()=>{
  const calls=[];
  const result=buildDesignerReport({current:run([row('axe.pc','fail',{evidence:['axe.json','marked-screenshots.json','marked-001.png']})]),
    readEvidence:(_id,file)=>file==='axe.json'?{...axe([{id:'link-name',nodes:[node('#one')]}]),url:'https://example.test/home/guide'}:{shots:[{id:'marked-001',number:1,status:'captured',rule:'link-name',target:['#one']}]},
    readImage:(_id,file)=>{calls.push(file);return png;},notes:'<b>担当者メモ</b> https://example.test/home/guide'
  });
  assert.deepEqual(calls,['marked-001.png']);assert.equal(load(result.html)('img').length,1);
  assert.match(result.html,/対象URL https:\/\/example.test\/home\/guide|対象URLをブラウザー/);
  assert.doesNotMatch(result.html,/example\.test\[ローカルパス非表示\]/);
  assert.match(result.html,/&lt;b&gt;担当者メモ&lt;\/b&gt;/);
  assert.match(load(result.html)('pre').last().text(),/https:\/\/example.test\/home\/guide/);
});

test('unknown axe rules cannot select inherited advice or imply known layout causes',()=>{
  const result=buildDesignerReport({current:run([row('axe.pc','fail',{evidence:['axe.json']})]),readEvidence:()=>axe([{id:'constructor',nodes:[node('#x')]},{id:'layout',nodes:[node('#y')]}])});
  assert.equal(result.issueCount,2);assert.match(result.html,/constructor/);assert.match(result.html,/原因は未確認/);
  assert.doesNotMatch(result.html,/レイアウト検査の不合格/);
});

test('layout and snapshot failures are design issues; other failures remain separate handoffs',()=>{
  const current=run([
    row('layout.pc','fail',{evidence:['layout.json']}),row('snapshot.sp','fail',{reason:'画像差分を検出'}),
    row('javascript.pc','fail',{evidence:['javascript.json']}),row('page.home','fail',{reason:'canonical不一致'}),
    row('policy.missing','fail',{evidence:['policy.json']}),row('check.delivery','fail',{reason:'送信状態は未確認'})
  ]);
  const result=buildDesignerReport({current,readEvidence:(_id,file)=>({'layout.json':{content:1400,viewport:1280},'javascript.json':{jsErrors:[{message:'fixture exception',stack:'C:\\private\\source.js'}]},'policy.json':{status:302,path:'/missing',errors:['expected 404']}}[file])});
  const $=load(result.html);assert.equal($('article.design-issue').length,2);assert.equal($('article.handoff-issue').length,4);
  assert.equal(result.issueCount,6);assert.equal(result.failedCases,6);assert.match($.text(),/1400/);assert.match($.text(),/fixture exception/);
  for(const item of current.rows)assert.ok($.text().includes(item.id));
  assert.match($.text(),/実装・運用担当への引継ぎ/);assert.doesNotMatch(result.html,/C:\\private/);
});

test('escapes untrusted text, filters URL schemes, and excludes HTML/config credentials/local paths',()=>{
  const attack='<script>alert(1)</script>';
  const result=buildDesignerReport({current:run([row('axe.pc','fail',{title:attack,reason:'C:\\Users\\private\\secret.txt',evidence:['axe.json','../private.json']})],{name:attack,baseURL:'https://example.test'}),
    readEvidence:(_id,file)=>{assert.equal(file,'axe.json');return {...axe([{id:'unknown-rule',help:attack,nodes:[{...node('#x','<input value="secret-value">'),failureSummary:attack}]}]),url:'javascript:alert(1)'};},
    readConfig:()=>({headers:{Authorization:'private-auth'},storageState:'C:\\private\\state.json',pages:[{id:'pc',path:'https://user:password@example.test/secret'}]}),notes:attack+' file:///tmp/private.txt'
  });
  const $=load(result.html);assert.equal($('script').length,0);assert.equal($('[onerror],[onclick]').length,0);
  for(const link of $('a').toArray())assert.match($(link).attr('href'),/^(https?:\/\/|#)/);
  assert.match(result.html,/&lt;script&gt;/);assert.doesNotMatch(result.html,/private-auth|secret-value|user:password|file:\/\/|C:\\Users|storageState|Authorization/);
  assert.match($.text(),/unknown-rule/);assert.match($.text(),/原因.*未確認|原因.*未特定/);
});

test('missing evidence and missing config keep cases and warn without disclosing callback errors',()=>{
  const result=buildDesignerReport({current:run([row('axe.pc','fail',{evidence:['axe.json']}),row('layout.pc','fail')]),readEvidence:()=>{throw Error('C:\\private\\secret.json');},readConfig:()=>{throw Error('password=secret');}});
  assert.equal(result.failedCases,2);assert.ok(result.issueCount>=2);assert.ok(result.warnings.length>=2);
  assert.match(result.html,/axe.pc/);assert.match(result.html,/layout.pc/);assert.doesNotMatch(result.html,/secret/);
});

test('no-issue report preserves every pending status and does not claim release readiness',()=>{
  const rows=[row('page.home','pass'),row('snapshot.pc','review',{reason:'基準画像が未承認'}),row('check.manual','blocked',{reason:'認証未設定'}),row('axe.sp','not_run'),row('check.optional','not_applicable')];
  const result=buildDesignerReport({current:run(rows),notes:'担当者による未検証の補足'});
  assert.equal(result.issueCount,0);assert.equal(result.failedCases,0);
  assert.deepEqual(result.counts,{pass:1,fail:0,blocked:1,review:1,not_run:1,not_applicable:1});
  assert.match(result.html,/基準画像が未承認/);assert.match(result.html,/認証未設定/);assert.match(result.html,/axe.sp/);
  assert.match(result.html,/不合格はありません/);assert.match(result.html,/公開.*承認.*しません/);assert.match(result.html,/再検査.*実施していません/);
  const empty=buildDesignerReport({current:run([])});assert.equal(empty.issueCount,0);assert.equal(empty.failedCases,0);
});
