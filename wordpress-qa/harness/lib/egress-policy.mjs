import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
export function addressClass(ip){
  if(isIP(ip)===4){
    const [a,b]=ip.split('.').map(Number);
    if(a===0||a===127||a>=224||a===169&&b===254)return 'forbidden';
    if(a===10||a===172&&b>=16&&b<=31||a===192&&b===168)return 'private';
    if(a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a===192&&b===0||a===198&&b===51||a===203&&b===0)return 'forbidden';
    return 'public';
  }
  if(isIP(ip)===6){
    const s=new URL('http://['+ip+']').hostname.slice(1,-1).toLowerCase();
    if(/^f[cd]/.test(s))return 'private';
    if(!/^[23][0-9a-f]{3}:/.test(s)||(s.startsWith('2001:')&&(parseInt(s.split(':')[1]||'0',16)<512||s.startsWith('2001:db8:')))||/^2002:/.test(s))return 'forbidden';
    return 'public';
  }
  return 'forbidden';
}
export function validateDestinations(entries){
  if(!Array.isArray(entries)||entries.length>100)throw Error('接続先は100件以内で指定してください');
  const seen=new Set();return entries.map(e=>{
    const u=new URL(e.origin);
    if(!['https:','http:'].includes(u.protocol)||u.origin!==e.origin||u.username||u.password||seen.has(e.origin))throw Error('接続先は重複しない https://ホスト名 の形式で指定してください');
    seen.add(e.origin);
    const privateIPs=e.privateIPs??[];
    if(!Array.isArray(privateIPs)||privateIPs.length>16||privateIPs.some(ip=>addressClass(ip)!=='private'))throw Error('社内IPはRFC1918またはULAの固定IPだけ指定できます');
    if(u.protocol==='http:'&&!privateIPs.length)throw Error('HTTP接続には許可する社内固定IPが必要です');
    return {origin:u.origin,privateIPs};
  });
}
export async function resolveDestination(url,entries,resolver=lookup,{method,hasBody}={}){
  const u=new URL(url);if(u.username||u.password||!['http:','https:'].includes(u.protocol))throw Error('接続先が許可されていません');
  const all=validateDestinations(entries);
  let rule=all.find(e=>e.origin===u.origin);
  if(!rule&&u.protocol==='http:'&&u.port===''&&method==='GET'&&hasBody===false&&u.pathname==='/'&&u.search===''&&all.some(e=>e.origin==='https://'+u.host))rule={origin:u.origin,privateIPs:[]};
  if(!rule)throw Error('接続先を管理者の「接続先の許可設定」に登録してください');
  const host=u.hostname.replace(/^\[|\]$/g,'');
  const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await timedLookup(resolver,host);
  if(!addresses.length||addresses.some(({address})=>{const kind=addressClass(address);return kind==='forbidden'||kind==='private'&&!rule.privateIPs.includes(address);}))throw Error('内部・特殊IPへの接続は禁止されています（社内サイトは固定IPの許可が必要です）');
  return {address:addresses[0].address,family:addresses[0].family,port:Number(u.port||(u.protocol==='https:'?443:80)),url:u};
}

async function timedLookup(resolver,host){let timer;try{return await Promise.race([resolver(host,{all:true,verbatim:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DNS timeout')),5000);})]);}finally{clearTimeout(timer);}}
