import {escapeHTML as e} from './results.mjs';

const labels={pass:'合格',fail:'不合格',blocked:'実行不能',review:'要確認',not_run:'未実施',not_applicable:'対象外'};
// Match signatures, not just test titles. A group is a repair candidate, not a proven common cause.
function component(node){
  const html=node.html??'';
  const cls=/class=["']([^"']+)/.exec(html)?.[1]?.split(/\s+/).find(c=>!c.startsWith('u-'));
  const href=/href=["']([^"']+)/.exec(html)?.[1];
  return cls?`.${cls}`:href?`リンク ${href}`:JSON.stringify(node.target??[]);
}
export function advice(kind,signature=''){
  if(kind==='color-contrast')return {title:`文字と背景のコントラスト不足：${signature}`,impact:'弱視の方や明るい場所で閲覧する方が、文字や案内を読み取りにくくなります。',admin:'テーマのカスタマイザーまたは対象ブロックの文字色・背景色を先に調整します。フッターなら「外観 → カスタマイズ → フッター」を確認。設定項目の有無はテーマによります。',code:'設定が反映されない場合は追加CSSまたは子テーマで対象要素に限定して調整。親要素の透過、重なり、hover・focus時も調べます。',verify:'証拠に記載された文字サイズ・太さに対応する比率を満たすことをPC・スマホで再測定します。'};
  if(kind==='link-name')return {title:`リンクの読み上げ名がない：${signature}`,impact:'スクリーンリーダー利用者がリンク先の目的を判別できません。通常クリックができないこととは別の問題です。',admin:'該当リンクを設置したブロック・ウィジェット・カスタムHTMLで目的が分かるリンク文言を設定。メインビジュアルの場合はテーマのスライド設定のボタンテキストを確認します。',code:'空のリンクが残る場合は、出力元でリンク自体にテキストまたはaria-labelを付けます。リンクの外側の画像altだけでは解消しません。',verify:'axeの再実行に加え、Tab移動と読み上げを確認。スライド複製、外部埋込みの読込み前後・失敗時も確認します。'};
  if(kind==='javascript')return {title:`JavaScript例外：${signature}`,impact:/jQuery/.test(signature)?'依存する処理の初期化が中断する可能性があります。カート等の実操作への影響は別途確認が必要です。':'例外が発生した処理の後続部分が中断します。サイト全体のJavaScript停止やレイアウト崩れとは断定できません。',admin:/jQuery/.test(signature)?'導入済みの高速化機能でjQueryの遅延・フッター移動設定があれば、テスト環境で一つずつ解除して読込み順を確認します。有効設定・原因プラグインは未確認です。':'管理画面の独自JS登録欄やコード挿入機能で対象処理を登録している場合、実行ページの条件を確認します。登録先は未確認です。',code:/jQuery/.test(signature)?'実際の出力順・通信結果・依存関係を調べ、依存ライブラリを先に実行。ライブラリを重複追加しません。':'スタックの出力元と対象DOM・実行時期を調べ、必要な要素の存在確認後に処理を開始します。存在しない要素や不適切なタイマーを修正します。',verify:'同じページ・画面幅・操作で例外が解消すること、関連する利用者操作が正常完了することを確認します。'};
  if(kind==='policy')return {title:`公開応答・転送方針の不一致：${signature}`,impact:'期待する公開・転送方針と応答が異なります。存在しないページのトップ転送では利用者がリンク切れを認識しにくくなります。',admin:'導入済みの公開制御・転送機能で該当パスのルールを確認します。存在しないURLの一括転送が原因ならそのルールを修正。観測値だけに合わせて期待値を変更しません。',code:'設定に原因がなければテーマ・プラグイン・サーバーの応答処理を確認。404の場合は案内ページだけでなくHTTPステータスも修正します。',verify:'証拠のパスで期待する応答を再検査し、正常ページと正当な転送が維持されることを確認します。'};
  return {title:`${kind}：${signature}`,impact:'この検査の期待条件を満たしていません。具体的な利用者影響は証拠と再現操作から追加確認が必要です。',admin:'対象ページ・ブロック・導入済み機能の設定で対応できるか確認。編集場所や原因設定は未特定です。',code:'設定で対応できない場合は失敗箇所を再現し、実装・テスト期待値・実行環境を切り分けます。',verify:'該当ケースを再実行し、関連ページ・画面幅・操作に副作用がないことを確認します。'};
}

export function selectReportRows(current,previous=[],includeHistory=false){
  const eligible=includeHistory?previous.filter(p=>p.runStatus==='finished'&&p.finishedAt&&p.configHash&&p.configHash===current.configHash&&p.baseURL===current.baseURL&&p.environment===current.environment&&p.startedAt<current.startedAt).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)):[];
  return current.rows.map(row=>{
    if(row.status==='not_run')for(const run of eligible){const old=run.rows.find(r=>r.id===row.id&&r.status!=='not_run');if(old)return {row:old,run};}
    return {row,run:current};
  });
}

