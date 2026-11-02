import {randomBytes,scryptSync,scrypt,timingSafeEqual,createHmac} from 'node:crypto';

const derive=(password,salt)=>new Promise((resolve,reject)=>scrypt(password,salt,64,(error,key)=>error?reject(error):resolve(key)));
const deny=(status,message)=>{throw Object.assign(Error(message),{status});};
export function hashPassword(password){
 if(typeof password!=='string'||password.length<16||password.length>256)throw Error('利用者パスワードは16〜256文字必要です');
 const salt=randomBytes(16).toString('hex');return {salt,hash:scryptSync(password,salt,64).toString('hex')};
}
export function createSharedAccess({origin,users}){
 const u=new URL(origin);
 if(u.protocol!=='https:'||u.origin!==origin||u.username||u.password)throw Error('共有版にはHTTPSの公開originを指定してください');
 if(!Array.isArray(users)||!users.length||users.length>50)throw Error('試用版の利用者は1〜50名で設定してください');
 const accounts=new Map(),seed=randomBytes(32),failures=new Map(),cache=new Map(),rejected=new Map();
 let verifications=0;
 for(const user of users){
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(user.name)||accounts.has(user.name)||!/^[a-f0-9]{32}$/.test(user.salt)||!/^[a-f0-9]{128}$/.test(user.hash))throw Error('利用者ファイルの形式が不正です');
  accounts.set(user.name,{...user});
 }
 return {origin,async authenticate(req){
  if(req.headers.host!==u.host)deny(403,'共有版の公開URLからアクセスしてください');
  const header=req.headers.authorization;
  if(typeof header!=='string'||header.length>1024||!/^Basic [A-Za-z0-9+/]+=*$/i.test(header))deny(401,'利用者ログインが必要です');
  const raw=Buffer.from(header.slice(6),'base64').toString('utf8'),colon=raw.indexOf(':'),name=raw.slice(0,colon),password=raw.slice(colon+1);
  const user=accounts.get(name),now=Date.now(),bucket=(req.socket?.remoteAddress??'local')+'|'+(user?name:'unknown');
  const failure=failures.get(bucket);
  const digest=createHmac('sha256',seed).update(raw).digest('hex');
  if(!(cache.get(name)?.digest===digest&&cache.get(name).until>now)){
   let valid=false;
   if(user&&colon>0&&password.length<=256&&!(rejected.get(digest)>now)){
    if(verifications>=2)deny(429,'認証処理が混み合っています。少し待って再試行してください');
    verifications++;
    try{valid=timingSafeEqual(await derive(password,user.salt),Buffer.from(user.hash,'hex'));}
    finally{verifications--;}
   }
   if(!valid){
    // Store only keyed digests, never submitted credentials. Bound memory and TTL.
    if(rejected.size>=200)rejected.delete(rejected.keys().next().value);
    rejected.set(digest,now+10000);
    if(failure&&now-failure.at<60000&&failure.count>=10)deny(429,'認証に繰り返し失敗しました。1分後に再試行してください');
    if(failures.size>1000)for(const [key,value] of failures)if(now-value.at>=60000)failures.delete(key);
    if(failures.size>2000)failures.delete(failures.keys().next().value);
    failures.set(bucket,{at:now,count:failure&&now-failure.at<60000?failure.count+1:1});deny(401,'利用者名またはパスワードを確認してください');
   }
   cache.set(name,{digest,until:now+60000});failures.delete(bucket);
  }
  return {name,token:createHmac('sha256',seed).update(name).digest('hex')};
 }};
}
