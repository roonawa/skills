// Static HTML for the editor report and the reviewer's basis file. No scripts; every interpolated string is escaped.
const ESC={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>ESC[c]);
const SECTIONS=[
  {category:'editor',tag:'t-edit',name:'編集者',heading:'編集者の方にお願いしたいこと',who:'編集者',intro:''},
  {category:'admin',tag:'t-admin',name:'管理者',heading:'管理者の権限が必要なこと',who:'サイトの管理者（権限のある人）',intro:'プラグインの更新や設定の変更は、管理者の権限がある方にお願いしてください。作業の前に、サイトのバックアップを取ってください。'},
  {category:'tech',tag:'t-tech',name:'技術担当',heading:'技術担当・サーバー担当に頼むこと',who:'技術担当・サーバー担当',intro:'サーバーや仕組みの設定なので、編集者の方の作業ではありません。'},
  {category:'not-site',tag:'t-tool',name:'サイトの問題ではない',heading:'サイトの問題ではないもの（対応不要）',who:'診断の担当（対応不要です）',intro:'診断ツールの設定や環境が原因で不合格になったもので、サイトの問題ではありません。診断の担当側で直して、もう一度診断します。'},
  {category:'unverified',tag:'t-wait',name:'未確認',heading:'まだ確かめられていないこと',who:'診断の担当・案件の担当',intro:'設定や準備が足りず、今回は確かめられなかったものです。'},
  {category:'not-applicable',tag:'t-wait',name:'対象外',heading:'このサイトには関係しないもの',who:'対応不要',intro:'このサイトには当てはまらないため、確認しなかったものです。'}
];
const FIX=['editor','admin','tech'];
const URGENCY={high:'早めに対応',normal:'通常',low:'急がない'};
const RULE_LABELS={'plugin-vulnerability':'プラグインの既知の弱点',compatibility:'更新前の互換性の確認','security-headers':'セキュリティ用の設定',disclosure:'外から分かる情報','soft-404':'存在しないページの表示','index-expectation':'検索エンジンへの公開設定','render-timeout':'ページの表示に時間がかかった','link-transient':'リンク先の一時的な不調','sitemap-format':'サイトマップの形式','foreign-image':'検証用と思われる画像',unclassified:'その他の不具合'};
const ENVIRONMENTS={production:'本番環境',staging:'検証環境',local:'ローカル環境'};
// Rows of unverified / not-applicable groups carry only an internal id; show a plain label for its kind.
const ID_LABELS={page:'ページの表示確認',links:'リンクの確認',layout:'画面の見た目',snapshot:'画面の見た目',axe:'アクセシビリティ',javascript:'画面の動き',admin:'管理画面の設定確認',journey:'操作の流れ',check:'サイト全体の検査'};
const label=g=>g.status==='unverified'||g.status==='not-applicable'?ID_LABELS[String(g.rowIds?.[0]).split('.')[0]]??'その他の検査':RULE_LABELS[g.rule]??'その他の項目';
const sum=gs=>gs.reduce((n,g)=>n+(g.rowIds?.length??0),0);
const byCategory=(groups,c)=>groups.filter(g=>g.category===c);

function bullets(gs){
  const m=new Map();for(const g of gs)m.set(label(g),(m.get(label(g))??0)+(g.rowIds?.length??0));
  return `<ul>${[...m].map(([l,n])=>`<li>${esc(l)}：${n}件</li>`).join('')}</ul>`;
}

