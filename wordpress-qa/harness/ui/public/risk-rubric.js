// Shared by server, browser and exported reports. Changes require a new version.
export const rubricVersion='site-exam-risk-2';
export const riskAxes=[
 {name:'影響度（CIA・業務継続性）',levels:[
 '装飾・表記の不整合。情報取得や操作の完了を妨げない。',
 '補助情報の欠落・操作の不便。通常の代替手順で目的を達成できる。',
 '特定の利用者が主要操作を完了できない、または限定的なデータ不整合。回避・回復が可能。',
 '主要操作の停止、個人情報の漏えい、重要データの改ざん。復旧・個別対応を要する。',
 '管理権限の奪取、秘密鍵・認証情報や大量の機密情報の漏えい、広範な破壊・全体停止。'
 ]},
 {name:'成立容易性（前提条件・再現性）',levels:[
 '特権と特殊な環境条件が両方必要。成立条件を具体的な証拠で限定できる。',
 '特権、複雑な手順、稀なタイミングのいずれかが必要。',
 '一般会員の権限、特定入力、特定端末など明確な条件で再現する。',
 '認証不要の通常操作で再現する。利用者の操作が必要。',
 '通常の閲覧だけで毎回発生、または認証・利用者の協力なく容易に成立する。'
 ]},
 {name:'影響範囲（資産・利用者）',levels:[
 '単一の補助ページ・単一レコードに限定され、他への波及がない。',
 '単一の主要導線、または限定された利用者・データ群。',
 '複数の主要導線、共通部品、または広範な利用者・データ群。',
 'サイト全体、全利用者、または他システムへ波及する。'
 ]}
];
export const riskMatrix=[[1,2,3,4,5],[6,8,10,12,15],[16,20,25,30,35],[40,45,50,55,60],[65,70,75,80,85]];
export function calculateRisk(scores){
 if(scores===null)return null;
 if(!Array.isArray(scores)||scores.length!==3||scores.some((v,n)=>!Number.isInteger(v)||v<1||v>riskAxes[n].levels.length))throw Error('採点の内訳が範囲外です');
 return riskMatrix[scores[0]-1][scores[1]-1]+[0,5,10,15][scores[2]-1];
}
export const riskDescription='SITE EXAM独自の対応優先度（CVSSではありません）。影響度×成立容易性の固定マトリクスに、範囲補正0／5／10／15を加算します。80以上＝重大、50～79＝高、20～49＝中、1～19＝低。実行不能・未知は0点に換算しません。課題の件数・URL数だけで影響範囲を決めず、同じ症状を同一原因とは断定しません。最高点は検出済み課題の優先度であり、サイトの安全性評価ではありません。';
export function rubricText(){return riskDescription+'\n'+riskAxes.map(a=>a.name+'\n'+a.levels.map((s,n)=>`${n+1}: ${s}`).join('\n')).join('\n')+'\n影響度ごとのマトリクス（列＝成立容易性1～5）\n'+riskMatrix.map((r,n)=>`${n+1}: ${r.join(', ')}`).join('\n');}
