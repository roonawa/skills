import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {request} from '@playwright/test';
import {load} from 'cheerio';
const origin='https://mannendo-test.rgr.jp';
const dir=path.resolve('../../debug-evidence/mannendo-staging');fs.mkdirSync(dir,{recursive:true});
const client=await request.newContext({baseURL:origin});
await client.get('/?password-protected=login');
await client.post('/?password-protected=login',{form:{password_protected_pwd:process.env.WPQA_SITE_PASSWORD,password_protected_cookie_test:'1','password-protected':'login',redirect_to:origin+'/'}});
if((await client.get('/')).url().includes('password-protected'))throw Error('Password protection login rejected');
const urls=new Set(['/','/shopguide','/qa','/usces-cart','/contact','/sitemap']);
const queue=['/wp-sitemap.xml'];const inventory=[];
for(let i=0;i<queue.length&&i<40;i++){
 const res=await client.get(queue[i]);const body=await res.text();
 if(!body.includes('<loc>')){inventory.push({path:queue[i],status:res.status(),type:'not-xml'});continue;}
 inventory.push({path:queue[i],status:res.status(),type:'xml'});
 const $=load(body,{xmlMode:true});
 $('loc').each((_i,el)=>{const raw=$(el).text();try{const u=new URL(raw);if(u.origin!==origin)return;if(u.pathname.endsWith('.xml')){if(!queue.includes(u.pathname))queue.push(u.pathname);}else if(!u.search&&!u.pathname.includes('wp-'))urls.add(u.pathname);}catch{}});
}
const inspection=JSON.parse(fs.readFileSync(path.join(dir,'inspection.json')));
for(const page of inspection)for(const link of page.links??[])try{const u=new URL(link.url);if(u.origin===origin&&!u.search&&!u.pathname.includes('wp-')&&!/\.(png|jpg|jpeg|pdf|gif|webp)$/i.test(u.pathname))urls.add(u.pathname);}catch{}
const production=JSON.parse(fs.readFileSync('C:/Users/roonawa/AppData/Local/Temp/claude/c--Users-roonawa--claude-skills/f2a5ab90-90c4-4798-8ce9-5285cf2959f7/scratchpad/mannendo/site.json'));
const known=new Map(production.pages.map(p=>[new URL(p.path,production.baseURL).pathname,p]));
const pages=[...urls].map((p,i)=>({id:known.get(p)?.id??`stage-${i}`,path:p,canonical:origin+p,indexable:false,links:['/','/shopguide','/qa','/usces-cart','/contact'].includes(p),reason:'テスト環境の公開画面・サイトマップから取得。検索非公開、canonicalはテスト環境内を期待。'}));
const config={name:'万年堂 テストサイト',baseURL:origin,environment:'staging',timeoutMs:30000,headersEnv:'WPQA_MANNENDO_STAGING_HEADERS',outputDir:'runs',baselineDir:'baselines',revision:'staging-qa-2026-10-23',pages,policies:production.policies.map(p=>({...p,...(p.location?{location:p.location.replace(production.baseURL,origin)}:{})})),visuals:production.visuals,journeys:[],manual:production.manual.map(m=>({...m,reason:m.id==='design-review'?'画像と文章・操作性を確認し、最終デザインの承認は責任者確認。':'送信先・決済モードが不明。注文確定・メール送信前まで検証し、未確認範囲を記録。'}))};
fs.writeFileSync(path.join(dir,'site.json'),JSON.stringify(config,null,2));
fs.writeFileSync(path.join(dir,'inventory.json'),JSON.stringify({sources:inventory,pageCount:pages.length,paths:[...urls]},null,2));
const cookies=(await client.storageState()).cookies.filter(c=>c.domain.includes('mannendo-test.rgr.jp'));
const env={...process.env,WPQA_MANNENDO_STAGING_HEADERS:JSON.stringify({Cookie:cookies.map(c=>`${c.name}=${c.value}`).join('; ')})};delete env.WPQA_SITE_PASSWORD;
console.log(`Staging inventory: ${pages.length} pages. Authentication kept in process memory.`);
if(process.argv.includes('--ui')){
 const ui=spawn(process.execPath,['ui/start.mjs','--config',path.join(dir,'site.json'),'--port','4311'],{cwd:process.cwd(),env,detached:true,stdio:'ignore',windowsHide:true});ui.unref();console.log('Staging UI: http://127.0.0.1:4311/');
}
// Only the read-only suites are dispatched. No journey or writing suite is selected.
let outcome=0;
for(const suite of ['audit','visual']){
 const child=spawn(process.execPath,['bin/qa.mjs','run','--config',path.join(dir,'site.json'),'--suite',suite],{env,stdio:'inherit',windowsHide:true});
 const code=await new Promise(resolve=>child.on('exit',resolve));outcome=Math.max(outcome,code??2);
}
await client.dispose();process.exitCode=outcome;
