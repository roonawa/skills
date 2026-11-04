// ツールが自動で対象外にしてよい検査の範囲。これ以外の検査は自動の対象外にできない。
export const ORDER_CHECKS=['coverage-order','coverage-order-record','coverage-order-cleanup','coverage-order-notification'],MEMBERSHIP_CHECKS=['coverage-membership'],PRODUCTION_CHECKS=['coverage-publishing','coverage-cache','coverage-scheduled','coverage-contact-success'];
export const autoNotApplicableAllowed=(id,environment)=>ORDER_CHECKS.includes(id)||MEMBERSHIP_CHECKS.includes(id)||environment==='production'&&PRODUCTION_CHECKS.includes(id);
// 注文・会員は、まだ設定されていない検査（unconfigured・human-review）だけを自動の対象外にする。設定済みの検査は実行する。本番の投稿・送信は常に対象外。
export const autoJudgeable=(check,environment)=>environment==='production'&&PRODUCTION_CHECKS.includes(check.id)||(ORDER_CHECKS.includes(check.id)||MEMBERSHIP_CHECKS.includes(check.id))&&['unconfigured','human-review'].includes(check.kind);
// 保存済みの自動の対象外のうち、一覧（catalog）と同じ規則で有効なもの。
export const storedNotApplicable=config=>Object.fromEntries((config.checks??[]).filter(c=>autoJudgeable(c,config.environment)&&config.autoNotApplicable?.[c.id]).map(c=>[c.id,config.autoNotApplicable[c.id]]));
