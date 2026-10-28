import {viewpoints} from './case-generator.js';

// Browser-safe envelope validation only. The server must also call validateConfig
// for each registered check's options, permissions and trusted adapter resolution.
export const automationCoverageIds=Object.freeze(viewpoints.map(([,key])=>'coverage-'+key));
export const automationKinds=Object.freeze(['wp-lifecycle','wp-scheduled','wp-authz','wp-cache','redirect','seo-page','seo-robots','seo-sitemap','performance-navigation','compatibility-screen','keyboard-sequence','browser-flow','mail-delivery','operation-drill','standard-public','site-interaction','discovered-public']);
const suites=new Set(viewpoints.map(([suite])=>suite));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function requireValue(ok,label){if(!ok)throw new Error('自動取得と追加条件：'+label);}
export function validateAutomationInput(value){
 if(value===undefined)return {useObservedBaselines:true,additionalChecks:[]};
 requireValue(object(value),'automation はオブジェクトで指定してください');
 requireValue(Object.keys(value).every(k=>['useObservedBaselines','additionalChecks'].includes(k)),'未対応の automation 項目があります');
 const {useObservedBaselines=true,additionalChecks=[]}=value;
 requireValue(typeof useObservedBaselines==='boolean','useObservedBaselines は真偽値で指定してください');
 requireValue(Array.isArray(additionalChecks),'additionalChecks は配列で指定してください');
 const seen=new Set();
 for(const check of additionalChecks){
  requireValue(object(check),'各検査はオブジェクトで指定してください');
  requireValue(Object.keys(check).every(k=>['id','title','suite','kind','options','required','timeoutMs'].includes(k)),'検査に未対応の項目があります（モジュールは登録できません）');
  requireValue(automationCoverageIds.includes(check.id)&&!seen.has(check.id),'id は既存の coverage-* IDを重複なく指定してください');seen.add(check.id);
  requireValue(automationKinds.includes(check.kind),check.id+' の kind は既存の実行可能な検査を指定してください');
  requireValue(suites.has(check.suite),check.id+' の suite が不正です');
  requireValue(object(check.options),check.id+' の options はオブジェクトで指定してください');
  requireValue(check.title===undefined||(typeof check.title==='string'&&!!check.title.trim()),check.id+' の title が不正です');
  requireValue(check.required===undefined||typeof check.required==='boolean',check.id+' の required は真偽値で指定してください');
  requireValue(check.timeoutMs===undefined||(Number.isInteger(check.timeoutMs)&&check.timeoutMs>=1000&&check.timeoutMs<=900000),check.id+' の timeoutMs は1000〜900000の整数で指定してください');
 }
 return structuredClone({useObservedBaselines,additionalChecks});
}

