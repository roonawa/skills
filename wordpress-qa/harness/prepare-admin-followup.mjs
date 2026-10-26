import fs from 'node:fs';
const base='../../debug-evidence/mannendo-staging',file=base+'/site.json';
const c=JSON.parse(fs.readFileSync(file)),obs=JSON.parse(fs.readFileSync(base+'/coverage-evidence/admin-settings-observed.json'));
const notes={
general:'管理認証は確認済み。URL・タイムゾーン・言語はadminの4検査で判定。現状は日付Y年n月j日、時刻g:i A、週開始は月曜日。日本語サイトでも12時間表記が誤りとは断定できないため、日付・時刻・週開始の運用方針は要確認。',
reading:'管理認証は確認済み。検索非公開はadmin.indexingで判定。現状は固定ページ「トップページ」ID9、投稿ページ未指定、投稿28件、RSS10件・全文。トップページの指定先が選択肢の「トップページ」に対応することを追加検査。件数・RSSの運用方針は要確認。',
discussion:'管理認証は確認済み。現状は新規投稿のコメント・トラックバック受付ON、名前メール必須ON、会員限定OFF、全件手動承認OFF、過去承認済み投稿者の許可ON。承認なしで公開される条件がある。既存投稿には個別設定があるため一律の公開動作は保証しない。コメントを利用するか、全件承認が必要かを要確認。',
permalink:'管理認証は確認済み。/archives/%post_id%はadmin.permalinksで判定。カテゴリベース・タグベースは空欄。ベース変更や旧URLの転送要件は要確認。今回URL設定は変更していない。',
plugins:'管理認証は確認済み。CF7通知設定は既存admin3検査、注文・問い合わせ保存・閲覧保護で必要なWelcart/CF7/Flamingo/パスワード保護の有効状態を追加検査。その他プラグインの設定・競合・バックアップ復元は未検証。CF7設定警告の既存不合格は別途残す。'
};
for(const [key,instructions] of Object.entries(notes)){const row=c.checks.find(x=>x.id==='coverage-admin-'+key);row.kind='human-review';row.options={instructions:'【取得済み・方針確認待ち】'+instructions+' 証拠: coverage-evidence/admin-settings-observed.json。対応する自動検査の合否とは別判定。'};}
const shared={source:'browser',authenticatedSelector:'#wpadminbar',storageStateEnv:'WPQA_MANNENDO_ADMIN_STATE',required:true};
const extra=[{id:'front-page-reference',title:'固定トップページの参照先（トップページ選択肢との一致）',path:'/wp-admin/options-reading.php',selector:'#page_on_front option:checked',read:'text',expected:'トップページ'}];
for(const [id,plugin,name]of [['cf7','contact-form-7/wp-contact-form-7.php','Contact Form 7'],['welcart','usc-e-shop/usc-e-shop.php','Welcart e-Commerce'],['flamingo','flamingo/flamingo.php','Flamingo'],['site-gate','password-protected/password-protected.php','パスワード保護']]){
 if(!obs.observations.at(-1).plugins.some(p=>p.plugin===plugin&&p.name===name))throw Error('Plugin selector not observed');
 extra.push({id:'required-plugin-'+id,title:'必要プラグイン有効：'+name,path:'/wp-admin/plugins.php',selector:`tr.active[data-plugin="${plugin}"] .plugin-title strong`,read:'text',expected:name});
}
for(const a of extra){const i=c.admin.findIndex(x=>x.id===a.id);const value={...shared,...a};if(i<0)c.admin.push(value);else c.admin[i]=value;}
fs.writeFileSync(file,JSON.stringify(c,null,2));
const linksFile=base+'/coverage-evidence/coverage-links.json',links=JSON.parse(fs.readFileSync(linksFile));
for(const [key,note]of Object.entries(notes))links.mappings['coverage-admin-'+key]=[c.admin.filter(a=>key==='plugins'?a.id.startsWith('required-plugin-')||a.id.startsWith('contact-'):key==='general'?['siteurl','home','timezone','language'].includes(a.id):key==='reading'?['indexing','front-page-reference'].includes(a.id):key==='permalink'?a.id==='permalinks':false).map(a=>'admin.'+a.id).join(','),note];
links.updatedAt=new Date().toISOString();fs.writeFileSync(linksFile,JSON.stringify(links,null,2));
fs.writeFileSync(base+'/coverage-evidence/admin-expectation-basis.json',JSON.stringify({createdAt:new Date().toISOString(),notes,added:extra,basis:{'front-page-reference':'ECトップを固定トップページとして表示する既存サイト構成と、管理画面で識別したトップページの選択肢との整合性。表示件数の妥当性は別途確認。','required-plugin-cf7':'実施済みCF7フォーム送信テストの依存機能','required-plugin-welcart':'実施済み銀行振込注文テストの依存機能','required-plugin-flamingo':'実施済み問い合わせ2593の保存確認の依存機能','required-plugin-site-gate':'検証環境の閲覧パスワード保護の依存機能'},scope:'有効状態は機能全体の正常性を保証しない。観測値そのものを運用上の正解とは扱わない。'},null,2));
console.log(JSON.stringify({admin:c.admin.length,reviewGroups:Object.keys(notes)}));