const CSS=`:root{--ink:#1f2933;--muted:#5b6770;--line:#d9e0e5;--bg:#f5f7f8;--card:#fff;--red:#b42318;--red-bg:#fdecea;--amber:#9a6700;--amber-bg:#fff4d6;--blue:#1d5fa8;--blue-bg:#e8f1fb;--green:#256b3a;--green-bg:#e7f4ea;--gray-bg:#eef1f3}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15.5px/1.85 "Hiragino Sans","Yu Gothic UI","Meiryo",system-ui,sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:26px;line-height:1.4;margin:0 0 6px}
h2{font-size:20px;margin:40px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line)}
h3{font-size:16.5px;margin:0 0 6px}
p{margin:.4em 0}
.meta{color:var(--muted);font-size:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin:14px 0}
.lead{border-left:6px solid var(--blue);background:var(--blue-bg)}
.lead h2{border:0;margin:0 0 6px;padding:0}
.tag{display:inline-block;font-size:12.5px;font-weight:700;border-radius:999px;padding:1px 10px;margin-right:6px;vertical-align:2px}
.t-edit{background:var(--red-bg);color:var(--red)}
.t-admin{background:var(--amber-bg);color:var(--amber)}
.t-tech{background:var(--blue-bg);color:var(--blue)}
.t-tool{background:var(--green-bg);color:var(--green)}
.t-wait{background:var(--gray-bg);color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:14.5px;background:var(--card)}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:var(--gray-bg);font-weight:700}
td.num{text-align:right;white-space:nowrap}
.scroll{overflow-x:auto}
dl.steps{margin:8px 0 0}
dl.steps dt{font-weight:700;margin-top:8px}
dl.steps dd{margin:0 0 0 1em}
ol,ul{margin:.3em 0;padding-left:1.4em}
code{background:var(--gray-bg);padding:1px 5px;border-radius:4px;font-size:13.5px;word-break:break-all}
.note{color:var(--muted);font-size:13.5px}
.why{background:var(--gray-bg);border-radius:8px;padding:8px 12px;margin-top:8px;font-size:14.5px}
@media print{body{background:#fff}.card{break-inside:avoid}}`;

const page=(title,body)=>`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
${CSS}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
const tag=s=>`<span class="tag ${s.tag}">${esc(s.name)}</span>`;
const scroll=t=>`<div class="scroll">${t}</div>`;

function itemCard(s,item){
  const steps=(item.steps??[]).filter(Boolean);
  return `<div class="card">
<h3>${tag(s)}${esc(item.title)}</h3>
<p>${esc(item.summary)}</p>
${item.impact?`<div class="why">困ること：${esc(item.impact)}</div>\n`:''}${steps.length?`<dl class="steps">\n<dt>直し方</dt>\n<dd><ol>${steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol></dd>\n</dl>\n`:''}${item.location?`<p>場所：${esc(item.location)}</p>\n`:''}<p class="note">急ぎ度：${esc(URGENCY[item.urgency]??URGENCY.normal)}</p>
${item.note?`<p class="note">${esc(item.note)}</p>\n`:''}</div>`;
}

function section(n,s,groups,items){
  const gs=byCategory(groups,s.category);
  let body=`<h2>${n}. ${esc(s.heading)}</h2>\n`;
  if(!gs.length)return body+'<p>この項目はありません。</p>\n';
  if(s.intro)body+=`<p>${esc(s.intro)}</p>\n`;
  if(s.category==='unverified'||s.category==='not-applicable')return body+`<div class="card">${bullets(gs)}</div>\n`;
  const byId=new Map(items.map(i=>[i.groupId,i]));
  const shown=gs.filter(g=>byId.has(g.id)),rest=gs.filter(g=>!byId.has(g.id));
  body+=shown.map(g=>itemCard(s,byId.get(g.id))).join('\n');
  if(rest.length)body+=`${shown.length?'\n':''}<div class="card">${tag(s)}${bullets(rest)}</div>`;
  return body+'\n';
}

function header(title,{site,runId,startedAt,checkedAt}){
  return `<h1>${esc(title)}</h1>
<p class="meta">対象：${esc(site?.name)}（${esc(site?.baseURL)}）／環境：${esc(ENVIRONMENTS[site?.environment]??site?.environment)}<br>
診断の実行：${esc(runId)}（開始：${esc(startedAt)}）／再確認：${esc(checkedAt)}</p>`;
}

export function renderEditorReport(input){
  const {site,runId,startedAt,checkedAt,groups=[],items=[]}=input;
  const count=c=>byCategory(groups,c).length;
  const fix=groups.filter(g=>FIX.includes(g.category)).length,notSite=sum(byCategory(groups,'not-site')),unverified=sum(byCategory(groups,'unverified'));
  const notSiteText=`<p>診断ツール側が原因で不合格になったものが<strong>${notSite}件</strong>あります。これはサイトの問題ではなく、診断の担当側で直してもう一度診断します。</p>`;
  const lead=!groups.length?'<p>対応が必要なことはありません。</p>'
    :fix?`<p>サイトで直すことは<strong>${fix}つ</strong>です。そのうち編集者の方にお願いしたいのは${count('editor')}つ、管理者の権限が必要なものが${count('admin')}つ、技術担当に頼むものが${count('tech')}つです。</p>
