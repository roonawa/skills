import {preflight} from './preflight.mjs';
const recipes={
 publishing:['wp-lifecycle','管理者のREST認証とWordPressログインを登録する。検証環境でテストデータ変更を許可する。'],
 authz:['wp-authz','管理者と検査するロールのREST認証を登録する。期待ロール、所有関係、読取・更新のHTTP状態と拒否コードを設定する。'],
 cache:['wp-cache','管理者REST認証とWordPressログインを登録する。一覧・検索URLと、必要なロールのログイン・非公開閲覧可否を設定する。本番相当のキャッシュ環境を使う。'],
 scheduled:['wp-scheduled または operation-drill','予約公開なら管理者REST認証、公開までの時間と待機時間を設定する。定期処理ならcron用アダプターと実行前後の期待値を登録する。'],
 operations:['operation-drill','更新／復元を実行する信頼済みアダプターを起動時に登録し、その別名、処理種別、実行前後の検証URL・HTTP状態・期待文字列を設定する。復元には隔離環境とバックアップを用意する。'],
 delivery:['browser-flow または mail-delivery','対象URL、フォーム入力・送信手順、送信後の期待表示を設定する。配送確認にはメールAPI、宛先・件名・通数と相関ID {{token}} を設定する。'],
 performance:['performance-navigation','対象パス、測定回数、cold／warm条件、許容ロード時間・リソース数・転送量を設定する。'],
 compatibility:['compatibility-screen','対象パス、ブラウザー、画面幅・高さ、表示されるべき要素を設定する。対象ブラウザーを実行PCへインストールする。'],
 seo:['seo-page / seo-robots / seo-sitemap / redirect','確認する種類を選び、対象パスと正しいcanonical・OGP・robotsルール・サイトマップ掲載URL・転送先などの期待値を設定する。必要な種類ごとに検査を追加する。'],
 accessibility:['keyboard-sequence または human-review','自動検査は対象パスとキー操作ごとのフォーカス先を設定する。実機・読み上げは手動確認へ切り替え、手順・実施環境・証拠を記録する。'],
 commerce:['browser-flow','テスト決済環境、sandbox、入力・購入操作と注文結果の期待値を設定する。外部遷移・送信先のoriginを許可し、注文の後始末手順を用意する。'],
 membership:['browser-flow','ロール別ログインを登録し、ブラウザー認証名、対象URL、閲覧・操作手順と期待する表示／拒否結果を設定する。'],
 multilingual:['browser-flow','言語切替の操作手順と、切替後のURL・文言・langやhreflangの期待値を設定する。']
};
const inputs={
 publishing:['wp-lifecycle','対象・期待値（options JSON）','管理者認証と変更許可を設定。標準の投稿作成・更新・削除を検査する場合は {}。'],
 authz:['wp-authz','対象・期待値（options JSON）','role に登録済みロール名、expectedRoles に期待ロール、readStatus・updateStatus に期待HTTP状態、readCode・updateCode に拒否コードを入力。'],
 cache:['wp-cache','対象・期待値（options JSON）','一覧・検索URLと非公開記事の閲覧可否を設定します。ひな形だけでは運用条件は確定しません。'],
 scheduled:['wp-scheduled','対象・期待値（options JSON）','予約公開なら scheduleDelayMs（予約までの時間）と maxWaitMs（待機上限）をミリ秒で入力。例：120000、180000。'],
 operations:['operation-drill','対象・期待値（options JSON）','adapter に実行担当者が登録した別名、operation に update / restore / cron、before・after に検証URL・HTTP状態・期待文字列を入力。'],
 delivery:['mail-delivery または browser-flow','対象・期待値（options JSON）','メール到達なら source.url にテスト受信APIのURL、expected.to に宛先、subject に識別文字列 {{token}}、count に期待通数を設定。フォーム操作なら browser-flow の steps に操作と期待結果を設定。'],
 performance:['performance-navigation','対象・期待値（options JSON）','path に測定対象、samples に回数、cache に cold / warm、budgets に合意済みの上限を設定。例：durationMs: 3000 は3秒です。例の数値を合意済み値として使用しないでください。'],
 compatibility:['compatibility-screen','対象・期待値（options JSON）','path に対象、engine に chromium / firefox / webkit、viewport に width・height、visible に表示される要素のセレクターを入力。'],
 seo:['seo-robots / seo-sitemap / redirect','対象・期待値（options JSON）','robotsなら path と rules、サイトマップなら path と requiredUrls・excludedUrls、転送なら path・status・location を入力。複数種類を検査する場合は検査を追加してください。'],
 accessibility:['keyboard-sequence','対象・期待値（options JSON）','path と steps を設定。各操作の key（例：Tab）と focus（その操作後にフォーカスする要素のCSSセレクター）を入力。実際の操作順に合わせます。'],
 commerce:['browser-flow','対象・期待値（options JSON）','sandbox と steps を設定。テスト商品への移動・入力・注文確定・注文結果の確認と取消手順を用意します。実決済の情報は入力しません。'],
 membership:['browser-flow','対象・期待値（options JSON）','ロール別認証を登録し、steps に対象画面への移動と、許可・拒否される表示の検証を入力。'],
 multilingual:['browser-flow','対象・期待値（options JSON）','steps に言語切替の操作と assertURL / assertText / assertAttribute による切替後の期待値を入力。']
};
export function guidance({config,row,env={},changed=false,managed=false}){
 const check=row.id.startsWith('check.')?(config.checks??[]).find(c=>'check.'+c.id===row.id):null;
 const admin=row.id.startsWith('admin.')?(config.admin??[]).find(c=>'admin.'+c.id===row.id):null;
 const preparation=preflight({...config,checks:check?[check]:[],admin:admin?[admin]:[]},env);
 const issues=[...preparation.issues,...preparation.preparations];
 const missing=issues.map(i=>i.message),steps=[];
 if(check?.kind==='site-interaction')steps.push('登録・設定画面の「共通操作テスト」で、この検査のURL・対象要素・期待値を確認する。対象機能が存在しない場合は理由を記録して、その操作だけ選択を解除する。');
 if(check?.kind==='unconfigured'){
  missing.splice(0,missing.length,'検査方法が「unconfigured（未設定）」のため、実行する処理と期待値が未定義です。');
  const recipe=recipes[check.suite];if(recipe)steps.push('「機能・運用の検査」でID「'+check.id+'」を探し、検査方法を '+recipe[0]+' に変更する。','ひな形を入力し、'+recipe[1]);
  if(['publishing','authz','cache','scheduled','operations','delivery','commerce','membership'].includes(check.suite))steps.push('投稿・送信などデータを変更する検査は、検証用URLとテストアカウントを用意し、「テストデータの作成・変更を許可」を有効にする。本番URLの環境名だけを変更しない。');
 }
 for(const i of issues){
  if(i.message.includes('認証'))steps.push('認証設定で必要なREST認証またはWordPressログインを登録する。ロール別認証はロール名を指定し、検査の認証名と一致させる。');
  if(i.message.includes('変更の許可'))steps.push('本番と分離した検証用URLを使い、環境を「検証」または「ローカル」に設定して「テストデータの作成・変更を許可」を有効にする。本番URLの環境名だけを変更しない。');
  if(i.message.includes('アダプター'))steps.push('実行PCの担当者がアダプターを登録してUIを再起動する。設定画面には登録済みの別名を入力する。');
  if(i.message.includes('ブラウザー'))steps.push('実行PCで対象のPlaywrightブラウザーをインストールする（例: npx playwright install firefox）。');
 }
 const reason=String(row.reason??'');
 if(!changed&&check?.kind!=='unconfigured'){
  if(/authenticat|credential|storage.state|browser state|認証|401|403/i.test(reason))steps.push('前回は認証・権限関連のエラーがあります。登録済みでも期限切れや権限不足の可能性があるため、ログインし直し、REST認証と対象ユーザーの権限を確認する。');
  if(/transport|connect|timeout|ECONN|ENOTFOUND|接続|通信/i.test(reason))steps.push('前回の接続・通信エラーを確認する。対象URL、サイトの稼働、Basic認証、VPNや実行PCからの接続を確認する。');
  if(/redirect|canonical baseURL/i.test(reason))steps.push('対象サイトの転送先を確認し、HTTPS・www有無などを含む正式なURLを対象URLに設定する。');
  if(/cancel|interrupt|中断|停止/i.test(reason))steps.push('前回は停止・中断されています。実行情報の未回収データを確認し、必要なら回収してから再実行する。');
 }
 if(!check&&!admin)steps.push('この項目の実行ログを確認し、対象ページ・操作モジュール・実行PCのブラウザーや接続条件を確認する。');
 if(!missing.length)missing.push('現在の設定で、自動的に特定できる不足はありません。前回の実行不能が解消したかは再実行で確認してください。');
 if(!steps.length)steps.push('判定理由と実行ログを確認する。原因は設定だけでは特定できないため、記録されたエラーに対応して再実行する。');
 steps.push('設定を保存し「実行前の確認」を行ってから、この検査範囲を再実行する。保存だけでは過去の判定は変わりません。');
 const recipe=check&&inputs[check.suite];
 const fields=check?[{label:'項目名・ID',value:`${check.title??check.id}（${check.id}）`},{label:'検査方法',value:check.kind==='unconfigured'?(recipe?.[0]??'検査内容に対応する方法を選択'):check.kind},{label:recipe?.[1]??'対象・期待値（options JSON）',value:recipe?.[2]??'この検査に必要な対象URL・操作・期待する結果を入力してください。'}]:[];
 if(check?.options?.instructions)fields.push({label:'この項目固有の条件（こちらを優先）',value:check.options.instructions});
 if(check?.kind==='unconfigured')steps.splice(1,0,'「検査方法」を選択した後、「選択した検査方法のひな形を入力」を押す。次の入力欄の案内に従い、例のURL・値を実際の条件に置き換える。ひな形は未確認の入力例です。');
 return {missing,fields,target:check?{checkId:check.id}:null,external:check&&['operations','delivery','authz','membership'].includes(check.suite)?'メール受信API・ロール別アカウント・運用アダプターなどは、必要に応じて実行環境の担当者が準備します。設定画面への入力だけでは用意されません。':null,steps:[...new Set(steps)],changed,location:managed?check?`「設定を編集」→「機能・運用の検査」→「${check.title??check.id}」（ID: ${check.id}）`:'「設定を編集」':'このサイトは起動時の設定ファイルで管理されています。設定ファイルを編集するか、「サイトを登録」で実サイト用設定を作成してください。',scope:'現在の設定に基づく案内です。認証成功・接続成功・検査合格は再実行で確認します。'};
}
