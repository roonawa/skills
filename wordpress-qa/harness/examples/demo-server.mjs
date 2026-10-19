import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { escapeHTML } from '../lib/results.mjs';

export async function startDemo(port=4300) {
  const faults=new Set(),messages=new Map(); let origin;
  const server=createServer(async(req,res)=>{
    const target=new URL(req.url,origin),pathname=target.pathname;
    const json=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
    if(pathname==='/api/v1/search') return json({messages:[...messages.values()].filter(m=>m.Text.includes(target.searchParams.get('query'))).map(m=>({ID:m.ID,Subject:m.Subject}))});
    if(pathname.startsWith('/api/v1/message/')) return json(messages.get(pathname.split('/').at(-1))??{});
    if(pathname.startsWith('/__test/messages/')&&req.method==='DELETE') {
      const token=decodeURIComponent(pathname.split('/').at(-1));
      for(const [id,m] of messages) if(m.Text===token) messages.delete(id);
      res.writeHead(204);return res.end();
    }
    if(pathname==='/send'&&req.method==='POST') {
      let raw='';for await(const chunk of req) raw+=chunk;
      const data=new URLSearchParams(raw),token=data.get('message');
      if(!data.get('name')||!data.get('email')||!token) {res.writeHead(400);return res.end();}
      if(!faults.has('mail')) {const id=randomUUID();messages.set(id,{ID:id,Subject:`お問い合わせ ${token}`,To:[{Address:'qa@example.test'}],Text:token});}
      return json({ok:true});
    }
    if(pathname==='/collect') {res.writeHead(204);return res.end();}
    if(pathname==='/wp-admin/') {res.writeHead(403);return res.end('Forbidden');}
    if(pathname==='/wp-config.php') {res.setHeader('content-type','text/plain');return res.end(faults.has('leak')?"<?php define('DB_PASSWORD','fixture-only');":'');}
    if(pathname==='/robots.txt') {res.setHeader('content-type','text/plain');return res.end(`User-agent: *\nAllow: /\nSitemap: ${origin}/wp-sitemap.xml`);}
    if(pathname==='/wp-sitemap.xml') {res.setHeader('content-type','application/xml');return res.end(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url><url><loc>${origin}/contact</loc></url></urlset>`);}
    if(!['/','/contact'].includes(pathname)) {res.writeHead(404);return res.end('Not found');}
    const contact=pathname==='/contact',title=contact?'お問い合わせ':'QA Demo';
    res.setHeader('content-type','text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><link rel="canonical" href="${faults.has('canonical')?'https://old.example.test':origin}${pathname}">${faults.has('noindex')?'<meta name="robots" content="noindex">':''}<style>body{font:18px Arial,sans-serif;color:#172b3a;background:#fff;margin:24px}main{max-width:720px${faults.has('layout')?';min-width:1200px':''}}label{display:block;margin-top:20px}input,textarea{display:block;max-width:90%;padding:8px}button{margin-top:20px;padding:10px}a{color:#174ea6}</style></head><body><header><nav aria-label="メイン"><a href="/">ホーム</a> <a href="/contact">お問い合わせ</a></nav></header><main><h1>${title}</h1>${contact?`<form><label for="name">お名前</label><input id="name" name="name" required autocomplete="name"><label for="email">メールアドレス</label><input id="email" name="email" type="email" required autocomplete="email"><label for="message">お問い合わせ内容</label><textarea id="message" name="message" required></textarea><button type="submit">送信</button></form><p role="status"></p><script>document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const data=new URLSearchParams(new FormData(e.target));const response=await fetch('/send',{method:'POST',body:data});if(response.ok){document.querySelector('[role=status]').textContent='送信しました';await fetch('/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'generate_lead',token:data.get('message')})});}})</script>`:`<p>重要な導線と公開設定を繰り返し確認するための検証用サイトです。</p><a href="${faults.has('link')?'/missing':'/contact'}">相談する</a>`}</main><footer><p>${escapeHTML('ローカル検証専用')}</p></footer></body></html>`);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {url:origin,faults,close:()=>new Promise(r=>server.close(r))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const server=await startDemo();console.log(`Local fixture: ${server.url} (Ctrl+C to stop)`);
}
