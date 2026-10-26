import fs from 'node:fs';
import {validateConfig} from './lib/config.mjs';
const base='../../debug-evidence/mannendo-staging/',file=base+'site.json',c=JSON.parse(fs.readFileSync(file));
const mappings={
 'coverage-inventory':['journey.coverage-all-links','CMSの全公開データと165URLの照合は未完了。'],
 'coverage-metadata':['page.*','title/description/OGP/構造化データの内容仕様が未確定。既存HTTP・canonical・lang検査とは別。'],
 'coverage-crawl':['policy.*','bot別の詳細ルールと全転送元の一覧は未確定。'],
 'coverage-admin-general':['admin.siteurl,admin.home,admin.timezone,admin.language','自動実行用の管理認証が未設定。日付・時刻書式の運用仕様も未確定。'],
 'coverage-admin-reading':['admin.indexing','自動実行用認証が未設定。トップ・投稿表示件数の仕様は未合意。'],
 'coverage-admin-permalink':['admin.permalinks','自動実行用認証が未設定。カテゴリ・タグURL変更の仕様は未合意。'],
 'coverage-admin-plugins':['admin.contact-recipient,admin.contact-autoreply,admin.contact-reply-recipient,check.contact-mail-config-review','その他プラグインの必要設定・合否基準は未確定。'],
 'coverage-contact-errors':['journey.coverage-contact-validation,journey.coverage-customer-empty,journey.coverage-cart-limit','サーバー側必須入力と文字数境界の検査は未実装。同意・形式・数量制限とは分けて扱う。'],
 'coverage-visual-selection':['layout.*,javascript.*,axe.*,snapshot.*','代表7ページ×2幅を実装済み。長文・画像なし等の例外選定、表示完了条件の網羅性は未確認。'],
 'coverage-autoreply':['admin.contact-autoreply,admin.contact-reply-recipient','10月23日実査でメール(2)有効・返信先[contact-email]・添付欄なしを確認。受信API未接続のため到達確認不能。'],
 'coverage-order':['journey.bank-operation,journey.coverage-cart-limit,journey.coverage-customer-empty','銀行振込注文1036の完了は10月23日の証拠あり。送料の地域別分岐・在庫競合などは未実装。']
};
for(const [id,[refs,gap]]of Object.entries(mappings)){const x=c.checks.find(x=>x.id===id);x.options.instructions=`実装・証拠の対応先: ${refs}。残る検査: ${gap} 詳細はcoverage-evidence/coverage-links.json。`;}
const submitted='2026-10-23T05-57-42-899Z-3cb87f5c';
const contact=c.checks.find(x=>x.id==='coverage-contact-success');contact.kind='human-review';contact.title='フォーム正常送信（10月23日の実施証拠照合）';contact.options.instructions=`${submitted} のjourney.contact-operationとFlamingo2593を照合。入力から完了・本文保存の範囲。メール到達はcoverage-notification/autoreplyで別判定。現在の再送信成功とは扱わない。`;
if(!c.checks.some(x=>x.id==='order-completed-evidence'))c.checks.push({id:'order-completed-evidence',title:'銀行振込注文完了（10月23日の実施証拠照合）',suite:'commerce',kind:'human-review',required:true,options:{instructions:`${submitted} のjourney.bank-operationと受注1036を照合。金額1466円・銀行振込・完了画面。送料全分岐や通知到達は対象外。`}});
if(!c.journeys.some(x=>x.id==='coverage-menu-navigation'))c.journeys.push({id:'coverage-menu-navigation',title:'スマホメニューから問い合わせへ到達',module:'operations/coverage-menu-navigation.mjs',required:true,reason:'390pxでメニューを開き問い合わせリンクを押し、URLと入力欄を確認。送信なし。'});
const nav=c.checks.find(x=>x.id==='coverage-navigation');nav.kind='human-review';nav.options.instructions='journey.coverage-search-product/search-empty/search-special/menu/menu-navigationの同日の再検査で各ケースの最新実行結果を照合。すべて合格の場合に限りこの範囲の合格を記録。フォーム検証はcoverage-contact-errorsで別判定。';
if(!c.checks.some(x=>x.id==='staging-robots-disallow'))c.checks.push({id:'staging-robots-disallow',title:'テスト環境のrobots：全クローラーに巡回禁止を指示',suite:'seo',kind:'seo-robots',required:true,options:{path:'/robots.txt',rules:[{userAgent:'*',directive:'disallow',value:'/'}]}});
c.checks.find(x=>x.id==='coverage-crawl').options.instructions+=' check.staging-robots-disallowで検索非公開方針に基づくDisallow: /を検証。';
validateConfig(c);fs.writeFileSync(file,JSON.stringify(c,null,2));
fs.writeFileSync(base+'coverage-evidence/coverage-links.json',JSON.stringify({updatedAt:new Date().toISOString(),mappings,submittedRun:submitted,notes:'部分的な実施証拠は残りの検査の合格を意味しない。'},null,2));
console.log('Linked coverage configuration saved');