export function reproduction({row,run,details=[]},kind,config={}){
  const id=row.id.slice(row.id.indexOf('.')+1);
  const visual=config.visuals?.find(v=>v.id===id);
  const page=config.pages?.find(p=>p.id===(visual?.pageId??id));
  const policy=config.policies?.find(p=>p.id===id);
  const d=details[0]??{};
  const target=d.url??d.data?.url??policy?.path??page?.path??d.path;
  let url='対象URLは証拠から特定できません。検査設定・トレースを確認してください。';
  try{if(target)url=new URL(target,run.baseURL).href;}catch{}
  const width=visual?.width??d.viewport?.windowWidth;
  const height=visual?.height??d.viewport?.windowHeight;
  const condition=`対象：${url} / 画面：${width?`${width}px${height?` × ${height}px`:''}`:'未記録（ケース名と証拠を参照）'} / 環境：${run.environment??'未記録'}`;
  const open=`対象URLをブラウザーで開く。既に開いている場合は再読み込みする。${width?`画面幅は${width}pxに設定する。`:''}`;
  if(kind==='javascript')return {condition,steps:['開発者ツールのConsoleを開き、既存のログを消す。',open,'ページの表示と画像・フォントの読込みを待ち、下までスクロールして画像を表示させ、先頭へ戻る。','Consoleで証拠と同じ例外メッセージ・スタックが出るか確認する。'],expected:'表示準備と画像スクロール中に未捕捉のJavaScript例外が発生しない。',actual:[...new Set(details.map(x=>x.message).filter(Boolean))].join('\n')||row.reason||'例外の詳細は未記録。',visible:'自動検査で確認したのは内部例外です。白画面・操作不能・ローディング表示が消えない等の見た目や操作上の症状は、この証拠だけでは確認できません。',limit:'保存済みテスト手順からの追試手順です。例外発生が読込み時かスクロール時かの厳密な時点は未特定です。クリック・購入・送信操作はこの検査に含まれません。'};
  if(kind==='color-contrast'||kind==='link-name')return {condition,steps:[open,'画像・フォントの読込み後、次の対象要素が見える位置までスクロールする：'+details.map(x=>JSON.stringify(x.target??[])).join(' / '),kind==='color-contrast'?'対象文字の前景色・背景色・文字サイズを確認し、axeでコントラストを再測定する。':'開発者ツールのアクセシビリティ情報で対象リンクの名前を確認し、axeのlink-name検査を実行する。'],expected:kind==='color-contrast'?'実際の文字サイズ・太さに対応したコントラスト基準を満たす。':'リンクに目的を判別できるアクセシブルな名前がある。',actual:details.map(x=>x.reason??'').filter(Boolean).join('\n')||row.reason||'判定の詳細は証拠を参照。',visible:kind==='color-contrast'?'配色の基準不足を測定済みです。利用者による読み取りづらさの実機評価は別途必要です。':'読み上げ名が不足しています。マウスでクリックできないという意味ではありません。',limit:'Tab移動やスクリーンリーダーによる実際の読み上げ確認は追加確認です。自動検査で実施した操作とは区別してください。'};
  if(kind==='policy')return {condition,steps:['開発者ツールのNetworkを開き、ログの保持を有効にする。',open,'最初のDocumentリクエストのHTTPステータスとLocationを確認する。最終ページのステータスだけで判断しない。'],expected:policy?.statuses?`HTTP ${policy.statuses.join(' / ')}${policy.location?`、転送先 ${policy.location}`:''}。その他の公開条件は検査設定に従う。`:'検査で定義した公開・応答方針を満たす（詳細は失敗理由を参照）。',actual:`観測HTTP：${d.status??'未記録'}\n${(d.errors??[]).join('\n')||row.reason||''}`,visible:'転送後の画面や利用者の操作結果は、HTTP応答だけから断定しません。',limit:'元の自動検査は転送を追跡しないHTTPリクエストです。上記はブラウザーで確認するための追試手順です。'};
  return {condition,steps:['ケースIDに対応する検査設定・操作モジュール・トレースを確認する。','記録された前提条件と操作を再現する。操作が未記録の場合は担当者に確認し、再現手順を補足する。'],expected:'このケースの定義済み期待条件を満たす。',actual:row.reason||'判定の詳細は証拠を参照。',visible:'具体的な画面挙動は未確認です。',limit:'この検査種別の具体的な操作は自動推定していません。'};
}

