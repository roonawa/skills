import { load } from 'cheerio';
import { sameOrigin } from './config.mjs';
import { fetchPage } from './audit.mjs';

export function sitemapEntries(xml,baseURL) {
  const $=load(xml,{xmlMode:true});
  const kind=$('urlset').length?'pages':$('sitemapindex').length?'sitemaps':null;
  if(!kind) throw new Error('Expected an XML sitemap, not a login/error page');
  const selector=kind==='pages'?'urlset > url > loc':'sitemapindex > sitemap > loc';
  const urls=$(selector).map((_,el)=>sameOrigin($(el).text().trim(),baseURL)).get();
  if(!urls.length) throw new Error('Empty sitemap; cannot establish coverage');
  return {kind,urls:[...new Set(urls)]};
}
export async function discover(request,baseURL,sitemapPath,timeoutMs) {
  const queue=[sameOrigin(sitemapPath,baseURL)],seen=new Set(),pages=new Set();
  while(queue.length) {
    const next=queue.shift();if(seen.has(next))continue;
    if(seen.size>=100) throw new Error('Sitemap limit 100 reached; split inventory explicitly');
    seen.add(next);const response=await fetchPage(request,next,baseURL,timeoutMs);
    if(response.status!==200) throw new Error(`Sitemap HTTP ${response.status}`);
    const data=sitemapEntries(response.body,baseURL);
    if(data.kind==='sitemaps') queue.push(...data.urls);
    else for(const url of data.urls) pages.add(url);
    if(pages.size>10000) throw new Error('URL limit 10000 reached; split inventory explicitly');
  }
  return {baseURL,sitemaps:[...seen],urls:[...pages].sort(),note:'URL inventory only. Define expected canonical/indexability independently; include URLs absent from sitemaps.'};
}
