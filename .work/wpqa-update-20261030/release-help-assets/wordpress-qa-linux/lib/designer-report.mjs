import {load} from 'cheerio';
import {handoffKey,handoffAdvice} from './designer-handoff.mjs';
import {escapeHTML} from './results.mjs';
import {selectReportRows,reproduction} from './issue-report.mjs';

const labels={pass:'合格',fail:'不合格',blocked:'実行不能',review:'要確認',not_run:'未実施',not_applicable:'対象外'};
const MB=1024*1024;
function clean(value){
  const urls=[];
  // Protect web URLs before removing local paths; /home is also a valid web path.
  return String(value??'').slice(0,16000).replace(/\0/g,'')
    .replace(/https?:\/\/[^\s<>"']+/gi,value=>{urls.push(safeURL(value)??'[URL非表示]');return `\0${urls.length-1}\0`;})
    .replace(/(?:file:\/\/[^\s\0<>"']+|[A-Za-z]:[\\/][^\s\0<>"']+|\\\\[^\s\0<>"']+|\/(?:Users|home|tmp|var|etc|mnt|private|opt|workspace|workspaces|root|srv|Volumes)\/[^\s\0<>"']+)/g,'[ローカルパス非表示]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s\0<>"']+/gi,'[認証情報非表示]')
    .replace(/\b(?:authorization|cookie|password|secret|nonce|access_token)\s*[:=]\s*[^\r\n]+/gi,'[認証情報非表示]')
    .replace(/\0(\d+)\0/g,(_,index)=>urls[Number(index)]);
}
const e=value=>escapeHTML(clean(value));
const safeURL=(value,base)=>{
  if(typeof value!=='string'||!value.trim()||/[\x00-\x20\\]/.test(value))return null;
  try{const u=new URL(value,base);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;for(const key of [...u.searchParams.keys()])if(/token|password|secret|nonce|authorization|api[-_]?key/i.test(key))u.searchParams.set(key,'[非表示]');return u.href;}catch{return null;}
};
const link=url=>url?`<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(url)}</a>`:'URL未記録・表示不可';
const dimension=value=>Number.isFinite(value)&&value>0&&value<=20000?value:null;
const relative=file=>typeof file==='string'&&file.length<=1024&&!/[\\:\0]/.test(file)&&!file.startsWith('/')&&file.split('/').every(p=>p&&p!=='.'&&p!=='..');
const name=file=>file.split('/').at(-1);
const evidenceName=file=>/^(axe|layout|snapshot|javascript|policy|audit|links)(?:-[^/]+)?\.json$/.test(name(file));

const advice={
  'color-contrast':{title:'文字と背景のコントラスト不足',impact:'弱視の方や明るい場所で閲覧する方が、文字や案内を読み取りにくくなる可能性があります。',admin:'テーマ・ブロックの文字色と背景色を確認し、該当部品の設定で配色を調整します。設定項目がなければ対象を限定したCSSの修正を実装担当へ依頼します。',verify:'保存された文字サイズ・太さと期待比率に沿って再測定し、通常・ホバー・フォーカス状態を確認する。'},
  'label-content-name-mismatch':{title:'表示ラベルとアクセシブル名の不一致',impact:'音声操作や読み上げで、画面に見える名称と異なる案内になり、目的の操作を選びにくくなる可能性があります。',admin:'対象ブロックやボタンの表示文言・名称設定を確認します。設定で直せない場合は、見える文言をアクセシブル名に含めるよう実装担当へ依頼します。動作の誤りはこの検査だけでは断定しません。',verify:'表示文言とアクセシビリティツリーの名前を照合し、意図した操作かを別途確認する。'},
  'label-form':{title:'フォーム入力のラベル不足',impact:'読み上げ利用者が各入力欄の用途を判断しにくくなります。フォーム送信の成否とは別の検出結果です。',admin:'フォーム編集画面に項目ラベルの設定があれば修正します。設定がなければ、一意のidとlabelのforによる関連付けを実装担当へ依頼します。既存の項目名・必須条件は確認せず変更しません。',verify:'項目名と入力欄の関連付け、フォーカス移動、読み上げ名を確認する。送信操作は許可された環境・手順で別途実施する。'},
  'label-quantity':{title:'数量入力のラベル不足',impact:'数量欄の用途や対象を読み上げで区別しにくく、誤入力につながる可能性があります。',admin:'対象入力欄の名称を管理設定で指定できるか確認します。対応する設定がなければ、対象を識別できる数量ラベルをテンプレートへ追加するよう依頼します。',verify:'数量欄の名前と対象の対応を確認する。数値変更・再計算・注文の成否は別途確認する。'},
  'label-other':{title:'入力欄のラベル不足（用途未特定）',impact:'入力欄の用途が支援技術へ伝わらない可能性があります。具体的な業務上の用途は保存済み証拠だけでは特定していません。',admin:'表示される項目名と入力欄を確認し、管理画面にラベル設定があれば調整します。設定がなければ意味を確認してから実装担当へ関連付けを依頼します。',verify:'対象要素の用途を確定し、各入力欄のアクセシブル名を確認する。'},
  'link-name':{title:'リンクの目的を伝える名前の不足',impact:'リンク一覧や読み上げから、リンク先の目的を判断しにくくなります。クリックできないことを示す結果ではありません。',admin:'リンクを置いたブロック・メニュー・画像の設定を確認し、目的を表す文言や代替テキストを設定します。リンク自身に名前が付かない場合はテンプレート修正を依頼します。',verify:'Tab移動と読み上げでリンクの目的を確認し、表示切替や複製要素も再検査する。'},
  layout:{title:'レイアウト検査の不合格',impact:'横方向のはみ出し等が利用者の閲覧を妨げる可能性があります。原因や見た目の症状は測定値と画像で切り分けます。',admin:'対象ブロックの幅・余白・画像サイズ・折返し設定を確認します。設定で解消しない場合は、記録された幅でCSSと配置を実装担当と確認します。',verify:'記録されたURL・画面幅で表示し、保存された測定値と該当部品の配置を照合する。'},
  snapshot:{title:'画像比較検査の不合格',impact:'保存された基準画像との違い、または画像比較に至る準備処理の失敗です。意図した変更か不具合かは追加確認が必要です。',admin:'対象ページの更新内容・画像・フォント等を管理画面で確認し、差分画像と失敗理由を照合します。意図した変更と確認できるまで基準画像を更新しません。',verify:'基準・実測・差分画像と実行環境を照合する。基準未承認による要確認は不合格と区別する。'}
};
for(const [key,value] of Object.entries(handoffAdvice))advice['handoff-'+key]={...value,admin:value.steps.join(' ')};
function labelKind(node){
  const $=load(typeof node.html==='string'?node.html.slice(0,16000):'');
  const input=$('input,textarea,select').first();
  const identifiers=[input.attr('id'),input.attr('name'),input.attr('class')].filter(Boolean).join(' ');
  if(/(?:^|[\s_\-[\]])(?:qty|quantity)(?:$|[\s_\-[\]\d])/i.test(identifiers))return 'label-quantity';
  if(input.is('textarea')||input.is('input')&&['text','email','tel','password','search','url'].includes((input.attr('type')??'text').toLowerCase()))return 'label-form';
  return 'label-other';
}

// Callbacks remain the filesystem/security boundary: callers must enforce their
// run directory, registered evidence and pre-read byte limits. This layer also
// bounds callback counts, parsed evidence, and image embedding, without I/O.
export function buildDesignerReport({current,previous=[],includeHistory=false,readEvidence=()=>null,readImage=()=>null,readConfig=()=>({}),notes=''}){
  const selected=selectReportRows(current,previous,includeHistory);
  const counts=Object.fromEntries(Object.keys(labels).map(status=>[status,selected.filter(({row})=>row.status===status).length]));
  const warnings=[],warningSet=new Set(),groups=new Map(),jsonCache=new Map(),configs=new Map(),images=new Map();
  let reads=0,imageReads=0,imageBytes=0,evidenceBytes=0;
  const warn=(entry,message)=>{const value=clean(`${entry.run.runId} / ${entry.row.id}：${message}`);if(!warningSet.has(value)){warningSet.add(value);warnings.push(value);}};
  const files=entry=>(entry.row.evidence??[]).filter(file=>{if(relative(file))return true;warn(entry,'安全でない証拠パスは使用しませんでした。');return false;});
  const json=(entry,file)=>{
    const key=JSON.stringify([entry.run.runId,file]);
    if(jsonCache.has(key))return jsonCache.get(key);
    let data=null;
    try{
      if(!files(entry).includes(file)||++reads>600)throw Error();
      const value=readEvidence(entry.run.runId,file),size=Buffer.byteLength(JSON.stringify(value)??'');
      if(size>8*MB||(evidenceBytes+=size)>32*MB)throw Error();
      data=value;
    }catch{warn(entry,'証拠を読み取れませんでした（欠落・形式・サイズまたは読取り上限）。');}
    jsonCache.set(key,data);return data;
  };
  const config=entry=>{
    const id=entry.run.runId;
    if(!configs.has(id)){
      let projected={};
      try{
        if(++reads>600)throw Error();
        const raw=readConfig(id)??{},base=safeURL(entry.run.baseURL);
        const list=key=>Array.isArray(raw[key])?raw[key].slice(0,5000):[];
        // Deliberately project only reproduction fields, never auth or paths to files.
        projected={pages:list('pages').map(p=>({id:p.id,path:safeURL(p.path,base)})),visuals:list('visuals').map(v=>({id:v.id,pageId:v.pageId,width:dimension(v.width),height:dimension(v.height)})),policies:list('policies').map(p=>({id:p.id,path:safeURL(p.path,base),statuses:Array.isArray(p.statuses)?p.statuses.filter(n=>Number.isInteger(n)&&n>=100&&n<=599):undefined}))};
      }catch{warn(entry,'再現条件の設定を読み取れませんでした。未記録の値は推測しません。');}
      configs.set(id,projected);
    }
    return configs.get(id);
  };
  const meta=(entry,detail={})=>{
    const c=config(entry),id=entry.row.id.slice(entry.row.id.indexOf('.')+1),v=c.visuals?.find(v=>v.id===id),p=c.pages?.find(p=>p.id===(v?.pageId??id)),policy=c.policies?.find(p=>p.id===id);
    const raw=detail.url??detail.path??policy?.path??p?.path;
    return {url:safeURL(raw,safeURL(entry.run.baseURL)),width:dimension(detail.viewport?.windowWidth)??dimension(detail.viewport?.width)??dimension(detail.viewport)??v?.width??null,height:dimension(detail.viewport?.windowHeight)??dimension(detail.viewport?.height)??v?.height??null};
  };
  const metaHTML=info=>`${link(info.url)} ／ ${info.width?`${info.width}px${info.height?` × ${info.height}px`:''}`:'画面幅未記録'}`;
  const add=(key,kind,entry,detail={})=>{
    if(!groups.has(key))groups.set(key,{key,kind,cases:new Map()});
    const group=groups.get(key),id=JSON.stringify([entry.run.runId,entry.row.id]);
    if(!group.cases.has(id))group.cases.set(id,{...entry,details:[]});
    const item=group.cases.get(id);
    if(item.details.length<200)item.details.push(detail);else warn(entry,'検出要素が多いため、この項目の詳細表示は200件までです。');
  };
  for(const entry of selected){
    if(entry.row.status!=='fail')continue;
    const kind=entry.row.id.split('.')[0];let found=false;
    const candidates=files(entry).filter(evidenceName);
    if(candidates.length>8)warn(entry,'証拠JSONの参照はケースごとに8件までです。');
    for(const file of candidates.slice(0,8)){
      const data=json(entry,file);if(!data||typeof data!=='object')continue;
      if(kind==='axe'&&Array.isArray(data.violations)){
        for(const violation of data.violations.slice(0,100)){
          if(!violation||typeof violation.id!=='string')continue;
          const nodes=Array.isArray(violation.nodes)&&violation.nodes.length?violation.nodes:[{}];
          if(nodes.length>1000)warn(entry,'検出要素の読取り上限に達しました。残りは元の証拠で確認してください。');
          for(const n of nodes.slice(0,1000)){
            if(!n||typeof n!=='object'){warn(entry,'形式が不正な検出要素を省略しました。');continue;}
            found=true;const key=violation.id==='label'?labelKind(n):['color-contrast','label-content-name-mismatch','link-name'].includes(violation.id)?violation.id:'axe-'+violation.id;
            const measurements=['any','all','none'].flatMap(key=>Array.isArray(n[key])?n[key]:[]).filter(check=>check?.data?.contrastRatio!==undefined).map(check=>{const d=check.data;return `文字色 ${clean(d.fgColor)} / 背景色 ${clean(d.bgColor)} / 比率 ${clean(d.contrastRatio)} / 期待 ${clean(d.expectedContrastRatio)}`;});
            add(key,'design',entry,{rule:violation.id,url:data.url,viewport:data.testEnvironment, target:Array.isArray(n.target)?n.target:[],reason:n.failureSummary??violation.help??'詳細な測定理由は未記録。',measurements});
          }
        }
        if(data.violations.length>100)warn(entry,'ルールの表示上限に達しました。残りは元の証拠で確認してください。');
      }else if(kind!=='axe'){
        found=true;
        const messages=Array.isArray(data.jsErrors)?data.jsErrors.map(error=>typeof error==='string'?error:error?.message).filter(Boolean):[];
        add(['layout','snapshot'].includes(kind)?kind:'handoff-'+handoffKey(entry.row),['layout','snapshot'].includes(kind)?'design':'handoff',entry,{url:data.url,path:kind==='policy'?data.path:undefined,viewport:data.testEnvironment??data.viewport,reason:entry.row.reason,message:messages.join('\n'),status:typeof data.status==='number'?data.status:undefined,errors:Array.isArray(data.errors)?data.errors.filter(v=>typeof v==='string'):[],measurements:kind==='layout'&&Number.isFinite(data.content)?[`内容幅 ${data.content}px / 表示幅 ${dimension(data.viewport)??'未記録'}px`]:[]});
      }
    }
    if(!found)add(['layout','snapshot'].includes(kind)?kind:'handoff-'+handoffKey(entry.row),['layout','snapshot'].includes(kind)?'design':'handoff',entry,{reason:entry.row.reason??'詳細証拠なし。原因未確認。'});
  }
  const image=(entry,file,caption)=>{
    if(!files(entry).includes(file))return null;
    const key=JSON.stringify([entry.run.runId,file]);
    if(images.has(key))return images.get(key);
    let record=null;
    try{
      if(imageReads>=32)throw Error();imageReads++;
      const src=readImage(entry.run.runId,file);
      if(typeof src!=='string'||src.length>8*MB||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(src))throw Error();
      if(Buffer.from(src.slice(22,34),'base64').subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||imageBytes+src.length>24*MB)throw Error();
      imageBytes+=src.length;record={id:'image-'+(images.size+1),src,caption,entry};
    }catch{warn(entry,'画像を読み取れませんでした（欠落・形式・サイズまたは画像上限）。');}
    images.set(key,record);return record;
  };
  const prepareImages=entry=>{
    const registered=files(entry),found=[],reasons=[];
    let attempts=0;
    const manifests=registered.filter(f=>/^marked-screenshots[^/]*\.json$/.test(name(f)));
    if(manifests.length>4)warn(entry,'枠付き画像台帳の参照はケースごとに4件までです。');
    for(const file of manifests.slice(0,4)){
      const data=json(entry,file);
      if(!Array.isArray(data?.shots)){reasons.push('枠付き画像の台帳を読み取れませんでした。');continue;}
      if(data.shots.length>1000)warn(entry,'画像台帳の読取り上限に達しました。');
      for(const shot of data.shots.slice(0,1000)){
        if(!shot||typeof shot!=='object')continue;
        const detail=entry.details.find(d=>d.rule===shot.rule&&JSON.stringify(d.target)===JSON.stringify(shot.target));
        if(!detail)continue;
        if(shot.status!=='captured'){reasons.push('枠付き画像なし：'+clean(shot.reason||'取得できなかった理由は未記録。'));continue;}
        const matching=typeof shot.id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(shot.id)?registered.filter(f=>name(f)===`${shot.id}.png`||name(f).startsWith(`${shot.id}-`)&&name(f).endsWith('.png')):[];
        if(matching.length!==1){reasons.push('対応する画像が未登録、または候補が複数あります。');continue;}
        if(attempts>=1){reasons.push('このケース・項目の画像表示は代表1枚までです。');continue;}
        attempts++;
        const info=meta(entry,{url:shot.url??detail.url,viewport:shot.viewport??detail.viewport});
        const record=image(entry,matching[0],{marked:true,number:shot.number,target:shot.target,capturedAt:shot.capturedAt,...info});
        if(record&&!found.includes(record))found.push(record);
      }
    }
    if(!found.length&&attempts===0){
      const fallback=registered.filter(f=>f.endsWith('.png')&&!name(f).startsWith('marked-')).sort((a,b)=>Number(/diff/.test(name(b)))-Number(/diff/.test(name(a))));
      for(const file of fallback.slice(0,1)){
        const record=image(entry,file,{marked:false,...meta(entry,entry.details[0]),type:/diff/.test(name(file))?'差分画像':/expected/.test(name(file))?'基準画像':'参考画面'});
        if(record)found.push(record);
      }
    }
    if(!found.length)reasons.push('画像は未取得、またはこの報告書に埋め込めませんでした。対象要素を推測して囲んでいません。');
    return {images:found,reasons:[...new Set(reasons)]};
  };
  const emitted=new Set();
  const figure=(record,representative=false)=>{
    if(emitted.has(record.id))return `<p><a href="#${record.id}">掲載済みの画像を参照</a></p>`;
    emitted.add(record.id);
    const {caption:c,entry}=record;
    return `<figure id="${record.id}"><img src="${record.src}" alt="${e(c.marked?'保存済みの枠付き画像':'保存済みの参考画像。指摘箇所の枠付けなし')}" loading="lazy"><figcaption>${representative?'代表画像 ／ ':''}${c.marked?`赤枠・番号${e(c.number)} ／ 対象 ${e(JSON.stringify(c.target))}`:e(c.type)+'（指摘箇所を特定するものではありません）'}<br>${metaHTML(c)}<br>出典：${e(entry.run.runId)} ／ ${e(entry.row.id)}${c.capturedAt?` ／ 撮影 ${e(c.capturedAt)}`:''}</figcaption></figure>`;
  };
  const provenance=entry=>`ケース：<code>${e(entry.row.id)}</code> ／ ${e(entry.row.title)}<br>出典：${e(entry.run.runId)} ／ 実行日時 ${e(entry.run.startedAt)} ／ ${e(entry.run.environment)}${entry.run.runId!==current.runId?' <strong>【過去結果・再検査ではありません】</strong>':''}`;
  const repro=(entry,key)=>{
    const info=meta(entry,entry.details[0]);
    const safeEntry={row:{id:clean(entry.row.id),reason:clean(entry.row.reason)},run:{baseURL:safeURL(entry.run.baseURL)??'',environment:clean(entry.run.environment)},details:entry.details.map(d=>({url:safeURL(d.url,safeURL(entry.run.baseURL))??undefined,path:safeURL(d.path,safeURL(entry.run.baseURL))??undefined,viewport:d.viewport,target:d.target,reason:clean(d.reason),message:clean(d.message),status:d.status,errors:(d.errors??[]).map(clean)}))};
    const kind=key.startsWith('handoff-')?key.slice(8):key;
    const r=reproduction(safeEntry,kind,config(entry)),a=advice[key];
    const steps=a?.repro??(a&&['label-form','label-quantity','label-other','label-content-name-mismatch','layout','snapshot'].includes(key)?[info.url?`対象URL ${info.url} を${info.width?`${info.width}pxの画面幅で`:'記録された条件で'}開く。`:'対象URL・画面幅を元のケース定義で確認する。',a.verify]:r.steps);
    return `<section class="repro"><h4>再現・修正後の確認（未実施の手順）</h4><ol>${steps.map(s=>`<li>${e(s)}</li>`).join('')}</ol><p><b>期待条件：</b>${e(a?.verify??r.expected)}</p><p><b>観測と限界：</b>${e(r.visible)} ${e(r.limit)}</p></section>`;
  };
  const caseHTML=(entry,key)=>{
    const info=meta(entry,entry.details[0]);
    return `<details class="case"><summary>${e(entry.row.title??entry.row.id)} — ${e(entry.row.id)}</summary><p>${provenance(entry)}</p><p>${metaHTML(info)}</p>${entry.row.reason?`<pre>${e(entry.row.reason)}</pre>`:''}<div class="table-wrap"><table><thead><tr><th>URL・画面幅</th><th>対象・ルール</th><th>保存された観測</th></tr></thead><tbody>${entry.details.map(d=>`<tr><td>${metaHTML(meta(entry,d))}</td><td>${e(d.rule??key)}<br><code>${e(d.target?JSON.stringify(d.target):'対象要素は未記録')}</code></td><td>${e(d.reason??'')}<br>${e(d.message??'')}${d.status!==undefined?` HTTP ${e(d.status)}`:''}${(d.errors??[]).map(s=>`<p>${e(s)}</p>`).join('')}${(d.measurements??[]).map(s=>`<p>${e(s)}</p>`).join('')}</td></tr>`).join('')}</tbody></table></div>${repro(entry,key)}${entry.media.reference?`<p><a href="#${entry.media.reference}">代表画像を参照（個別画像は省略）</a></p>`:''}${entry.media.images.map(img=>figure(img)).join('')}${entry.media.reasons.map(reason=>`<p class="note">${e(reason)}</p>`).join('')}</details>`;
  };
  const all=[...groups.values()],design=all.filter(g=>g.kind==='design'),handoff=all.filter(g=>g.kind==='handoff');
  // Give every category its first representative before reading second cases.
  for(let round=0;round<2;round++)for(const g of all){
    const entry=[...g.cases.values()][round];
    if(entry)entry.media=prepareImages(entry);
  }
  const renderGroup=(g,index)=>{
    const cases=[...g.cases.values()];
    for(const entry of cases){
      if(!entry.media){
        entry.media={images:[],reasons:['代表画像を参照（個別画像は省略）。全URL・対象要素の検出結果は掲載しています。']};
        warn(entry,'同じ分類の画像は代表2ケースまでです。個別画像は省略しています。');
      }
    }
    const a=advice[g.key]??{title:g.kind==='design'?`アクセシビリティ：${g.key}`:`${g.key.slice(8)}：実装・運用への確認`,impact:'保存済み検査が期待条件を満たしていません。具体的な利用者影響・原因は未確認です。',admin:'対象ページや利用機能の管理設定で変更できるか確認します。設定場所や原因を推測せず、ケース・観測結果を実装または運用担当へ引き継ぎます。',verify:'元の期待条件と証拠を確認して再現し、必要な追加検査を担当者と決める。'};
    const representative=cases.flatMap(entry=>entry.media.images).find(img=>img.caption.marked)??cases.flatMap(entry=>entry.media.images)[0];
    for(const entry of cases)if(!entry.media.images.length&&representative)entry.media.reference=representative.id;
    return `<article class="${g.kind==='design'?'design-issue':'handoff-issue'}" id="issue-${index}"><div class="eyebrow">${g.kind==='design'?'DESIGN':'HANDOFF'} ${index} ／ ${cases.length}ケース</div><h3>${e(a.title)}</h3><p class="impact">${e(a.impact)}</p><div class="columns"><section><h4>管理画面から確認する修正候補</h4>${a.owner?`<p><b>担当：</b>${e(a.owner)}</p><p><b>管理画面での対応範囲：</b>${e(a.scope)}</p>`:''}${a.steps?`<ol>${a.steps.map(step=>`<li>${e(step)}</li>`).join('')}</ol>`:`<p>${e(a.admin)}</p>`}</section><section><h4>実装担当への引継ぎ・検証</h4>${a.dev?`<p>${e(a.dev)}</p><h4>修正完了の確認</h4>`:''}<p>${e(a.verify)}</p>${a.sources?`<p>設定方法の参考：${a.sources.map(([title,url])=>`<a href="${escapeHTML(safeURL(url))}" target="_blank" rel="noopener noreferrer">${e(title)}</a>`).join(' ／ ')}</p>`:''}<p class="note">手順は保存済みの検出結果と設定方法に基づく修正候補です。利用バージョン・権限・導入機能により画面名や対応可否は異なります。今回、設定変更や修正後の再検査は実施していません。</p></section></div>${representative?figure(representative,true):'<p class="note">代表画像はありません。各ケースの未取得理由・観測結果を参照してください。</p>'}${cases.map(entry=>caseHTML(entry,g.key)).join('')}</article>`;
  };
  const designHTML=design.map((g,i)=>renderGroup(g,i+1)).join('');
  const handoffHTML=handoff.map((g,i)=>renderGroup(g,design.length+i+1)).join('');
  const pending=selected.filter(({row})=>['review','not_run','blocked'].includes(row.status));
  const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(current.name)}｜デザイナー共有用レポート</title><style>
  :root{color-scheme:light;--ink:#193749;--muted:#516572;--accent:#116c68;--line:#d7e3e5}*{box-sizing:border-box}body{margin:0;background:#f0f4f4;color:var(--ink);font:16px/1.8 system-ui,'Yu Gothic',sans-serif}header{background:#193749;color:#fff;padding:48px max(24px,calc((100vw - 1100px)/2))}header a{color:#b0ece3}h1{font-size:clamp(28px,4vw,44px);line-height:1.4}h2{font-size:26px}h3{font-size:23px;line-height:1.5}h4{font-size:17px;margin:12px 0}main{max-width:1150px;padding:24px;margin:auto}a{color:#075c74;overflow-wrap:anywhere}.eyebrow{font-size:12px;letter-spacing:.12em;font-weight:700;color:var(--accent)}header .eyebrow{color:#b0ece3}.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}.stats div,article,.panel{background:#fff;border:1px solid var(--line);border-radius:12px;padding:24px}.stats div{padding:16px}.stats b{display:block;font-size:30px}.stats span,.note{font-size:14px;color:var(--muted)}article,.panel{margin:24px 0;overflow-wrap:anywhere}.columns{display:grid;grid-template-columns:1fr 1fr;gap:26px}.impact{border-left:4px solid #bd872e;background:#fff7e8;padding:12px 18px}nav{display:flex;gap:18px;flex-wrap:wrap;margin-top:24px}figure{margin:24px 0;border:1px solid var(--line);border-radius:8px;overflow:hidden}img{display:block;max-width:100%;height:auto;margin:auto}figcaption{background:#edf4f4;padding:14px;font-size:13px}.case{border-top:1px solid var(--line);padding:12px 0}summary{cursor:pointer;font-weight:700}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:#f1f5f5}code{font-size:12px;overflow-wrap:anywhere}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid var(--line)}th{background:#edf4f4}footer{color:var(--muted);font-size:13px;padding:20px 0}@media(max-width:700px){main{padding:12px}.columns{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}article,.panel{padding:18px}td{min-width:140px}}@media print{body,header{background:white;color:#193749}header{padding:16px}header a{color:inherit}main{max-width:none;padding:0}nav{display:none}article{border-radius:0}.columns{display:block}figure{break-inside:avoid}details::details-content{content-visibility:visible}}
  </style></head><body><header><div class="eyebrow">DESIGN QA / SAVED EVIDENCE</div><h1>${e(current.name)}<br>デザイナー共有用レポート</h1><p>対象：${link(safeURL(current.baseURL))} ／ ${e(current.environment)}<br>選択した実行：${e(current.runId)} ／ ${e(current.startedAt)} ／ 状態 ${e(current.runStatus)}<br>生成日時：${e(new Date().toISOString())}</p><p>保存済み証拠から、デザインの修正候補と実装・運用への引継ぎを整理しました。サイトへのアクセス・修正・再検査は実施していません。</p></header><main><div class="stats">${Object.entries(counts).map(([status,count])=>`<div><b>${count}</b><span>${labels[status]}</span></div>`).join('')}</div><p>報告対象 ${selected.length}ケース ／ 不合格 ${counts.fail}ケース → デザイン ${design.length}項目・引継ぎ ${handoff.length}項目。同じケースが複数項目に含まれることがあります。</p><p class="note">${includeHistory?'同一サイト・環境・設定ハッシュの、選択した実行より前に完了した履歴で未実施ケースだけを補っています。出典を各ケースに表示し、再検査済みとは扱いません。':'選択した実行だけを対象にしています。過去結果は補っていません。'} 件数は採用した結果から算出しており、新しい合否判定ではありません。</p><nav><a href="#design">デザインの修正候補</a><a href="#handoff">実装・運用への引継ぎ</a><a href="#pending">未確認事項</a></nav><section class="panel"><h2>修正の進め方</h2><p>まず対象URL・幅・要素と観測結果を確認し、管理画面で変更できる設定を調べます。設定で対応できない部分は実装担当へ引き継ぎ、修正後に同じ条件と関連画面を確認してください。掲載画像は保存時点のもので、代表画像だけで全ケースを確認したとはみなしません。</p></section><section id="design"><h2>デザインの修正候補（${design.length}項目）</h2>${designHTML||`<p>${counts.fail?'デザインとして分類できる不合格はありません。引継ぎ項目を確認してください。':'報告対象に不合格はありません。未実施・要確認の項目を含めて公開判断してください。'}</p>`}</section><section id="handoff"><h2>実装・運用担当への引継ぎ（${handoff.length}項目）</h2>${handoffHTML||'<p>採用した結果に、この分類の不合格はありません。</p>'}</section><section id="pending" class="panel"><h2>未実施・要確認・実行不能（${pending.length}ケース）</h2><p>画像基準の未承認、手動確認、環境不足はデザイン不具合や合格へ置き換えていません。</p>${pending.map(entry=>`<details><summary>${e(labels[entry.row.status])}：${e(entry.row.title??entry.row.id)}</summary><p>${provenance(entry)}</p><pre>${e(entry.row.reason??'理由は未記録。')}</pre></details>`).join('')||'<p>該当するケースはありません。</p>'}</section>${current.errors?.length?`<section class="panel"><h2>実行エラー</h2>${current.errors.map(error=>`<pre>${e(typeof error==='string'?error:error?.message??'詳細は元の実行記録を確認してください。')}</pre>`).join('')}</section>`:''}${warnings.length?`<section class="panel"><h2>証拠の読取り・表示制限</h2><ul>${warnings.map(warning=>`<li>${e(warning)}</li>`).join('')}</ul></section>`:''}${typeof notes==='string'&&notes.trim()?`<section class="panel"><h2>担当者の補足（自動検証していない記載）</h2><pre>${e(notes.trim())}</pre></section>`:''}<footer>この報告書はサイト全体の適合や公開を自動承認しません。画像・対象・測定結果の不足は元の証拠と照合し、追加検査の範囲を担当者と決めてください。送信・購入等の操作は、この報告書の生成では実施していません。</footer></main></body></html>`;
  return {html,issueCount:all.length,failedCases:counts.fail,counts,warnings};
}
