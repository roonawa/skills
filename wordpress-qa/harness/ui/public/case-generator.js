// Shared, deterministic coverage obligations. No network or site mutations.
export const viewpoints=[
  [
    "seo",
    "inventory",
    "URL母集団とリンク検査範囲",
    "CMS・サイトマップ・旧URLを照合し、孤立URLと除外理由を記録する。"
  ],
  [
    "seo",
    "metadata",
    "SEO期待値",
    "title/description/lang、canonical、検索公開可否、OGP、構造化データを仕様と照合する。"
  ],
  [
    "seo",
    "crawl",
    "robots・サイトマップ・転送",
    "bot別ルール、掲載/除外URL、404と転送先を設定する。"
  ],
  [
    "authz",
    "admin-general",
    "管理設定：一般",
    "サイトURL・タイムゾーン等の期待値をadminに登録する。"
  ],
  [
    "authz",
    "admin-reading",
    "管理設定：表示",
    "トップ・投稿ページ、検索公開設定の期待値をadminに登録する。"
  ],
  [
    "authz",
    "admin-discussion",
    "管理設定：コメント",
    "コメント受付・承認設定の期待値をadminに登録する。"
  ],
  [
    "authz",
    "admin-permalink",
    "管理設定：パーマリンク",
    "URL構造と公開ページの応答を照合する。"
  ],
  [
    "authz",
    "admin-plugins",
    "管理設定：プラグイン",
    "利用プラグインの設定と非機密の状態値を照合する。"
  ],
  [
    "delivery",
    "contact-success",
    "フォーム正常送信",
    "対象フォームごとに入力から完了までの操作と期待値を登録する。"
  ],
  [
    "delivery",
    "contact-errors",
    "入力エラー・境界値",
    "必須、形式、文字数、同意なし、添付制限を確認する。"
  ],
  [
    "delivery",
    "contact-retry",
    "二重送信・送信失敗",
    "連打、戻る、再送、通信失敗時の表示と登録件数を検査する。"
  ],
  [
    "delivery",
    "notification",
    "通知メール到達",
    "今回の識別子で宛先・件名・本文・通数を照合する。完了画面だけでは合格にしない。"
  ],
  [
    "delivery",
    "autoreply",
    "自動返信・添付",
    "適用要否、返信宛先、Cc/Bcc、添付、実配送の範囲を設定する。"
  ],
  [
    "delivery",
    "navigation",
    "検索・メニュー操作",
    "検索結果・該当なし・特殊文字、モバイル開閉と到達先を検査する。"
  ],
  [
    "delivery",
    "analytics",
    "計測・同意・reCAPTCHA",
    "適用要否とイベント・送信先・パラメーター・回数・同意別動作を設定する。"
  ],
  [
    "commerce",
    "order",
    "注文確定",
    "決済方式と金額、送料、数量・在庫・入力エラー、完了表示を別の期待値で検査する。"
  ],
  [
    "commerce",
    "order-record",
    "受注登録",
    "今回の識別子で受注明細・状態・金額を照合する。"
  ],
  [
    "commerce",
    "order-notification",
    "受注通知",
    "今回の注文の通知到着と内容を照合する。"
  ],
  [
    "commerce",
    "order-cleanup",
    "取消・後片付け",
    "今回作成した受注の取消と状態復元を確認する。過去の取消を流用しない。"
  ],
  [
    "compatibility",
    "visual-selection",
    "代表画面・表示完了条件",
    "テンプレート＋例外と選定理由、画面幅、主要内容の表示完了セレクターをvisualsに登録する。"
  ],
  [
    "compatibility",
    "browsers",
    "他ブラウザー・実機",
    "必要なブラウザー・端末・画面幅を決定し検査する。"
  ],
  [
    "accessibility",
    "keyboard",
    "キーボード・読み上げ",
    "フォーカス順・モーダル・入力・読み上げ・代替文の意味を確認する。"
  ],
  [
    "publishing",
    "publishing",
    "投稿・公開",
    "必要な投稿型ごとに下書き・更新・公開・非公開を検査する。"
  ],
  [
    "authz",
    "roles",
    "認可・機密保護",
    "ロール・所有者ごとの許可/拒否、nonceの実効性、公開エンドポイントの方針を検査する。"
  ],
  [
    "cache",
    "cache",
    "更新反映・非公開キャッシュ",
    "一覧・検索・匿名/ロール別に更新反映と情報漏れを検査する。"
  ],
  [
    "scheduled",
    "scheduled",
    "予約・定期処理",
    "予定前非公開・予定後公開と定期処理の結果を検査する。"
  ],
  [
    "operations",
    "update",
    "更新後の互換性",
    "コア・テーマ・プラグイン更新後に重要導線と表示を再検査する。"
  ],
  [
    "operations",
    "restore",
    "復元・監視",
    "隔離環境で復元内容・整合性・監視を確認する。"
  ],
  [
    "performance",
    "performance",
    "性能予算",
    "測定条件・予算を定め複数回評価する。"
  ],
  [
    "membership",
    "membership",
    "会員・データ分離",
    "適用要否、会員操作と他者データの拒否を設定する。"
  ],
  [
    "multilingual",
    "multilingual",
    "多言語",
    "適用要否、切替・翻訳・lang/hreflangを設定する。"
  ]
];
export function generateCases(input){
 const c=structuredClone(input);c.checks??=[];c.manual??=[];c.visuals??=[];
 for(const p of (c.pages??[]).slice(0,5)){
  p.links??=true;
  for(const [suffix,width,height] of [['pc',1280,900],['sp',390,844]]){
   if(!c.visuals.some(v=>v.pageId===p.id&&v.width===width)){
    let id=('generated-'+p.id).slice(0,55)+'-'+suffix;let n=1;
    while(c.visuals.some(v=>v.id===id))id=('generated-'+p.id).slice(0,50)+'-'+suffix+'-'+n++;
    c.visuals.push({id,pageId:p.id,width,height,ready:'body'});
   }
  }
 }
 const ids=new Set(c.checks.map(x=>x.id));
 for(const [suite,key,title,instructions] of viewpoints){const id='coverage-'+key;if(!ids.has(id))c.checks.push({id,title,suite,kind:'unconfigured',required:true,options:{instructions:instructions+' 対象・期待値が未確定のため実行前に設定してください。非該当は根拠と証拠を残し、手動判定で適用外にしてください。'}});}
 if(!c.manual.some(x=>x.id==='coverage-design'))c.manual.push({id:'coverage-design',title:'デザイン・文章・使いやすさ',required:true,reason:'担当者・対象・日時・操作・証拠を記録する。'});
 const paths=(c.pages??[]).slice(0,5).map(p=>p.path).filter(p=>typeof p==='string');
 if(c.baseURL&&paths.length){
  const auto=[['metadata','seo','SEO構造：title・lang・重複description・JSON-LD構文'],['navigation','delivery','ページ内リンクの参照先'],['forms','delivery','フォーム：宣言済み必須・メール形式（送信なし）'],['keyboard','accessibility','キーボード：Tab到達・不可視フォーカス'],['integrations','delivery','計測タグの検出・混在コンテンツ'],['multilingual','multilingual','多言語：宣言済みhreflangの構文・重複'],['performance','performance','性能の参考測定（予算判定なし）'],['crawl','seo','存在しないページの404応答']];
  for(const [area,suite,title] of auto)if(!c.checks.some(x=>x.id==='auto-'+area))c.checks.push({id:'auto-'+area,title,suite,kind:'standard-public',required:true,timeoutMs:300000,options:{area,paths:area==='crawl'||area==='performance'?paths.slice(0,1):paths}});
 }
 return c;
}

