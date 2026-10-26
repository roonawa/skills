import fs from 'node:fs';
import {chromium} from '@playwright/test';
import {ExternalAuth} from './ui/external-auth.mjs';
const base='../../debug-evidence/mannendo-staging';
const config=JSON.parse(fs.readFileSync(base+'/site.json'));
const {env}=new ExternalAuth('.ui/projects/external-auth').prepare('b1036ad97b52',config);
const browser=await chromium.launch();
const context=await browser.newContext({storageState:JSON.parse(env.WPQA_MANNENDO_ADMIN_STATE),javaScriptEnabled:false});
await context.route('**/*',r=>r.request().method()==='GET'&&new URL(r.request().url()).origin===config.baseURL?r.continue():r.abort());
const page=await context.newPage(); const observations=[];
try{for(const slug of ['general','reading','discussion','permalink','plugins']){
 const path=slug==='plugins'?'/wp-admin/plugins.php':`/wp-admin/options-${slug}.php`;
 const response=await page.goto(config.baseURL+path);
 if(response.status()!==200||!await page.locator('#wpadminbar').count())throw Error('Authentication unavailable');
 const data=await page.evaluate(()=>({fields:[...document.querySelectorAll('input,select')].filter(e=>/^(date_format|time_format|start_of_week|show_on_front|page_on_front|page_for_posts|posts_per_page|posts_per_rss|rss_use_excerpt|default_pingback_flag|default_ping_status|default_comment_status|require_name_email|comment_registration|close_comments_for_old_posts|close_comments_days_old|thread_comments|thread_comments_depth|page_comments|comments_per_page|comment_order|comment_moderation|comment_previously_approved|comment_whitelist|permalink_structure|category_base|tag_base)$/.test(e.name)).map(e=>({name:e.name,id:e.id,type:e.type,value:e.value,checked:e.type==='checkbox'||e.type==='radio'?e.checked:undefined,options:e.tagName==='SELECT'?[...e.options].map(o=>({value:o.value,text:o.text})):undefined})),plugins:[...document.querySelectorAll('tr[data-plugin]')].map(e=>({plugin:e.getAttribute('data-plugin'),active:e.classList.contains('active'),name:e.querySelector('.plugin-title strong')?.textContent,description:e.querySelector('.plugin-description')?.textContent?.trim()}))}));
 observations.push({path,...data});
}
await page.goto(config.baseURL+'/');
const home=await page.evaluate(()=>({bodyClass:document.body.className,title:document.title}));
fs.writeFileSync(base+'/coverage-evidence/admin-settings-observed.json',JSON.stringify({observedAt:new Date().toISOString(),readOnly:true,home,observations},null,2));console.log(JSON.stringify({home,pages:observations.length}));}finally{await browser.close();}
