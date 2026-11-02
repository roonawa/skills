import tls from 'node:tls';
import net from 'node:net';
import http from 'node:http';

const DAY=864e5;
export function evaluateCertificate({validTo,authorized,authorizationError,hostnameError},now=new Date()){
  if(!(validTo instanceof Date)||Number.isNaN(validTo.getTime()))throw new Error('証明書の有効期限を読み取れません');
  const out=[],left=validTo-now;if(left<=0)out.push('cert-expired');else if(left<14*DAY)out.push('cert-expiring');
  if(!authorized&&!(authorizationError==='CERT_HAS_EXPIRED'&&left<=0))out.push('cert-untrusted');if(hostnameError)out.push('cert-hostname-mismatch');
  return out;
}
// 証明書を観測するためだけの接続。rejectUnauthorized:false は不正な証明書も読むためで、ハンドシェイク後に証明書と authorized を読むだけでデータは送らず、すぐ destroy() する。
// この接続にHTTPリクエストやCookieを流さない。この設定をほかで流用しない。
export function inspectCertificate(host,port,{proxy,timeoutMs=15000,signal}={}){
  const name=host.replace(/^\[|\]$/g,''),authority=(net.isIPv6(name)?`[${name}]`:name)+':'+port;
  return new Promise((resolve,reject)=>{
    let req,sock,closed=false;
    const done=(error,value)=>{if(closed)return;closed=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);sock?.destroy();req?.destroy();error?reject(error):resolve(value);};
    const abort=()=>done(new Error('検査が中断されました')),timer=setTimeout(()=>done(new Error('TLS接続がタイムアウトしました')),timeoutMs);
    if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
    const handshake=socket=>{
      sock=tls.connect({...socket?{socket}:{host:name,port},servername:net.isIP(name)?undefined:name,rejectUnauthorized:false,checkServerIdentity:()=>undefined},()=>{
        const c=sock.getPeerCertificate(),authorized=sock.authorized,authorizationError=sock.authorizationError?String(sock.authorizationError.code??sock.authorizationError):undefined;
        if(!c?.valid_to)return done(new Error('証明書を取得できません'));
        done(null,{validTo:new Date(c.valid_to),authorized,authorizationError,hostnameError:tls.checkServerIdentity(name,c)?.message});
      });
      sock.on('error',done);
    };
    if(!proxy)return handshake();
    const p=new URL(proxy);
    req=http.request({host:p.hostname.replace(/^\[|\]$/g,''),port:p.port||80,method:'CONNECT',path:authority,headers:{host:authority}});
    req.on('connect',(res,socket)=>{if(res.statusCode!==200){socket.destroy();return done(new Error(`接続先が許可されていません（CONNECT ${res.statusCode}）`));}handshake(socket);});
    req.on('error',done);req.end();
  });
}
