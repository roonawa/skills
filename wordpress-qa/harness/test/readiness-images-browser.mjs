// Run from any directory: node test/readiness-images-browser.mjs
// 読み込めなかった画像（別ホストへの通信が止められた場合など）を trackImages が拾うことを確かめる。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import {trackImages} from '../lib/readiness-images.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const site=createServer((req,res)=>{
  if(req.url.startsWith('/ok.png')){res.setHeader('Content-Type','image/png');res.end(png);return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end('<!doctype html><html><body><img src="/ok.png"><img src="http://other.invalid/x.png"><img src="http://other.invalid/aborted.png" onerror="this.onerror=null;this.src=\'/ok.png?again\'"></body></html>');
});
await new Promise(r=>site.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();
try {
  const page=await browser.newPage();
  // 中断（net::ERR_ABORTED）のあと別の画像に差し替わって表示されたものは、読み込めなかった画像に数えない。
  await page.route('http://other.invalid/aborted.png',route=>route.abort('aborted'));
  await page.route('http://other.invalid/x.png',route=>route.abort());
  const tracker=trackImages(page);
  await page.goto(`http://127.0.0.1:${site.address().port}/`,{waitUntil:'load'});
  const failed=await tracker.failed();
  assert.equal(failed.length,1,JSON.stringify(failed));
  assert.equal(failed[0].url,'http://other.invalid/x.png');
  assert.equal(failed[0].host,'other.invalid');
  assert.equal(failed[0].reason,'request-failed');
  console.log('PASS readiness records images that never load');
} finally { await browser.close();site.close(); }
