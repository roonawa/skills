import fs from 'node:fs';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

export function createSecretCodec(key){
 if(!Buffer.isBuffer(key)||key.length!==32)throw Error('暗号化キーは32バイト必要です');
 key=Buffer.from(key);
 return (value,decode=false)=>{
  if(typeof value!=='string'||value.length>4*1024*1024)throw Error('認証情報の形式またはサイズが不正です');
  if(!decode){
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
   cipher.setAAD(Buffer.from('wpqa-secrets-v1'));
   const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
   return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.');
  }
  try{
   const [version,iv,tag,data,...extra]=value.split('.');
   if(version!=='v1'||extra.length||!iv||!tag||data===undefined)throw Error();
   const nonce=Buffer.from(iv,'base64'),auth=Buffer.from(tag,'base64');
   if(nonce.length!==12||auth.length!==16)throw Error();
   const decipher=createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(Buffer.from('wpqa-secrets-v1'));decipher.setAuthTag(auth);
   return Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8');
  }catch{throw Error('認証情報を復号できません。暗号化キーと保存データを確認してください');}
 };
}
export function codecFromFile(file){
 const value=fs.readFileSync(file,'utf8').trim();
 if(!/^[a-fA-F0-9]{64}$/.test(value))throw Error('暗号化キーファイルには64桁の16進数を指定してください');
 return createSecretCodec(Buffer.from(value,'hex'));
}
