import assert from 'node:assert/strict';

const fields=['allowedResourceOrigins','allowedNavigationOrigins','allowedInteractionOrigins'];
export function validateNetworkPolicy(options) {
  for(const field of fields) if(options[field]!==undefined) {
    assert.ok(Array.isArray(options[field]),`${field} must be an array`);
    for(const value of options[field]) {
      const u=new URL(value);
      assert.ok(typeof value==='string' && !value.includes('*') && value===u.origin && !u.username && !u.password &&
        (u.protocol==='https:' || (u.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname))),`${field} requires exact HTTPS origins (HTTP only for loopback fixtures)`);
    }
  }
}

export function networkPolicy(baseURL,options,requestFactory) {
  validateNetworkPolicy(options);
  const base=new URL(baseURL).origin;
  const jars=new Map();
  return {
    navigation(url) { return [base,...(options.allowedNavigationOrigins??[])].includes(new URL(url,base).origin); },
    allowed(url,method,navigation) {
      const origin=new URL(url).origin;
      if(origin===base) return true;
      if(!['GET','HEAD'].includes(method) && !(options.allowedInteractionOrigins??[]).includes(origin)) return false;
      return navigation ? (options.allowedNavigationOrigins??[]).includes(origin) :
        (['GET','HEAD'].includes(method) ? (options.allowedResourceOrigins??[]).includes(origin) : (options.allowedInteractionOrigins??[]).includes(origin));
    },
    async route(route) {
      const req=route.request(),url=req.url(),target=new URL(url),foreign=target.origin!==base;
      if(!this.allowed(url,req.method(),req.isNavigationRequest())) return route.abort('blockedbyclient');
      // Fetch one hop at a time. Fulfilled redirects are routed again by the browser.
      // Allowlist headers so site credentials and arbitrary custom headers cannot leak.
      const safe=new Set(['accept','accept-language','content-type','user-agent']);
      const headers=foreign ? {...Object.fromEntries(Object.entries(await req.allHeaders()).filter(([name])=>safe.has(name.toLowerCase()))),cookie:'',authorization:''} : await req.allHeaders();
      const session=foreign && (req.isNavigationRequest() || !['GET','HEAD'].includes(req.method())) &&
        [...(options.allowedNavigationOrigins??[]),...(options.allowedInteractionOrigins??[])].includes(target.origin);
      let isolated;
      try {
        let response;
        if(foreign) {
          const request=requestFactory??(await import('@playwright/test')).request;
          isolated=await request.newContext({storageState:{cookies:session?(jars.get(target.origin)??[]):[],origins:[]}});
          // The isolated origin jar supplies only this sandbox's cookies.
          if(session) delete headers.cookie;
          response=await isolated.fetch(url,{method:req.method(),headers,data:req.postDataBuffer()??undefined,maxRedirects:0});
          if(session) {
            const cookieNames=new Set();
            for(const header of response.headersArray()) if(header.name.toLowerCase()==='set-cookie') {
              const parts=header.value.split(';').map(x=>x.trim());
              const domain=parts.find(x=>/^domain=/i.test(x))?.slice(7).toLowerCase().replace(/^\./,'');
              if(!domain || (domain===target.hostname && domain!==new URL(base).hostname)) cookieNames.add(parts[0].split('=')[0]);
            }
            const previous=new Map((jars.get(target.origin)??[]).map(c=>[`${c.name}|${c.path}`,c]));
            for(const [key,cookie] of previous) if(cookieNames.has(cookie.name)) previous.delete(key);
            for(const cookie of (await isolated.storageState()).cookies) {
              if(cookieNames.has(cookie.name) && cookie.domain.replace(/^\./,'')===target.hostname)
                previous.set(`${cookie.name}|${cookie.path}`,cookie);
            }
            jars.set(target.origin,[...previous.values()].filter(c=>c.expires===-1 || c.expires>Date.now()/1000));
          }
        } else response=await route.fetch({headers,maxRedirects:0});
        const location=response.headers().location;
        if(location) {
          const next=new URL(location,url).href,status=response.status();
          const method=status===303 || ([301,302].includes(status)&&req.method()==='POST')?'GET':req.method();
          if(!this.allowed(next,method,req.isNavigationRequest())) return route.abort('blockedbyclient');
        }
        const responseHeaders={...response.headers()};
        if(foreign) delete responseHeaders['set-cookie'];
        return await route.fulfill({response,headers:responseHeaders});
      } catch { return route.abort('failed'); }
      finally {await isolated?.dispose();}
    },
  };
}
