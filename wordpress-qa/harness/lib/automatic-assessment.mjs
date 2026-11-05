export function contactImpactObservations(data){
 if(data?.area!=='contact-retry'||data.network?.forwardedWrites!==0||(!Number.isSafeInteger(data.network?.feedbackAttempts)||data.network.feedbackAttempts<2))return [];
 return (Array.isArray(data.observations)?data.observations:[]).filter(o=>o.schema==='wpqa-contact-impact-v1'&&o.delivery==='intercepted'&&o.scope==='single-form-network-failure'&&Number.isSafeInteger(o.formId)&&o.formId>0&&typeof o.path==='string'&&/^\/[^?#]*$/.test(o.path)&&Array.isArray(o.attempts)&&o.attempts.length===2&&o.attempts.every((a,i)=>a.attempt===i+1&&a.requestBlocked===true&&a.feedbackVisible===false&&a.retryEnabled===true&&a.inputsRetained===true&&a.formVisible===true&&a.reportedSuccess===false)).map(o=>({key:'interaction:feedback-missing:'+o.path+':'+o.formId,category:'contact-feedback',label:'通信失敗時のフォーム通知欠落'}));
}

export function blockedRetryObservations(data){
 if(data?.area!=='contact-retry'||data.network?.forwardedWrites!==0||data.network?.feedbackAttempts!==1)return [];
 return (Array.isArray(data.observations)?data.observations:[]).filter(o=>o.schema==='wpqa-contact-impact-v1'&&o.delivery==='intercepted'&&o.scope==='single-form-network-failure'&&Number.isSafeInteger(o.formId)&&o.formId>0&&typeof o.path==='string'&&/^\/[^?#]*$/.test(o.path)&&Array.isArray(o.attempts)&&o.attempts.length===2&&o.attempts.every((a,i)=>a.attempt===i+1&&a.clickCompleted===true&&a.requestBlocked===(i===0)&&a.feedbackVisible===false&&a.formVisible===true&&a.inputsRetained===true&&a.reportedSuccess===false)).map(o=>({key:'interaction:retry-blocked:'+o.path+':'+o.formId,category:'contact-retry-blocked',label:'通信失敗後のフォーム再操作不能'}));
}
