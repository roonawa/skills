// Metadata only: never return cookie values, usernames, tokens or signatures.
export function wordpressSessionStatus(state,adminPath='/wp-admin/',now=Date.now()){
 const dates=[];
 for(const c of state?.cookies??[]){
  if(!/^wordpress_(?:sec_)?[a-f0-9]+$/.test(c.name)||!adminPath.startsWith((c.path??'').replace(/\/$/,'')+'/'))continue;
  try{const parts=decodeURIComponent(c.value).split('|');if(parts.length===4&&/^\d{9,12}$/.test(parts[1]))dates.push(Number(parts[1])*1000);}catch{}
 }
 const expires=dates.length?Math.min(...dates):null;
 return {expiresAt:expires===null?null:new Date(expires).toISOString(),expired:expires!==null&&expires<=now};
}
