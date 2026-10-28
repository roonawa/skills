import {randomUUID} from 'node:crypto';
const labels={discovery:'サイト情報の調査',input:'入力チェック',authentication:'認証状態確認',browser:'調査ブラウザー起動',gate:'サイト閲覧認証',public:'公開ページ取得',admin:'管理画面取得',urls:'公開URL一覧取得',plugins:'プラグイン一覧取得',generate:'テストケース生成',save:'設定・認証保存',register:'UIへの登録'};
export function registrationTrace(log=()=>{}){
 const diagnosticId=randomUUID();
 const emit=event=>{try{log({timestamp:new Date().toISOString(),diagnosticId,...event});}catch{console.error('Registration diagnostic log could not be written');}};
 return {diagnosticId,async step(stage,fn){
  const start=Date.now();emit({stage,result:'started'});
  try{const result=await fn();emit({stage,result:'completed',durationMs:Date.now()-start});return result;}
  catch(error){
   if(error.diagnosticId)throw error;
   const text=String(error.message),code=/Timeout|timed out/i.test(text)?'TIMEOUT':/閲覧パスワード/.test(text)?'SITE_PASSWORD':/認証|ログイン/.test(text)?'AUTHENTICATION':/EACCES|EPERM/.test(text)?'PERMISSION':/ENOSPC/.test(text)?'DISK_FULL':/net::|fetch failed|ECONN|ENOTFOUND/.test(text)?'CONNECTION':stage==='input'?'INVALID_INPUT':'FAILED';
   const help={TIMEOUT:'接続先が時間内に応答しませんでした。接続状況を確認して再試行してください。',SITE_PASSWORD:'サイト閲覧パスワードを確認してください。管理画面のパスワードとは別です。',AUTHENTICATION:'認証の有効期限と管理画面へのアクセス権を確認してください。',PERMISSION:'QAサーバーの保存先への書き込み権限を確認してください。',DISK_FULL:'QAサーバーのディスク空き容量を確認してください。',CONNECTION:'対象サイトへの接続に失敗しました。URLとネットワークを確認してください。',INVALID_INPUT:'入力項目と選択した操作の必須条件を確認してください。',FAILED:'診断IDを添えて管理者に確認してください。入力内容は保持しています。'}[code];
   emit({stage,result:'failed',code,durationMs:Date.now()-start});
   throw Object.assign(new Error(`【${labels[stage]||stage}】${help}（${code}／診断ID: ${diagnosticId}）`),{status:400,stage,code,diagnosticId});
  }
 }};
}
