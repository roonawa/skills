// サーバーによってはクッキー名に接頭辞を付ける（例：ENC_wordpress_logged_in_…）。接頭辞は英数字1語＋_ まで認める。
const PREFIX='(?:[A-Za-z0-9]+_)?';
const LOGGED_IN=new RegExp('^'+PREFIX+'wordpress_logged_in_'),AUTH=new RegExp('^'+PREFIX+'wordpress_(?:sec_)?[a-f0-9]+$');
export const isLoggedInCookie=c=>LOGGED_IN.test(c?.name??'')&&!!c?.value;
// Metadata only: never return cookie values, usernames, tokens or signatures.
export function wordpressSessionStatus(state,adminPath='/wp-admin/',now=Date.now()){
 const dates=[];
 for(const c of state?.cookies??[]){
  if(!AUTH.test(c.name)||!adminPath.startsWith((c.path??'').replace(/\/$/,'')+'/'))continue;
  try{const parts=decodeURIComponent(c.value).split('|');if(parts.length===4&&/^\d{9,12}$/.test(parts[1]))dates.push(Number(parts[1])*1000);}catch{}
 }
 const expires=dates.length?Math.min(...dates):null;
 return {expiresAt:expires===null?null:new Date(expires).toISOString(),expired:expires!==null&&expires<=now};
}
