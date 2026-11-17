export function manualGuidance(row){
 const policy=/^manual\.(?:discovery-scope-|registration-scope)/.test(row.id);
 return policy?{owner:'案件担当が条件を決める',action:'お客さんとの取り決めと現在の設定を照合し、採用する条件・確認した資料・判断者を記録してください。取り決めが不明なら途中保存し、案件担当に確認してください。',done:'条件と判断の根拠を記録し、未確認の手順がなくなったら完了できます。'}:
 {owner:'チェック担当が画面や証拠を確認する',action:'「確認を進める」で手順を開き、対象ページ・端末・操作・結果を記録してください。',done:'各手順の結果と証拠を記録すると完了できます。不明な項目は途中保存できます。'};
}
