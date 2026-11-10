import {impactAssessments} from './impact-probes.mjs';
import {contactImpactObservations,blockedRetryObservations} from './automatic-assessment.mjs';
import {RULES} from './security-baseline-rules.mjs';

// Group observed mismatches, never infer a shared root cause from a test title.
export function explainFailure(row, evidence=[]) {
  if(row.status!=='fail')return [];
  const found=new Map();
  const add=(key,title,actual,admin,impact='期待する状態と異なります。対象ページと証拠で影響を確認してください。',code='設定で解消しない場合は、出力元のテーマ・プラグインと検査の期待値を確認します。',verify='同じ検査を再実行し、対象ページと関連する操作を確認してください。')=>found.set(key,{key,title,actual,admin,impact,code,verify});
  const message=(error)=>{
    const m=/indexable differs from expectation \((true|false)\)/.exec(error);
    if(m){const publicExpected=m[1]==='true';add('indexable:'+m[1],publicExpected?'公開を期待するページに検索除外の指定があります':'検索除外を期待するページに noindex の指定がありません',publicExpected?'期待：検索対象にできる状態。取得結果：noindex または none を検出。':'期待：検索対象にしない状態。取得結果：robotsメタ情報・HTTPヘッダーで noindex / none を検出できませんでした。',`WordPress「設定 → 表示設定 → 検索エンジンでの表示」で「検索エンジンがサイトをインデックスしないようにする」を${publicExpected?'オフ':'オン'}にする方針か確認します。ページ単位のSEO設定も確認し、変更後にキャッシュを更新します。サイトの公開方針が期待値と違う場合は、QAの期待値を修正します。`,'検索エンジンへの公開方針との不一致です。実際に検索結果へ掲載されているかは、この検査だけでは分かりません。');return;}
    const fields={title:['ページタイトルが空か、期待値と違います','対象ページの編集画面のタイトルと、SEO機能のタイトル設定を確認します。'],description:['検索用の説明文が期待値と違います','対象ページのSEO設定でメタディスクリプションを確認します。'],canonical:['正規URL（canonical）が期待値と違います','対象ページのSEO設定の正規URLと「設定 → パーマリンク」を確認します。'],lang:['ページの言語指定が期待値と違います','「設定 → 一般 → サイトの言語」と多言語機能の設定を確認します。']};
    for(const [field,[title,admin]] of Object.entries(fields))if(error.startsWith(field+' ')){add('metadata:'+field,title,title+'。ページごとの期待値は証拠の検査設定を参照してください。',admin);return;}
    add('error:'+error,'応答・設定の検査条件を満たしていません',error,'証拠の期待値と取得結果を照合し、対象ページまたは該当機能の設定を確認します。修正箇所は未特定です。');
  };
  for(const data of evidence){
    if(!data||typeof data!=='object')continue;
    for(const o of impactAssessments(data).filter(o=>o.title))add(o.key,o.title,o.observation,'対象ページの編集画面でタイトル・リンク先IDを確認します。言語指定は「設定 → 一般 → サイトの言語」とテーマの出力を確認してください。',o.scope);
    for(const o of blockedRetryObservations(data))add(o.key,'通信失敗後にフォームを再送信できません',o.label,'フォームのプラグイン更新・メッセージ設定を確認してください。通信失敗時の状態解除処理は技術担当者が検証環境で確認・修正してください。','通信失敗後に再操作しても送信処理が始まらず、問い合わせを完了できない可能性があります。');
    for(const o of contactImpactObservations(data))add(o.key,'通信失敗時にフォームの通知が表示されません',o.label,'お問い合わせフォームのメッセージ設定を確認してください。通知領域のCSS・通信失敗時のJavaScript処理は技術担当者が修正します。','通信失敗に気付けず再送信や離脱につながる可能性があります。入力保持と再操作可能は検査で確認しました。');
    if(data.schema==='software-security-v1'&&data.component==='compatibility'){
      for(const f of data.findings??[])add('compatibility:'+(f.asset?.type??'')+':'+(f.asset?.slug??'')+':'+f.title,f.title,(f.asset?.name??'')+' '+(f.asset?.version??'不明')+' / 移行先：PHP '+(data.target?.php??'不明')+'・WordPress '+(data.target?.wordpress??'不明')+' / 現在：PHP '+(data.current?.php??'不明')+'・WordPress '+(data.current?.wordpress??'不明')+' / 出典: '+(f.sources??[]).map(x=>x.url).join(' / '),f.fix,'PHP・WordPress本体を上げたあと、この機能が動かない・画面が崩れる・管理画面に入れなくなる可能性があります。今のサイトの動作には影響していません。','配布元が公開している動作要件との照合です。独自改変や有料版の対応状況は技術担当者が確認し、検証環境で本体・PHPを上げて動作を確かめてください。');
    }else if(data.schema==='software-security-v1'){
      for(const f of data.findings??[])add('security:'+data.component+':'+(f.asset?.slug??'')+':'+(f.cves?.join(',')||f.title),f.title,(f.asset?.name??'')+' '+(f.asset?.version??'不明')+' / '+(f.cves??[]).join(', ')+' / 出典: '+(f.sources??[]).map(x=>x.url).join(' / ')+(f.range?' / 影響条件: '+JSON.stringify(f.range):'')+(data.unknown?.length?' / 未確認: '+data.unknown.join(' / '):''),f.fix,'既知情報との照合結果です。攻撃の成立・侵害の発生は未実証です。稼働条件と修正適用状況を確認してください。','独自改変や配布元の修正適用がある場合は技術担当者が確認してください。');
    }
    if(data.schema==='security-baseline-v1')for(const f of data.findings??[]){const r=RULES[f.rule];if(r)add('baseline:'+f.rule+':'+f.path,r.title,f.observation,r.admin,r.impact,r.code,r.verify);}
    for(const error of Array.isArray(data.errors)?data.errors:[])if(typeof error==='string')message(error);
    for(const err of Array.isArray(data.jsErrors)?data.jsErrors:[]){const text=typeof err==='string'?err:err?.message;if(!text)continue;const a=advice('javascript',text);add('javascript:'+text,'JavaScriptの処理中にエラーが発生しています',/Cannot set properties of null/.test(text)?'対象要素を取得できない状態で値を設定しようとして例外が発生しました。どの処理かは詳細ログで確認してください。':text,a.admin,a.impact,a.code);}
    for(const v of Array.isArray(data.violations)?data.violations:[]){if(!v?.id)continue;const a=advice(v.id);const names={'frame-title':'埋め込みフレームの識別名がありません','scrollable-region-focusable':'スクロール領域にキーボードでフォーカスを移せません','color-contrast':'文字と背景のコントラストが不足しています','link-name':'リンクの読み上げ名がありません','image-alt':'画像の代替テキストがありません','label':'入力欄に読み上げ用のラベルがありません','button-name':'ボタンの読み上げ名がありません'};add('axe:'+v.id,names[v.id]??'アクセシビリティ基準を満たしていません',names[v.id]??`${v.id}: ${v.help??''}`,a.admin,a.impact,a.code);}
  }
  const reason=(row.reason??'').replace(/\x1b\[[0-9;]*m/g,'');
  if(!found.size&&row.setting)add('setting:'+row.id+':'+JSON.stringify(row.setting.expected),'管理画面の設定が期待値と違います',`期待値：${JSON.stringify(row.setting.expected)} / 取得値：${JSON.stringify(row.setting.actual)}`,row.id==='admin.indexing'?'「設定 → 表示設定 → 検索エンジンでの表示」の検索除外チェックを確認します。この検査の true は検索除外する状態、false は除外しない状態です。公開方針に合わせて設定またはQAの期待値を見直します。':`管理画面の対象設定を確認します（取得先：${row.setting.path??row.setting.source??'証拠を参照'}）。意図した運用方針と照合してから変更してください。`);
  if((!found.size||([...found.keys()].every(k=>k.startsWith('javascript:'))&&row.id.startsWith('check.')))&&/wpcf7-response-output/.test(reason)&&/hidden/.test(reason))add('cf7:feedback-hidden','フォームの結果メッセージが表示されませんでした','結果メッセージの領域が、待機時間内に表示状態になりませんでした。失敗した操作の条件はケースの証拠で確認できます。','「お問い合わせ → 対象フォーム → メッセージ」で結果案内の文言を確認します。文言が設定済みでも表示されない場合は、テーマのCSS・独自JS・CF7の通信エラー処理を確認してください。','利用者が送信結果を判断できず、再送信や離脱につながる可能性があります。');
  if(!found.size||([...found.keys()].every(k=>k.startsWith('javascript:'))&&row.id.startsWith('check.'))){
    const matches=reason.match(/indexable differs from expectation \((?:true|false)\)/g);if(matches)matches.forEach(message);
    else if(/Timeout|timed out/i.test(reason))add('timeout:'+row.id,'制限時間内に読込み・操作が完了しませんでした','待機時間を超過しました。サイト停止や処理の遅延が原因とは、まだ断定できません。','対象ページが管理画面からプレビューできるか確認し、同じ操作を再実行します。継続する場合は通信・サーバー・ブラウザーの記録を確認します。');
    else add('unclassified:'+row.id,'期待する結果と一致しませんでした（原因の追加確認が必要）',row.setting?`期待値：${JSON.stringify(row.setting.expected)} / 取得値：${JSON.stringify(row.setting.actual)}`:'この証拠から自動で原因を特定できませんでした。詳細ログの期待値・取得値を確認してください。','管理画面で変更する項目は未特定です。対象の検査手順・証拠と期待値を確認してから対応します。');
  }
  return [...found.values()];
}

export function enrichFailures(report,readEvidence){
  return {...report,rows:report.rows.map(row=>{
    const evidence=[];
    for(const file of row.evidence??[])if(/(?:^|\/)(?:impact|security|audit|axe|javascript|policy|layout|links|.*discovered-json|.*discovered)(?:-[^/]*)?\.(?:json|txt)$/.test(file))try{evidence.push(readEvidence(file));}catch{}
    return {...row,...(evidence.find(d=>d?.schema==='software-security-v1')?{softwareSecurity:evidence.find(d=>d?.schema==='software-security-v1')}:{}),...(row.status==='fail'?{failures:explainFailure(row,evidence)}:{})};
  })};
}

// 不合格の種類ごとの影響と対応の説明（もとは不具合報告書の一部）。
export function advice(kind,signature=''){
  if(kind==='security-baseline'&&Object.hasOwn(RULES,signature)){const r=RULES[signature];return {title:r.title,impact:r.impact,admin:r.admin,code:r.code,verify:r.verify};}
  if(kind==='color-contrast')return {title:`文字と背景のコントラスト不足：${signature}`,impact:'弱視の方や明るい場所で閲覧する方が、文字や案内を読み取りにくくなります。',admin:'テーマのカスタマイザーまたは対象ブロックの文字色・背景色を先に調整します。フッターなら「外観 → カスタマイズ → フッター」を確認。設定項目の有無はテーマによります。',code:'設定が反映されない場合は追加CSSまたは子テーマで対象要素に限定して調整。親要素の透過、重なり、hover・focus時も調べます。',verify:'証拠に記載された文字サイズ・太さに対応する比率を満たすことをPC・スマホで再測定します。'};
  if(kind==='link-name')return {title:`リンクの読み上げ名がない：${signature}`,impact:'スクリーンリーダー利用者がリンク先の目的を判別できません。通常クリックができないこととは別の問題です。',admin:'該当リンクを設置したブロック・ウィジェット・カスタムHTMLで目的が分かるリンク文言を設定。メインビジュアルの場合はテーマのスライド設定のボタンテキストを確認します。',code:'空のリンクが残る場合は、出力元でリンク自体にテキストまたはaria-labelを付けます。リンクの外側の画像altだけでは解消しません。',verify:'axeの再実行に加え、Tab移動と読み上げを確認。スライド複製、外部埋込みの読込み前後・失敗時も確認します。'};
  if(kind==='javascript')return {title:`JavaScript例外：${signature}`,impact:/jQuery/.test(signature)?'依存する処理の初期化が中断する可能性があります。カート等の実操作への影響は別途確認が必要です。':'例外が発生した処理の後続部分が中断します。サイト全体のJavaScript停止やレイアウト崩れとは断定できません。',admin:/jQuery/.test(signature)?'導入済みの高速化機能でjQueryの遅延・フッター移動設定があれば、テスト環境で一つずつ解除して読込み順を確認します。有効設定・原因プラグインは未確認です。':'管理画面の独自JS登録欄やコード挿入機能で対象処理を登録している場合、実行ページの条件を確認します。登録先は未確認です。',code:/jQuery/.test(signature)?'実際の出力順・通信結果・依存関係を調べ、依存ライブラリを先に実行。ライブラリを重複追加しません。':'スタックの出力元と対象DOM・実行時期を調べ、必要な要素の存在確認後に処理を開始します。存在しない要素や不適切なタイマーを修正します。',verify:'同じページ・画面幅・操作で例外が解消すること、関連する利用者操作が正常完了することを確認します。'};
  if(kind==='policy')return {title:`公開応答・転送方針の不一致：${signature}`,impact:'期待する公開・転送方針と応答が異なります。存在しないページのトップ転送では利用者がリンク切れを認識しにくくなります。',admin:'導入済みの公開制御・転送機能で該当パスのルールを確認します。存在しないURLの一括転送が原因ならそのルールを修正。観測値だけに合わせて期待値を変更しません。',code:'設定に原因がなければテーマ・プラグイン・サーバーの応答処理を確認。404の場合は案内ページだけでなくHTTPステータスも修正します。',verify:'証拠のパスで期待する応答を再検査し、正常ページと正当な転送が維持されることを確認します。'};
  return {title:`${kind}：${signature}`,impact:'この検査の期待条件を満たしていません。具体的な利用者影響は証拠と再現操作から追加確認が必要です。',admin:'対象ページ・ブロック・導入済み機能の設定で対応できるか確認。編集場所や原因設定は未特定です。',code:'設定で対応できない場合は失敗箇所を再現し、実装・テスト期待値・実行環境を切り分けます。',verify:'該当ケースを再実行し、関連ページ・画面幅・操作に副作用がないことを確認します。'};
}