export const automationExamples=Object.freeze([
 {label:'通知メール・自動返信・受注通知',help:'送信と受信は同じ browser-flow の中で実行します。フォームの件名に今回の {{token}} を含め、waitForMail で同じ識別子・宛先・通数を照合してください。以下のパス・項目・ボタンは実サイトに合わせて変更します。source.url は受信確認API、source.headersEnv は認証の環境変数名です。単独の mail-delivery は別の contact journey と識別子を共有しません。使う場合は、その検査の識別子でメールを生成する仕組みが別途必要です。',check:{id:'coverage-notification',suite:'delivery',kind:'browser-flow',options:{steps:[{action:'goto',url:'/contact/'},{action:'fill',selector:'input[name="your-email"]',value:'qa@example.test'},{action:'fill',selector:'input[name="your-subject"]',value:'QA {{token}}'},{action:'fill',selector:'textarea[name="your-message"]',value:'QA {{token}}'},{action:'click',selector:'form.wpcf7-form input[type="submit"]'},{action:'waitForMail',source:{url:'http://127.0.0.1:8025'},expected:{to:'qa@example.test',subject:'QA {{token}}',count:1}}]}}},
 {label:'ロール・所有者ごとの権限',help:'wp-authz の role と expectedRoles、所有関係 ownership、読取・更新の許可／拒否を指定します。ロール認証は登録画面の「追加のロール認証」で登録できます。登録後の設定画面でも追加・変更できます。JSONにはパスワードを入れません。',check:{id:'coverage-roles',suite:'authz',kind:'wp-authz',options:{role:'subscriber',expectedRoles:['subscriber'],ownership:'other',readStatus:403,readCode:'rest_cannot_read',updateStatus:403,updateCode:'rest_cannot_edit'}}},
 {label:'更新・バックアップ復元',help:'operation-drill の adapter は起動時に登録された信頼済み別名です。モジュールパスは入力できません。更新は coverage-update / operation:update、復元は隔離環境を用意し、前後の実データと今回の識別子を照合します。',check:{id:'coverage-restore',suite:'operations',kind:'operation-drill',options:{adapter:'restore',operation:'restore',before:{url:'/qa-restore-proof',status:200,bodyIncludes:'before'},after:{url:'/qa-restore-proof',status:200,bodyIncludes:'restored {{token}}'}}}},
 {label:'会員操作・独自のブラウザー手順',help:'browser-flow の steps に実サイトの操作を指定し、assertText / assertURL / assertCount 等の明示的な期待値で終えます。roleEnv は保存済み認証の環境変数名です。例の表示確認だけで、他者データの拒否まで検証したことにはなりません。',check:{id:'coverage-membership',suite:'membership',kind:'browser-flow',options:{roleEnv:'WPQA_ROLE_SUBSCRIBER_STATE',steps:[{action:'goto',url:'/account/'},{action:'assertText',selector:'h1',value:'マイページ'}]}}},
 {label:'計測イベント・同意別の送信確認',help:'assertRequest は実際に完了したHTTPリクエストを数え、URLのoriginとパス・method・指定したquery/body各値を完全一致で照合します。指定していないパラメーターは無視します。bodyはJSONの直下の文字列・数値・真偽値・null、またはフォームの文字列に対応します。計測先・イベント名・セレクターを実サイトの仕様に置き換えてください。外部POSTは allowedInteractionOrigins と sandbox:true、操作許可が必要です。外部GETは allowedResourceOrigins に明示します。観測はフロー開始からの累計です。count:0 はtimeoutMs全体、正の回数は到着後settleMsまで重複を監視します。通信失敗・未完了は合格にしません。結果には件数だけを残し、本文は保存しません。これはブラウザーからの送信確認であり、計測サービス内の集計完了を保証しません。',check:{id:'coverage-analytics',suite:'delivery',kind:'browser-flow',options:{sandbox:true,allowedInteractionOrigins:['https://analytics.example.test'],steps:[{action:'goto',url:'/contact/'},{action:'click',selector:'#consent-reject'},{action:'assertRequest',url:'https://analytics.example.test/collect',method:'POST',body:{event:'contact_complete',consent:'granted'},count:0,timeoutMs:1000,settleMs:200},{action:'click',selector:'#consent-accept'},{action:'click',selector:'#send-analytics-test'},{action:'assertRequest',url:'https://analytics.example.test/collect',method:'POST',body:{event:'contact_complete',consent:'granted'},count:1,timeoutMs:5000,settleMs:500}]}}}
]);

export function createAutomationEditor(container){
 container.innerHTML=`<h3>自動取得と追加条件</h3><p>公開ページとログイン済み管理画面から、URL・管理設定・フォームの構造・検索やメニューの導線を取得します。取得できない連携先・権限・復元手順などの条件だけを追加してください。取得できなかった条件は未確認として残ります。</p><label class="check-line"><input type="checkbox" name="automation-useObservedBaselines" checked>取得した現在値を回帰検査の基準に使う</label><p>現在値は次回の変化を検出する基準です。仕様・公開方針が正しいことの承認にはなりません。入力済みの期待値と操作許可を優先します。</p><label>追加の検査条件（任意・JSON配列）<textarea name="automation-additionalChecks" rows="8" spellcheck="false" placeholder="[]"></textarea></label><p>空欄なら追加なし。例は自動登録されません。実際の対象・期待値に置き換えて必要な検査だけを配列に入れてください。パスワード・Cookie・認証ヘッダーは入力せず、保存済み認証の環境変数名を参照してください。この入力は登録画面の下書きにも保存されます。</p><p>性能予算は既存の performanceMs（トップページ読込の上限ms）を使います。未合意の予算は自動で決めません。書き込みを伴う検査には別途、検証環境での操作許可が必要です。</p>`;
 for(const {label,help,check} of automationExamples){
  const details=document.createElement('details'),summary=document.createElement('summary'),p=document.createElement('p');summary.textContent=label;p.textContent=help;details.append(summary,p);
  if(check){const pre=document.createElement('pre');pre.textContent=JSON.stringify([check],null,2);details.append(pre);}container.append(details);
 }
 const ids=document.createElement('details'),summary=document.createElement('summary'),p=document.createElement('p');summary.textContent='使用できる観点IDと検査種別';p.textContent='ID: '+automationCoverageIds.join(', ')+'。kind: '+automationKinds.join(', ');ids.append(summary,p);container.append(ids);
 const baseline=container.querySelector('[name="automation-useObservedBaselines"]'),checks=container.querySelector('[name="automation-additionalChecks"]');
 let original;
 function populate(value){original=validateAutomationInput(value);baseline.checked=original.useObservedBaselines;checks.value=original.additionalChecks.length?JSON.stringify(original.additionalChecks,null,2):'';}
 function read(){let additionalChecks;try{additionalChecks=JSON.parse(checks.value.trim()||'[]');}catch{throw new Error('追加の検査条件は正しいJSON配列で入力してください');}return validateAutomationInput({useObservedBaselines:baseline.checked,additionalChecks});}
 function changed(){return JSON.stringify(read())!==JSON.stringify(original);}
 populate();return {populate,read,changed};
}