${notSiteText}`
    :`<p>サイトで直すことはありません。</p>${notSite?`\n${notSiteText}`:''}${unverified?`\n<p>まだ確かめられていないものが<strong>${unverified}件</strong>あります。診断の担当が設定や準備を整えて、もう一度診断します。</p>`:''}`;
  const rows=SECTIONS.map(s=>{
    const gs=byCategory(groups,s.category),n=sum(gs);
    const cell=s.category==='not-applicable'?(gs.length?bullets(gs):'0件'):`${n}件${FIX.includes(s.category)?`（${gs.length}項目）`:''}`;
    return `<tr><td>${tag(s)}</td><td class="num">${cell}</td><td>${esc(s.who)}</td></tr>`;
  }).join('\n');
  const title=`${site?.name??''} サイト診断のまとめ（編集者向け）`;
  return page(title,`${header(title,{site,runId,startedAt,checkedAt})}

<div class="card lead">
<h2>2. ひとことで言うと</h2>
${lead}
</div>

<h2>3. 分類ごとの件数</h2>
${scroll(`<table>
<thead><tr><th>分類</th><th>件数</th><th>だれが対応するか</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`)}

${SECTIONS.map((s,i)=>section(i+4,s,groups,items)).join('\n')}
<h2>10. このあとの進め方</h2>
<ol>
<li>編集者・管理者・技術担当の項目は、それぞれの担当の方に渡してください。</li>
<li>サイトの問題ではないものと未確認のものは、診断の担当が設定を直し、もう一度診断します。</li>
<li>直したあと、もう一度診断して、結果が改善したことを確かめます。</li>
</ol>

<h2>11. 作成の根拠</h2>
<p class="note">この資料は、診断ツールの結果（実行：${esc(runId)}、開始：${esc(startedAt)}）を、公開されているページの再確認（${esc(checkedAt)}）と合わせて整理したものです。再確認は、ページを取得して確かめただけで、管理画面にはログインしていません。文章は AI が下書きし、プログラムが形式を確認しています。どの記録に基づくかは、別の「根拠」のファイルに残してあります。</p>`);
}

const list=a=>a?.length?`<ul>${a.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'なし';
const table=(head,rows)=>scroll(`<table><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
const logRow=e=>[e.at,e.method,e.url,e.status,e.rule];
export function renderBasis(input){
  const {groups=[],recheckLog=[],lintResults=[],aiCalls=0}=input;
  const title=`${input.site?.name??''} 編集者向け報告書の根拠（レビュー用）`;
  const cards=groups.map(g=>{
    const reasons=g.basis?.reasons?.length?g.basis.reasons:g.rowIds??[];
    const log=recheckLog.filter(e=>e.rule===g.rule),v=g.verification;
    return `<div class="card">
<h3>${esc(g.id)}</h3>
<p>規則：<code>${esc(g.rule)}</code>／状態：${esc(g.status)}／分類：${esc(g.category)}／${g.rowIds?.length??0}件</p>
<p>行ID：${list(g.rowIds)}</p>
<p>元の理由：${list(reasons)}</p>
<p>再確認の結果：${v?`${esc(v.result)}${list(v.notes)}`:'再確認なし'}</p>
${log.length?table(['時刻','方法','URL','状態'],log.map(e=>logRow(e).slice(0,4))):'<p class="note">この規則の再確認の記録はありません。</p>'}
</div>`;
  }).join('\n');
  return page(title,`${header(title,input)}
<p>Claude の呼び出し回数：${esc(aiCalls)}</p>
<h2>グループごとの根拠</h2>
${cards||'<p>グループはありません。</p>'}
<h2>再確認の記録（全件）</h2>
${recheckLog.length?table(['時刻','方法','URL','状態','規則'],recheckLog.map(logRow)):'<p>記録はありません。</p>'}
<h2>機械的な確認の結果</h2>
${lintResults.length?table(['項目','問題','内容'],lintResults.map(p=>[p.groupId,p.problem,p.detail])):'<p>機械的な確認で見つかった問題はありません。</p>'}`);
}
