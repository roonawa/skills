import fs from 'node:fs';
import path from 'node:path';
import {validateDestinations} from '../lib/egress-policy.mjs';
export class SystemSettings {
  constructor({directory,codec,policyFile,admins=[]}){this.directory=directory;this.codec=codec;this.policyFile=policyFile;this.admins=admins;fs.mkdirSync(directory,{recursive:true});this.file=path.join(directory,'system.json');}
  read(){const s=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{dailyLimit:20};if(s.provider!=='anthropic'){delete s.sealed;return {...s,provider:'anthropic',model:'claude-sonnet-4-6',enabled:false,approved:false};}return s;}
  view(){const s=this.read();let destinations=[];if(this.policyFile&&fs.existsSync(this.policyFile))destinations=JSON.parse(fs.readFileSync(this.policyFile,'utf8'));return {provider:'anthropic',enabled:s.enabled,evidenceApproved:s.evidenceApproved===true,model:s.model,configured:!!s.sealed,dailyLimit:s.dailyLimit,approved:s.approved,destinations};}
  save(data){
    if(Object.keys(data).some(k=>!['apiKey','clearKey','evidenceApproved','enabled','model','dailyLimit','approved','destinations'].includes(k)))throw Error('設定項目が不正です');
    const old=this.read(),s={...old,...Object.fromEntries(['enabled','model','dailyLimit','approved','evidenceApproved'].filter(k=>data[k]!==undefined).map(k=>[k,data[k]]))};
    if(s.evidenceApproved!==undefined&&typeof s.evidenceApproved!=='boolean')throw Error('取得情報の送信許可が不正です');
    if(typeof s.enabled!=='boolean'||typeof s.approved!=='boolean'||!/^claude-[-a-zA-Z0-9.]{1,73}$/.test(s.model)||!Number.isInteger(s.dailyLimit)||s.dailyLimit<1||s.dailyLimit>200)throw Error('モデル・日次回数は正しい値を設定してください');
    if(data.apiKey&&data.clearKey)throw Error('キーの登録と削除は同時にできません');
    if(data.apiKey){if(typeof data.apiKey!=='string'||data.apiKey.length>512||!/^sk-ant-[A-Za-z0-9_-]+$/.test(data.apiKey))throw Error('APIキーの形式が不正です');s.sealed=this.codec(data.apiKey);}
    if(data.clearKey){delete s.sealed;s.enabled=false;}
    if(s.enabled&&(!s.sealed||!s.approved))throw Error('APIキーの登録と外部送信への同意が必要です');
    const destinations=data.destinations===undefined?this.view().destinations:validateDestinations(data.destinations);
    const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(s),{mode:0o600});fs.renameSync(temp,this.file);
    if(this.policyFile){fs.mkdirSync(path.dirname(this.policyFile),{recursive:true});fs.writeFileSync(this.policyFile+'.tmp',JSON.stringify(destinations),{mode:0o644});fs.renameSync(this.policyFile+'.tmp',this.policyFile);}
    return this.view();
  }
  key(){const s=this.read();if(!s.enabled||!s.approved||!s.sealed)throw Error('管理者のAI設定でAPIキーと外部送信の許可を登録してください');return this.codec(s.sealed,true);}
  reserve(){const s=this.read(),day=new Date().toISOString().slice(0,10);if(s.day!==day){s.day=day;s.used=0;}if((s.used??0)>=s.dailyLimit)throw Error('本日のAI利用上限に達しました（UTC日付で更新）');s.used=(s.used??0)+1;const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(s),{mode:0o600});fs.renameSync(tmp,this.file);}
}