// Generated registration obligations only: never overwrite explicit custom checks.
export function linkRegistrationCoverage(input,profile={}){
 const c=structuredClone(input),covered=new Set();
 const journeys=new Set((c.journeys??[]).map(j=>j.id)),admin=new Set((c.admin??[]).map(a=>a.id));
 if(journeys.has('profile-inventory'))covered.add('inventory');
 if(['siteurl','home','timezone','language'].every(id=>admin.has(id)))covered.add('admin-general');
 if(admin.has('permalinks'))covered.add('admin-permalink');
 if(journeys.has('profile-post-lifecycle'))covered.add('publishing');
 if(journeys.has('profile-scheduled'))covered.add('scheduled');
 if(journeys.has('profile-contact-submit'))covered.add('contact-success');
 if(journeys.has('profile-bank-order'))for(const id of ['order','order-record','order-cleanup'])covered.add(id);
 if(profile.performanceMs)covered.add('performance');
 const residual={
  metadata:'自動検査はtitle/langと構造化データ構文を確認します。文章・SEO効果・OGP内容の妥当性は担当者が確認してください。',
  navigation:'ページ内参照先と内部リンクは自動検査します。検索語ごとの期待結果・メニューの開閉操作はサイト固有の検査設定が必要です。',
  'contact-errors':'宣言済みの必須・メール形式は自動検査します。独自JS、文字数・添付境界値、サーバー側検証はフォーム仕様の設定が必要です。',
  keyboard:'Tab到達は自動検査します。意味のあるフォーカス順、モーダル操作、読み上げの利用感は手動確認が必要です。',
  analytics:'タグの有無と混在コンテンツは自動調査します。イベント名・値・回数・同意別の期待値と送信先を設定してください。',
  multilingual:'宣言済みhreflangは自動検査します。多言語機能の要否、翻訳の意味と切替先は確認してください。',
  performance:'参考測定は自動実行します。性能の合否には登録画面で合意した上限msを指定してください。',
  crawl:'存在しないURLの404は自動検査します。robotsのbot別方針・サイトマップ掲載範囲・旧URL転送は期待値を設定してください。',
  'visual-selection':'代表ページ最大5件のPC・スマホ表示、画像読込、横はみ出し、axeは自動検査します。重要テンプレートや例外の選定漏れは確認してください。'
 };
 c.checks=c.checks.filter(row=>{
  if(row.kind==='unconfigured'&&row.id.startsWith('coverage-')&&covered.has(row.id.slice(9)))return false;
  const generated=['unconfigured','human-review'].includes(row.kind)&&/対象・期待値が未確定|登録時に自動確定できない範囲/.test(row.options?.instructions??'');
  if(!generated)return true;
  const key=row.id.replace(/^coverage-/,'');if(covered.has(key))return false;
  if(residual[key])row.options.instructions=residual[key];
  const human=['metadata','keyboard','multilingual','visual-selection'].includes(key);
  row.kind=human?'human-review':'unconfigured';
  return true;
 });
 return c;
}
