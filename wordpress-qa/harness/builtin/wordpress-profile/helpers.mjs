export function ensure(value, message) {
  if (!value) throw new Error(message);
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function json(value, label) {
  try { return JSON.parse(value); } catch { throw new Error(`BLOCKED: invalid ${label} JSON`); }
}
export function sameOrigin(value, base) {
  let url;
  try { url = new URL(value, base); } catch { throw new Error('BLOCKED: invalid URL'); }
  ensure(['http:', 'https:'].includes(url.protocol) && url.origin === new URL(base).origin && !url.username && !url.password, 'BLOCKED: URL must use the configured origin without credentials');
  return url;
}
export function readSettings(config, env = process.env) {
  const base = sameOrigin(config.baseURL, config.baseURL);
  ensure(base.pathname === '/' && !base.search && !base.hash, 'BLOCKED: baseURL must be an origin');
  const raw = json(env.WPQA_UI_PROFILE, 'profile');
  ensure(object(raw) && Object.keys(raw).every(k => ['adminPath','contactFormId','writes','timezone','language','indexable','permalink','maxPages','performanceMs','submit','testEmail','contactPath','contactNameField','contactEmailField','contactMessageField','contactConsentField','bankOrder','productPath','cartPath','customerPrefecture','bankPaymentLabel','expectedTotal'].includes(k)), 'BLOCKED: invalid profile');
  const profile = {adminPath:'/wp-admin/',contactFormId:null,writes:false,...raw};
  ensure(typeof profile.writes === 'boolean' && (profile.contactFormId === null || (Number.isSafeInteger(profile.contactFormId) && profile.contactFormId > 0)), 'BLOCKED: invalid profile fields');
  ensure(typeof profile.adminPath === 'string' && /^\/(?!\/)[a-zA-Z0-9_/-]+\/$/.test(profile.adminPath) && !profile.adminPath.includes('//'), 'BLOCKED: invalid adminPath');
  sameOrigin(profile.adminPath, base.href);
  const state = json(env.WPQA_UI_ADMIN_STATE, 'admin state');
  ensure(object(state) && Array.isArray(state.cookies) && Array.isArray(state.origins), 'BLOCKED: invalid admin state');
  // Do not carry cookies or local storage for unrelated sites into this context.
  for (const cookie of state.cookies) ensure(object(cookie) && typeof cookie.name === 'string' && typeof cookie.value === 'string' && typeof cookie.domain === 'string' && (base.hostname === cookie.domain.replace(/^\./,'') || base.hostname.endsWith('.'+cookie.domain.replace(/^\./,''))), 'BLOCKED: unrelated or invalid state cookie');
  for (const origin of state.origins) ensure(object(origin) && origin.origin === base.origin && Array.isArray(origin.localStorage), 'BLOCKED: unrelated or invalid state origin');
  return {profile,state,base};
}
export function requireWrites(config, profile) {
  ensure(['local','staging'].includes(config.environment) && config.allowTestWrites === true && profile.writes === true, 'BLOCKED: writes require staging/local, allowTestWrites=true and profile writes=true');
}
export function parseSettings(source, base) {
  const match = source.match(/(?:var\s+)?wpApiSettings\s*=\s*(\{[^;]+\})\s*;/);
  ensure(match, 'BLOCKED: wpApiSettings unavailable');
  const settings = json(match[1], 'REST settings');
  ensure(object(settings) && typeof settings.nonce === 'string' && /^[a-zA-Z0-9]+$/.test(settings.nonce) && typeof settings.root === 'string', 'BLOCKED: REST nonce/root unavailable');
  const root = sameOrigin(settings.root, base);
  ensure(!root.search && !root.hash && /^\/[a-zA-Z0-9_/-]+\/$/.test(root.pathname), 'BLOCKED: path-based REST root required');
  return {root:root.href,nonce:settings.nonce};
}
export function serverTime(date) {
  const time = typeof date === 'string' ? Date.parse(date) : NaN;
  ensure(Number.isFinite(time), 'BLOCKED: valid server Date required');
  return time;
}
export function scheduleAt(date) {
  return new Date(serverTime(date) + 120000).toISOString().replace(/\.\d{3}Z$/, '');
}
export function pageCount(value) {
  ensure(typeof value === 'string' && /^\d+$/.test(value), 'BLOCKED: invalid pagination metadata');
  const count = Number(value);
  ensure(Number.isSafeInteger(count) && count >= 0 && count <= 50, 'BLOCKED: inventory exceeds 50 pages per type');
  return count;
}
export function inventoryLinks(items, pages, base) {
  const key = value => { const u = sameOrigin(value,base); return (u.pathname.replace(/\/$/,'') || '/') + u.search; };
  const configured = new Set(pages.map(p => key(p.path)));
  const missing = [], missingLinks = [];
  for (const item of items) {
    if (typeof item.link !== 'string' || !item.link) { missingLinks.push(item.id); continue; }
    if (!configured.has(key(item.link))) missing.push({id:item.id,path:key(item.link)});
  }
  return {missing,missingLinks};
}
export function contactFields(form) {
  return [...form.matchAll(/\[([a-z][a-z0-9_-]*)(\*?)\s+([a-zA-Z0-9_-]+)([^\]]*)\]/g)]
    .filter(m => !['submit','response','quiz'].includes(m[1]))
    .map(([,type,star,name,options]) => ({type,name,required:star === '*' || (type === 'acceptance' && !/\boptional\b/.test(options)),minlength:options.match(/\bminlength:(\d+)/)?.[1] ? Number(options.match(/\bminlength:(\d+)/)[1]) : null,maxlength:options.match(/\bmaxlength:(\d+)/)?.[1] ? Number(options.match(/\bmaxlength:(\d+)/)[1]) : null}));
}
export function assertOwned(post, entry) {
  ensure(/^wpqa-[0-9a-f-]{36}$/.test(entry.marker) && Number.isSafeInteger(post?.id) && post.id > 0 && (!entry.id || post.id === entry.id) && post.author === entry.owner && post.slug === entry.marker && post.title?.raw === entry.marker && [entry.marker+'-v1',entry.marker+'-v2'].includes(post.content?.raw), 'BLOCKED: test post ownership mismatch');
}
