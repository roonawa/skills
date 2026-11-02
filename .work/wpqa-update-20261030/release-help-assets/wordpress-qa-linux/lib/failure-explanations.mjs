import {advice} from './issue-report.mjs';

// Group observed mismatches, never infer a shared root cause from a test title.
export function explainFailure(row, evidence=[]) {
  if(row.status!=='fail')return [];
  const found=new Map();
  const add=(key,title,actual,admin,impact='期待する状態と異なります。対象ページと証拠で影響を確認してください。',code='設定で解消しない場合は、出力元のテーマ・プラグインと検査の期待値を確認します。')=>found.set(key,{key,title,actual,admin,impact,code,verify:'同じ検査を再実行し、対象ページと関連する操作を確認してください。'});
  const message=(error)=>{
    const m=/indexable differs from expectation \((true|false)\)/.exec(error);
    if(m){const publicExpected=m[1]==='true';add('indexable:'+m[1],publicExpected?'公開を期待するページに検索除外の指定があります':'検索除外を期待するページに noindex の指定がありません',publicExpected?'期待：検索対象にできる状態。取得結果：noindex または none を検出。':'期待：検索対象にしない状態。取得結果：robotsメタ情報・HTTPヘッダーで noindex / none を検出できませんでした。',`WordPress「設定 → 表示設定 → 検索エンジンでの表示」で「検索エンジンがサイトをインデックスしないようにする」を${publicExpected?'オフ':'オン'}にする方針か確認します。ページ単位のSEO設定も確認し、変更後にキャッシュを更新します。サイトの公開方針が期待値と違う場合は、QAの期待値を修正します。`,'検索エンジンへの公開方針との不一致です。実際に検索結果へ掲載されているかは、この検査だけでは分かりません。');return;}
    const fields={title:['ページタイトルが空か、期待値と違います','対象ページの編集画面のタイトルと、SEO機能のタイトル設定を確認します。'],description:['検索用の説明文が期待値と違います','対象ページのSEO設定でメタディスクリプションを確認します。'],canonical:['正規URL（canonical）が期待値と違います','対象ページのSEO設定の正規URLと「設定 → パーマリンク」を確認します。'],lang:['ページの言語指定が期待値と違います','「設定 → 一般 → サイトの言語」と多言語機能の設定を確認します。']};
    for(const [field,[title,admin]] of Object.entries(fields))if(error.startsWith(field+' ')){add('metadata:'+field,title,title+'。ページごとの期待値は証拠の検査設定を参照してください。',admin);return;}
    add('error:'+error,'応答・設定の検査条件を満たしていません',error,'証拠の期待値と取得結果を照合し、対象ページまたは該当機能の設定を確認します。修正箇所は未特定です。');
  };
  for(const data of evidence){
    if(!data||typeof data!=='object')continue;
    for(const error of Array.isArray(data.errors)?data.errors:[])if(typeof error==='string')message(error);
    for(const err of Array.isArray(data.jsErrors)?data.jsErrors:[]){const text=typeof err==='string'?err:err?.message;if(!text)continue;const a=advice('javascript',text);add('javascript:'+text,'JavaScriptの処理中にエラーが発生しています',/Cannot set properties of null/.test(text)?'対象要素を取得できない状態で値を設定しようとして例外が発生しました。どの処理かは詳細ログで確認してください。':text,a.admin,a.impact,a.code);}
    for(const v of Array.isArray(data.violations)?data.violations:[]){if(!v?.id)continue;const a=advice(v.id);const names={'color-contrast':'文字と背景のコントラストが不足しています','link-name':'リンクの読み上げ名がありません','image-alt':'画像の代替テキストがありません','label':'入力欄に読み上げ用のラベルがありません','button-name':'ボタンの読み上げ名がありません'};add('axe:'+v.id,names[v.id]??'アクセシビリティ基準を満たしていません',names[v.id]??`${v.id}: ${v.help??''}`,a.admin,a.impact,a.code);}
  }
  const reason=(row.reason??'').replace(/\x1b\[[0-9;]*m/g,'');
  if(!found.size&&row.setting)add('setting:'+row.id+':'+JSON.stringify(row.setting.expected),'管理画面の設定が期待値と違います',`期待値：${JSON.stringify(row.setting.expected)} / 取得値：${JSON.stringify(row.setting.actual)}`,row.id==='admin.indexing'?'「設定 → 表示設定 → 検索エンジンでの表示」の検索除外チェックを確認します。この検査の true は検索除外する状態、false は除外しない状態です。公開方針に合わせて設定またはQAの期待値を見直します。':`管理画面の対象設定を確認します（取得先：${row.setting.path??row.setting.source??'証拠を参照'}）。意図した運用方針と照合してから変更してください。`);
  if(!found.size&&/wpcf7-response-output/.test(reason)&&/hidden/.test(reason))add('cf7:feedback-hidden','フォームの結果メッセージが表示されませんでした','結果メッセージの領域が、待機時間内に表示状態になりませんでした。失敗した操作の条件はケースの証拠で確認できます。','「お問い合わせ → 対象フォーム → メッセージ」で結果案内の文言を確認します。文言が設定済みでも表示されない場合は、テーマのCSS・独自JS・CF7の通信エラー処理を確認してください。','利用者が送信結果を判断できず、再送信や離脱につながる可能性があります。');
  if(!found.size){
    const matches=reason.match(/indexable differs from expectation \((?:true|false)\)/g);if(matches)matches.forEach(message);
    else if(/Timeout|timed out/i.test(reason))add('timeout:'+row.id,'制限時間内に読込み・操作が完了しませんでした','待機時間を超過しました。サイト停止や処理の遅延が原因とは、まだ断定できません。','対象ページが管理画面からプレビューできるか確認し、同じ操作を再実行します。継続する場合は通信・サーバー・ブラウザーの記録を確認します。');
    else add('unclassified:'+row.id,'期待する結果と一致しませんでした（原因の追加確認が必要）',row.setting?`期待値：${JSON.stringify(row.setting.expected)} / 取得値：${JSON.stringify(row.setting.actual)}`:'この証拠から自動で原因を特定できませんでした。詳細ログの期待値・取得値を確認してください。','管理画面で変更する項目は未特定です。対象の検査手順・証拠と期待値を確認してから対応します。');
  }
  return [...found.values()];
}

export function enrichFailures(report,readEvidence){
  return {...report,rows:report.rows.map(row=>{
    if(row.status!=='fail')return row;
    const evidence=[];
    for(const file of row.evidence??[])if(/(?:^|\/)(?:audit|axe|javascript|policy|layout|links)(?:-[^/]*)?\.json$/.test(file))try{evidence.push(readEvidence(file));}catch{}
    return {...row,failures:explainFailure(row,evidence)};
  })};
}