export function buildIssueReport({current,previous=[],includeHistory=false,readEvidence,readImage=()=>null,readConfig=()=>({}),notes=''}){
  const selected=selectReportRows(current,previous,includeHistory),groups=new Map(),warnings=[];
  const add=(kind,signature,entry,detail)=>{
    const key=JSON.stringify([kind,signature]);
    if(!groups.has(key))groups.set(key,{...advice(kind,signature),kind,cases:new Map()});
    const g=groups.get(key),id=`${entry.run.runId}/${entry.row.id}`;
    if(!g.cases.has(id))g.cases.set(id,{...entry,details:[]});
    g.cases.get(id).details.push(detail);
  };
  for(const entry of selected){
    const {row,run}=entry;if(row.status!=='fail')continue;
    let found=false;
    const evidence=(row.evidence??[]).filter(f=>/\/(axe|javascript|policy|audit|layout|links)-[^/]+\.json$/.test(f)||/^(axe|javascript|policy|audit|layout|links)\.json$/.test(f));
    for(const file of evidence){
      let data;try{data=readEvidence(run.runId,file);}catch{warnings.push(`${run.runId} / ${row.id}：証拠を読み取れませんでした（${file}）`);continue;}
      if(Array.isArray(data?.violations)){
        for(const v of data.violations)for(const n of v.nodes??[]){found=true;add(v.id,component(n),entry,{file,url:data.url,viewport:data.testEnvironment,rule:v.id,impact:v.impact,target:n.target,html:n.html,reason:n.failureSummary});}
      }else if(row.id.startsWith('javascript.')&&Array.isArray(data?.jsErrors)){
        for(const error of data.jsErrors){found=true;const message=typeof error==='string'?error:error.message;add('javascript',message,entry,{file,message,stack:error.stack,observation:data.observation});}
      }else if(row.id.startsWith('policy.')){found=true;add('policy',row.id,entry,{file,...data});}
      else if(data){found=true;add(row.id.split('.')[0],row.id.startsWith('page.')?'HTTP・メタ情報':row.title,entry,{file,data});}
    }
    if(!found)add(row.id.split('.')[0],row.title,entry,{reason:row.reason??'詳細証拠なし。原因未確定。'});
  }
  const issues=[...groups.values()],pending=selected.filter(({row})=>['review','not_run','blocked'].includes(row.status));
  const counts=Object.fromEntries(Object.keys(labels).map(s=>[s,selected.filter(x=>x.row.status===s).length]));
  const configs=new Map();
  const screenshotHTML=({row,run,details=[]})=>{
    const manifests=(row.evidence??[]).filter(f=>/marked-screenshots[^/]*\.json$/.test(f));
    const images=[];
    for(const manifest of manifests)try{
      const data=readEvidence(run.runId,manifest);
      for(const shot of data.shots??[]){
        if(!details.some(d=>d.rule===shot.rule&&JSON.stringify(d.target)===JSON.stringify(shot.target)))continue;
        if(shot.status!=='captured'){images.push(`<p>枠付き画像なし：${e(shot.reason)}</p>`);continue;}
        const file=(row.evidence??[]).find(f=>{const name=f.split('/').at(-1);return name===`${shot.id}.png`||name.startsWith(`${shot.id}-`)&&name.endsWith('.png');});
        const src=file&&readImage(run.runId,file);
        if(src&&/^data:image\/png;base64,/.test(src))images.push(`<figure><a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="指摘${e(shot.number)}：${e(shot.rule)}の対象箇所を赤枠で表示" style="max-width:100%;height:auto;border:1px solid #aaa" loading="lazy"></a><figcaption>赤枠・番号${e(shot.number)}：${e(JSON.stringify(shot.target))}<br>${e(shot.url)} / ${e(shot.viewport?.width)} × ${e(shot.viewport?.height)} / 撮影：${e(shot.capturedAt)}。検査後の対象要素に枠を重ねた画像です。</figcaption></figure>`);
        else images.push('<p>画像ファイルを読み取れませんでした。</p>');
      }
    }catch{images.push('<p>枠付き画像の台帳を読み取れませんでした。</p>');}
    if(!images.length){
      const file=(row.evidence??[]).find(f=>f.endsWith('.png')&&!f.includes('marked-'));
      let src;try{src=file&&readImage(run.runId,file);}catch{}
      if(src&&/^data:image\/png;base64,/.test(src))images.push(`<figure><img src="${src}" alt="失敗時の参考画面。指摘箇所の枠付けなし" style="max-width:100%;height:auto" loading="lazy"><figcaption>参考画面（枠付けなし）。内部例外・存在しない要素など、画面上の場所を特定できない問題をこの画像だけで判断しないでください。</figcaption></figure>`);
      else images.push('<p>該当箇所を示す画像は未取得です。新しい表示検査で取得してください。画面上に存在しない要素を推測で囲みません。</p>');
    }
    return `<details><summary>問題箇所のスクリーンショット</summary>${images.join('')}</details>`;
  };
  const reproHTML=(entry,kind)=>{
    if(!configs.has(entry.run.runId)){try{configs.set(entry.run.runId,readConfig(entry.run.runId));}catch{configs.set(entry.run.runId,{});}}
    const r=reproduction(entry,kind,configs.get(entry.run.runId));
    return `<h3>再現手順・期待結果・実際の挙動</h3><p>${e(r.condition)}</p><ol>${r.steps.map(s=>`<li>${e(s)}</li>`).join('')}</ol><p><b>期待される挙動：</b>${e(r.expected)}</p><p><b>実際の結果（保存済み証拠）：</b></p><pre>${e(r.actual)}</pre><p><b>画面・操作への影響の確認範囲：</b>${e(r.visible)}</p><p><b>手順の根拠・未確認事項：</b>${e(r.limit)}</p>`;
  };
  const caseHTML=({row,run,details=[]})=>`<details><summary>${e(row.title)} — ${e(row.id)}（${e(labels[row.status])}）${run.runId!==current.runId?'【過去結果】':''}</summary><p>出典：${e(run.runId)} / ${e(run.startedAt)}</p>${row.status==='fail'?screenshotHTML({row,run,details}):''}<pre>${e(row.reason??'')}</pre>${details.map(d=>`<pre>${e(JSON.stringify(d,null,2))}</pre>`).join('')}</details>`;
  const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(current.name)} 不具合報告書</title><style>body{font:16px/1.8 system-ui;color:#253347;max-width:1120px;margin:32px auto;padding:0 20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd6df;text-align:left;padding:10px;vertical-align:top}th{background:#edf2f7}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6f9;padding:12px}section{border-top:2px solid #dce4ed;margin-top:28px}details{border:1px solid #ccd6df;padding:12px;margin:12px 0}summary{cursor:pointer}a{color:#155ca2}.note{background:#fff5dc;padding:16px}h1,h2{line-height:1.5}@media print{body{font-size:11px}}</style></head><body>
  <h1>${e(current.name)}：不具合報告書</h1><p>対象：${e(current.baseURL)} / ${e(current.environment)}<br>選択した実行：${e(current.runId)} / ${e(current.startedAt)}<br>生成日時：${e(new Date().toISOString())} / 実行状態：${e(current.runStatus)}</p>
  <p><strong>不合格 ${counts.fail}ケース → 修正候補 ${issues.length}項目</strong>。同じルール・対象部品・例外メッセージをまとめています。共通の根本原因が確定した件数ではありません。</p>
  <p class="note">保存済み証拠からの自動整理です。利用者影響・修正方法は検査種別に基づく候補で、実際の管理設定・コードの原因は未確認です。管理画面での対応を先に試し、解消しない場合の実装確認を併記しています。本番修正や新しい検査は実施していません。JavaScriptの観測は表示準備と画像スクロールの範囲で、購入等の操作全体を保証しません。</p>
  <p>${includeHistory?'同一サイト・環境・設定ハッシュで選択日時より前に完了した履歴から、未実施ケースだけを補っています。過去結果には出典を表示します。再検査済みとは扱いません。':'選択した実行だけを対象にしています。過去結果は補っていません。'} 異なる設定の履歴や選択時点より後の結果は混ぜません。</p>
  <p>${Object.entries(counts).map(([k,v])=>`${labels[k]} ${v}`).join(' / ')}。これは報告対象の集計で、単一実行の新しい合否判定ではありません。</p>
  ${current.errors?.length?`<h2>実行エラー</h2><pre>${e(JSON.stringify(current.errors,null,2))}</pre>`:''}
  <table><thead><tr><th>項目</th><th>対象ケース数</th><th>管理画面での対応候補</th></tr></thead><tbody>${issues.map((g,i)=>`<tr><td><a href="#issue-${i+1}">${i+1}. ${e(g.title)}</a></td><td>${g.cases.size}</td><td>${e(g.admin)}</td></tr>`).join('')}</tbody></table>
  ${issues.map((g,i)=>`<section id="issue-${i+1}"><h2>${i+1}. ${e(g.title)}</h2><p><b>利用者への影響：</b>${e(g.impact)}</p><p><b>管理画面での修正候補：</b>${e(g.admin)}</p><p><b>設定で直らない場合：</b>${e(g.code)}</p><p><b>修正後の確認：</b>${e(g.verify)}</p><p>URL・画面幅別の再現手順と証拠を以下で展開できます。準備段階で停止した検査は、本来の判定に未到達の可能性があります。</p>${[...g.cases.values()].map(entry=>`<details><summary>再現手順：${e(entry.row.title)} — ${e(entry.row.id)}</summary>${reproHTML(entry,g.kind)}</details>${caseHTML(entry)}`).join('')}</section>`).join('')}
  <section><h2>未実施・要確認・実行不能（${pending.length}ケース）</h2><p>画像比較の基準未承認は画像の不具合とは別です。手動確認・未実施を合格に置き換えていません。</p>${pending.map(caseHTML).join('')}</section>
  ${warnings.length?`<section><h2>証拠の読取りに関する注意</h2><pre>${e(warnings.join('\n'))}</pre></section>`:''}
  ${notes.trim()?`<section><h2>担当者の補足（自動検証していない記載）</h2><pre>${e(notes.trim())}</pre></section>`:''}
  <section><h2>再検証と公開判断</h2><p>該当ケースの再実行、共通部品のPC・スマホ確認、購入・問い合わせ・メール等の関連する手動操作を実施してください。HTTP・JavaScript等の短い検査はCI候補、画像・axe・操作検査はQA工程の候補です。残存不合格と未確認事項を確認して公開判断を行います。この報告書はサイト全体の適合や公開を自動承認しません。</p></section></body></html>`;
  return {html,issueCount:issues.length,failedCases:counts.fail,counts,warnings};
}
