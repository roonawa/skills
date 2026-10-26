import fs from 'node:fs';import {chromium} from '@playwright/test';import {ExternalAuth} from './ui/external-auth.mjs';
const base='../../debug-evidence/mannendo-staging',config=JSON.parse(fs.readFileSync(base+'/site.json'));
const {env}=new ExternalAuth('.ui/projects/external-auth').prepare('b1036ad97b52',config);
const browser=await chromium.launch(),context=await browser.newContext({storageState:JSON.parse(env.WPQA_MANNENDO_ADMIN_STATE),javaScriptEnabled:false});
await context.route('**/*',r=>r.request().method()==='GET'&&new URL(r.request().url()).origin===config.baseURL?r.continue():r.abort());
const p=await context.newPage(),out={at:new Date().toISOString()};
try{
 await p.goto(config.baseURL+'/wp-admin/');if(!await p.locator('#wpadminbar').count())throw Error('Auth missing');
 out.menu=await p.locator('#adminmenu a').evaluateAll(es=>es.map(e=>({title:e.textContent.trim(),href:e.getAttribute('href')})));
 const nonce=await p.locator('script:not([src])').evaluateAll(es=>es.map(e=>e.textContent).join('\n').match(/var wpApiSettings\s*=\s*(\{[^;]+\})/)?.[1]??null);
 out.restNonceAvailable=!!nonce;
 if(nonce){const n=JSON.parse(nonce).nonce;const r=await context.request.get(config.baseURL+'/wp-json/wp/v2/types?context=edit',{headers:{'X-WP-Nonce':n}});out.typesStatus=r.status();if(r.ok())out.types=Object.fromEntries(Object.entries(await r.json()).map(([k,v])=>[k,{name:v.name,rest_base:v.rest_base,slug:v.slug}]));}
 await p.goto(config.baseURL+'/wp-admin/admin.php?page=wpcf7&post=31&action=edit');out.contact=await p.locator('textarea').evaluateAll(es=>es.filter(e=>/form|additional/i.test(e.name)).map(e=>({name:e.name,id:e.id,value:e.value})));
 out.featureSettings=[];
 for(const path of ['/wp-admin/admin.php?page=usces_initial','/wp-admin/admin.php?page=usces_delivery','/wp-admin/admin.php?page=wpcf7-integration','/wp-admin/admin.php?page=ssp_main_setting']){
 await p.goto(config.baseURL+path);
 const controls=await p.locator('input,select').evaluateAll(es=>es.filter(e=>e.name&&!/nonce|pass|token|key|secret|mail|address|phone|fax|tel|bank/i.test(e.name)).map(e=>({name:e.name,type:e.type,...e.tagName==='SELECT'?{value:e.value,options:[...e.options].map(o=>({value:o.value,text:o.textContent}))}:e.type==='checkbox'||e.type==='radio'?{value:e.value,checked:e.checked}:{}})));
 out.featureSettings.push({path,controls});
 }
 out.extraUrls=[];
 const old=fs.readdirSync(base+'/runs/2026-10-26T02-34-20-567Z-129ad659/artifacts',{recursive:true}).find(f=>String(f).endsWith('.json')&&String(f).includes('cms-inventory-'));
 const missing=JSON.parse(fs.readFileSync(base+'/runs/2026-10-26T02-34-20-567Z-129ad659/artifacts/'+old)).missing;
 for(const item of missing){const response=await p.goto(item.link);out.extraUrls.push({...item,status:response.status(),actualURL:p.url(),title:await p.title(),canonical:await p.locator('link[rel="canonical"]').getAttribute('href').catch(()=>null)});}
 fs.writeFileSync(base+'/coverage-evidence/blockers22-discovery.json',JSON.stringify(out,null,2));console.log(JSON.stringify({extraUrls:out.extraUrls}));
}finally{await browser.close();}
