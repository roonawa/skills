import {chromium} from '@playwright/test';
import fs from 'node:fs';
const out='../../debug-evidence/mannendo-causes';
const browser=await chromium.launch();const results=[];
try{
 for(const path of ['/','/shopguide','/qa','/usces-cart']){
  const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[],jquery=[];
  page.on('pageerror',e=>errors.push(e.stack));
  page.on('response',r=>{if(r.url().includes('/jquery/jquery.min.js'))jquery.push({url:r.url(),status:r.status()});});
  await page.goto('https://mannendo.jp'+path,{waitUntil:'load',timeout:45000});
  // Observe the progress interval (100 ms) through its completion (~2 s).
  await page.waitForTimeout(4000);
  const dom=await page.evaluate(()=>({progressBar:!!document.getElementById('progress-bar'),loadingScreen:!!document.getElementById('loading-screen'),jquery:typeof window.jQuery,uscesCart:typeof window.uscesCart,emptySlideLinks:[...document.querySelectorAll('.p-mainVisual__slideLink')].filter(a=>!a.textContent.trim()&&!a.getAttribute('aria-label')).length,footer:document.querySelector('.company-name')?{color:getComputedStyle(document.querySelector('.company-name')).color}:null}));
  results.push({path,errors:[...new Set(errors)],jquery,dom});await page.close();
 }
}finally{await browser.close();}
fs.writeFileSync(out+'/reproduction.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
