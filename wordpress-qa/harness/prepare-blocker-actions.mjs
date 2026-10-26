import fs from 'node:fs';import {validateConfig} from './lib/config.mjs';
const base='../../debug-evidence/mannendo-staging/',file=base+'site.json',c=JSON.parse(fs.readFileSync(file));
const tasks=[['server-validation','問い合わせ：サーバー側の必須・形式検証'],['network-failure','問い合わせ：通信遮断時の復帰（実送信なし）'],['keyboard','問い合わせ：キーボードでの入力欄移動'],['firefox','Firefox：代表3ページの表示・横はみ出し'],['performance','性能：代表3ページの参考測定（基準判定なし）'],['public-discovery','公開画面：設定・適用機能・入力制約の調査']];
for(const [id,title]of tasks){fs.writeFileSync(base+`operations/gap-${id}.mjs`,`import {runGap} from './gap-cases.mjs';export const run=args=>runGap('${id}',args);\n`);if(!c.journeys.some(j=>j.id==='gap-'+id))c.journeys.push({id:'gap-'+id,title,module:`operations/gap-${id}.mjs`,required:true,reason:'実行不能の前提を調査・具体化する追加検査。観測ケースの合格は親チェック全範囲の合格を意味しない。'});}
const own=['metadata','crawl','contact-errors','contact-retry','analytics','order','visual-selection','browsers','keyboard','performance','membership','multilingual'].map(x=>'check.coverage-'+x);
const source=JSON.parse(fs.readFileSync(base+'runs/2026-10-26T00-53-31-710Z-linked-summary/results.json'));
const actions=source.rows.filter(r=>r.status==='blocked').map(r=>{
 const id=r.id,independent=own.includes(id);let required='QA実行用の管理画面認証。設定値は認証後にこちらで調査し、判断が必要な差分だけ確認する。';
 if(id.startsWith('check.')&&/notification|autoreply/.test(id))required='webinfo@ailesys.co.jp の対象テストメールを受信確認できる接続、または対象識別子の受信記録。パスワードの貼り付けは不要。';
 else if(id.includes('roles'))required='検証用ロール別アカウントまたは作成可能な管理セッション。権限の運用例外のみ確認。';
 else if(id.includes('restore'))required='復元してよい隔離環境とバックアップの指定。';
 else if(id.includes('update'))required='更新対象のバージョンと、更新・復元できる隔離環境の指定。';
 if(independent)required=({'check.coverage-performance':'測定は先行。最終合否には許容時間・対象回線等の基準が必要。','check.coverage-browsers':'Firefox検査は先行。最終的な対応端末範囲・実機確認が必要。','check.coverage-keyboard':'キーボード操作は先行。読み上げ実機での内容理解は別途確認。','check.coverage-contact-errors':'必須・形式・設定された文字数制約は先行実装。業務独自の文字制限がある場合のみ仕様が必要。','check.coverage-contact-retry':'通信遮断の復帰を先行。サーバーの重複登録件数照合には管理認証が必要。'})[id]??'公開情報から適用機能・現状・整合性を調査。運用上の正しい文言や計測仕様、非該当の最終判断が必要な部分は別記。';
 return {id,title:r.title,category:independent?'こちらで先行可能（部分検査・調査）':'ユーザー側の認証・アクセス・環境指定が必要',required,previousReason:r.reason};
});
if(actions.length!==36||actions.filter(x=>own.includes(x.id)).length!==12)throw Error('Classification mismatch');
const mapping={'contact-errors':'server-validation','contact-retry':'network-failure','keyboard':'keyboard','browsers':'firefox','performance':'performance','metadata':'public-discovery','analytics':'public-discovery','visual-selection':'public-discovery','membership':'public-discovery','multilingual':'public-discovery'};
for(const [id,task]of Object.entries(mapping)){const check=c.checks.find(x=>x.id==='coverage-'+id);check.options.instructions+=' 追加調査・部分検査: journey.gap-'+task+'。残りの範囲を合格扱いせず、blocker-actions.jsonに担当・必要条件を明記。';}
validateConfig(c);fs.writeFileSync(file,JSON.stringify(c,null,2));fs.writeFileSync(base+'coverage-evidence/blocker-actions.json',JSON.stringify({createdAt:new Date().toISOString(),sourceRun:source.runId,userRequired:24,independent:12,actions},null,2));console.log('36 cases classified; 6 executable cases added');

