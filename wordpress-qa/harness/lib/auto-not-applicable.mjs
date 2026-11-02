// ツールが自動で対象外にしてよい検査の範囲。これ以外の検査は自動の対象外にできない。
export const ORDER_CHECKS=['coverage-order','coverage-order-record','coverage-order-cleanup','coverage-order-notification'],MEMBERSHIP_CHECKS=['coverage-membership'],PRODUCTION_CHECKS=['coverage-publishing','coverage-cache','coverage-scheduled','coverage-contact-success'];
export const autoNotApplicableAllowed=(id,environment)=>ORDER_CHECKS.includes(id)||MEMBERSHIP_CHECKS.includes(id)||environment==='production'&&PRODUCTION_CHECKS.includes(id);
