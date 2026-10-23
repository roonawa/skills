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
export function guidance({config,row,env={},changed=false,managed=false}){
 const check=row.id.startsWith('check.')?(config.checks??[]).find(c=>'check.'+c.id===row.id):null;
 const admin=row.id.startsWith('admin.')?(config.admin??[]).find(c=>'admin.'+c.id===row.id):null;
 const issues=preflight({...config,checks:check?[check]:[],admin:admin?[admin]:[]},env).issues;
 const missing=issues.map(i=>i.message),steps=[];
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
 return {missing,steps:[...new Set(steps)],changed,location:managed?'「設定を編集」':'このサイトは起動時の設定ファイルで管理されています。設定ファイルを編集するか、「サイトを登録」で実サイト用設定を作成してください。',scope:'現在の設定に基づく案内です。認証成功・接続成功・検査合格は再実行で確認します。'};
}
