import { load } from 'cheerio';
import { sameOrigin } from './config.mjs';

function documentBase($, pageURL) {
  try { return new URL($('base[href]').first().attr('href')??pageURL,pageURL).href; }
  catch { return pageURL; }
}

export function inspectHTML(body, headers, expected, finalURL) {
  const $=load(body), errors=[];
  const title=$('title').text().trim();
  if(!title || (expected.title!==undefined && title!==expected.title)) errors.push('title differs from expectation or is empty');
  if(expected.description!==undefined && $('meta[name="description" i]').attr('content')!==expected.description) errors.push('description differs from expectation');
  if(expected.lang!==undefined && $('html').attr('lang')!==expected.lang) errors.push('lang differs from expectation');
  const canon=$('link[rel="canonical" i]');
  let canonical=''; try { canonical=new URL(canon.attr('href'),documentBase($,finalURL)).href; } catch {}
  if(canon.length!==1 || !canon.attr('href') || canonical!==expected.canonical) errors.push('canonical differs from expectation');
  const directives=[$('meta[name="robots" i]').map((_,el)=>$(el).attr('content')).get().join(','),headers['x-robots-tag']??''].join(',').toLowerCase();
  const noindex=/(^|[\s,:])(noindex|none)(?=$|[\s,;])/.test(directives);
  if(expected.indexable===noindex) errors.push(`indexable differs from expectation (${expected.indexable})`);
  return errors;
}
export function checkPolicy(response, policy, baseURL) {
  const errors=[];
  if(!policy.statuses.includes(response.status)) errors.push(`HTTP ${response.status} not in ${policy.statuses.join(',')}`);
  if(policy.location) {
    let actual=''; try{actual=new URL(response.headers.location,response.url??baseURL).href;}catch{}
    if(!response.headers.location || actual!==new URL(policy.location,baseURL).href) errors.push('redirect location differs');
  }
  for(const token of policy.forbiddenText??[]) if(response.body.toLowerCase().includes(token.toLowerCase())) errors.push('forbidden content detected (body intentionally not stored)');
  for(const [key,value] of Object.entries(policy.requiredHeaders??{})) if(response.headers[key.toLowerCase()]!==value) errors.push(`header ${key} differs`);
  return errors;
}
export async function fetchPage(request, value, baseURL, timeout, follow=true) {
  let current=sameOrigin(value,baseURL); const seen=new Set();
  for(let hops=0;hops<6;hops++) {
    if(seen.has(current)) throw new Error('redirect loop'); seen.add(current);
    let res;
    try { res=await request.get(current,{maxRedirects:0,timeout,failOnStatusCode:false}); }
    catch(e) { throw new Error(`BLOCKED: HTTP request unavailable: ${new URL(current).pathname}: ${e.message.split('\n')[0]}`); }
    const response={status:res.status(),headers:res.headers(),body:await res.text(),url:current};
    await res.dispose();
    if(follow && [301,302,303,307,308].includes(response.status)) {
      if(!response.headers.location) throw new Error('redirect missing Location');
      current=sameOrigin(new URL(response.headers.location,current).href,baseURL); continue;
    }
    return response;
  }
  throw new Error('too many redirects');
}
export function internalLinks(body, pageURL) {
  const $=load(body); const links=new Set();
  for(const el of $('a[href]').toArray()) {
    const raw=$(el).attr('href'); if(!raw || raw.startsWith('#')) continue;
    try { links.add(sameOrigin(new URL(raw,documentBase($,pageURL)).href,pageURL)); } catch {}
  }
  return [...links];
}
