import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import {resolveDestination} from '../lib/egress-policy.mjs';
const file=process.env.WPQA_POLICY_FILE??'/policy/egress.json';
const policy=()=>{if(!fs.existsSync(file))return [];if(fs.statSync(file).size>65536)throw Error('policy too large');return JSON.parse(fs.readFileSync(file,'utf8'));};
let active=0;
const server=http.createServer(async(req,res)=>{
  if(active>=32){res.writeHead(503);return res.end();}active++;res.once('close',()=>active--);
  try{
    const d=await resolveDestination(req.url,policy());if(d.url.protocol!=='http:')throw Error('CONNECT required');
    const headers={...req.headers,host:d.url.host};delete headers['proxy-authorization'];delete headers['proxy-connection'];
    const out=http.request({host:d.address,port:d.port,family:d.family,method:req.method,path:d.url.pathname+d.url.search,headers,timeout:30000},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
    out.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});out.on('timeout',()=>out.destroy());req.on('aborted',()=>out.destroy());req.pipe(out);
  }catch{res.writeHead(403);res.end('接続先が許可されていません');}
});
server.on('connect',async(req,socket,head)=>{
  if(active>=32)return socket.destroy();active++;socket.once('close',()=>active--);
  try{
    if(!/^[a-zA-Z0-9.\[\]:_-]+$/.test(req.url))throw Error('bad authority');
    const d=await resolveDestination('https://'+req.url,policy());
    const remote=net.connect({host:d.address,port:d.port,family:d.family});
    socket.setTimeout(60000,()=>socket.destroy());remote.setTimeout(60000,()=>remote.destroy());
    remote.on('connect',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);remote.pipe(socket);socket.pipe(remote);});
    remote.on('error',()=>socket.destroy());socket.on('error',()=>remote.destroy());socket.on('close',()=>remote.destroy());remote.on('close',()=>socket.destroy());
  }catch{socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
});
server.headersTimeout=10000;server.requestTimeout=60000;server.listen(3128,'0.0.0.0');
