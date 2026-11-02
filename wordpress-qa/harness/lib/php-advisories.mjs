import {compareVersions} from './security-inventory.mjs';

// Reviewed advisory snapshot, not an assertion that all PHP CVEs are covered.
const fixedByBranch={'8.2':'8.2.35','8.3':'8.3.36','8.4':'8.4.27','8.5':'8.5.12'};
export function phpAdvisory(version){
 const result={id:'ipa-20261022-php2shell',reviewedAt:'2026-10-30',sourceUpdatedAt:'2026-10-27',cves:['CVE-2026-109618','CVE-2026-109619'],sources:[{url:'https://www.ipa.go.jp/security/security-alert/2026/alert20261022.html',id:'IPA PHP2shell'},{url:'https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w',id:'CVE-2026-109618'},{url:'https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp',id:'CVE-2026-109619'}],status:'unknown',note:'PHP2shellについてのみ、確認済みのIPA情報で照合します。全PHP脆弱性の検査ではありません。'};
 if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))return {...result,message:'PHP2shell：正確な安定版バージョンを比較できません。配布元の修正状況を確認してください。'};
 const fixedVersion=fixedByBranch[version.split('.').slice(0,2).join('.')];
 if(fixedVersion){result.fixedVersion=fixedVersion;result.status=compareVersions(version,fixedVersion)<0?'affected-range':'fixed-range';}
 else if(compareVersions(version,'5.4.0')>=0&&compareVersions(version,'8.2.0')<0)result.status='legacy-risk';
 const risky=['affected-range','legacy-risk'].includes(result.status);
 result.message=result.status==='fixed-range'?`PHP2shell：当該系列の修正版 ${fixedVersion} 以上です（バージョン照合）。`:result.status==='affected-range'?`PHP2shell：影響バージョンに該当します。修正版は当該系列の ${fixedVersion} 以上です。`:result.status==='legacy-risk'?'PHP2shell：旧系列のため、少なくとも一方の脆弱性の影響が疑われます。配布元の修正状況を確認してください。':'PHP2shell：この系列は登録済みの判定範囲外です。公式情報を確認してください。';
 if(risky){result.title='PHP2shellの影響が疑われるPHPバージョンです';result.fix=`WordPress管理画面では通常更新できません。サーバー担当者・ホスティング管理画面で${fixedVersion?fixedVersion+'以上の修正版':'サポート中の対策済みPHP'}への更新を確認してください。配布元のバックポート修正がある場合は、パッケージ番号・告知を証拠として確認します。バックアップと検証環境での互換性確認後に更新し、PHPワーカーの再起動・再診断を行います。更新までのアクセス制限等はサーバー担当者と検討してください。バージョン一致だけで攻撃成立や侵害は断定しません。`;}
 return result;
}
