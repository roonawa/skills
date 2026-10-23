import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {captureMarkedScreenshots} from '../lib/marked-screenshots.mjs';
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.setContent('<main style="padding-top:1000px"><p id="target">Low contrast text</p></main>');
 const images=[];
 const shots=await captureMarkedScreenshots(page,[{id:'color-contrast',nodes:[{target:['#target'],html:'<p id="target">Low contrast text</p>'},{target:['#missing']}]}],async(id,bytes)=>{
   assert.equal(await page.locator('[aria-hidden="true"]').innerText(),'指摘 1');
   images.push(bytes);
 });
 assert.equal(shots[0].status,'captured');assert(shots[0].box.y<844);assert.equal(images[0].subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(shots[1].status,'unavailable');assert.equal(await page.locator('[aria-hidden="true"]').count(),0);
 console.log('Annotated screenshot, scrolled target, missing target and overlay cleanup passed');
}finally{await browser.close();}
