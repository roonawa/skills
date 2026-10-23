export function operationRequest(config,hash,id,data){
 const operation=config.journeys.find(j=>j.id===id&&j.explicitOnly);
 if(!operation)throw Error('登録済みの操作テストを選択してください');
 if(!['staging','local'].includes(config.environment)||!config.allowTestWrites)throw Error('操作テストには変更を許可した検証環境が必要です');
 if(data.configHash!==hash)throw Error('設定が変更されました。画面を開き直してください');
 if(data.confirmed!==true||!['preview','submit'].includes(data.mode))throw Error('対象と操作内容の確認が必要です');
 if(typeof (data.password??'')!=='string'||(data.password??'').length>1000)throw Error('パスワード入力が不正です');
 return {operation,env:{WPQA_OPERATION_ID:id,WPQA_OPERATION_MODE:data.mode,WPQA_SITE_PASSWORD:data.password??''}};
}
