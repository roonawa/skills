import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import net from 'node:net';
import http from 'node:http';
import {evaluateCertificate,inspectCertificate} from '../lib/tls-certificate.mjs';

// テスト専用の自己署名証明書（localhost / 127.0.0.1、100年有効）。
const key=`-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg/byRr8TORKTVaCRl
NxGSaYZM6xbq1tqEzjRs/4SlxYuhRANCAARngO3iphNjfnhJFs/D5H2i1Eanm2JU
TImFr9HyElHMzbij7cbsu8Qv3oB10vwBM42YqSTNHzpGTggto+1KbOtB
-----END PRIVATE KEY-----`;
const cert=`-----BEGIN CERTIFICATE-----
MIIBmzCCAUGgAwIBAgIUWHzQ5StO9TEBGIIjATova0oXDkQwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTEwMjAxMzkzN1oYDzIxMjYxMDA5
MDEzOTM3WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAARngO3iphNjfnhJFs/D5H2i1Eanm2JUTImFr9HyElHMzbij7cbsu8Qv
3oB10vwBM42YqSTNHzpGTggto+1KbOtBo28wbTAdBgNVHQ4EFgQUlofNEBUbGdy0
azuEotQIBTR29AgwHwYDVR0jBBgwFoAUlofNEBUbGdy0azuEotQIBTR29AgwDwYD
VR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwCgYIKoZI
zj0EAwIDSAAwRQIgSNGAZInYi2WQQJ67GeCNFZVnoIiNw7Stj2E+Rrai5VACIQDe
jNdMp7z/lpRQUcOI3sygYj8ASBmLEYJE5lsdvBWsbQ==
-----END CERTIFICATE-----`;
const now=new Date('2026-11-02T00:00:00Z'),days=n=>new Date(now.getTime()+n*864e5);

test('evaluateCertificate thresholds',()=>{
  assert.deepEqual(evaluateCertificate({validTo:days(13),authorized:true},now),['cert-expiring']);
  assert.deepEqual(evaluateCertificate({validTo:days(15),authorized:true},now),[]);
  assert.deepEqual(evaluateCertificate({validTo:days(-1),authorized:true},now),['cert-expired']);
  assert.deepEqual(evaluateCertificate({validTo:days(-1),authorized:false,authorizationError:'CERT_HAS_EXPIRED'},now),['cert-expired']);
  assert.deepEqual(evaluateCertificate({validTo:days(90),authorized:false,authorizationError:'DEPTH_ZERO_SELF_SIGNED_CERT'},now),['cert-untrusted']);
  assert.deepEqual(evaluateCertificate({validTo:days(90),authorized:true,hostnameError:'mismatch'},now),['cert-hostname-mismatch']);
  assert.throws(()=>evaluateCertificate({validTo:new Date('x'),authorized:true},now));
});

async function tlsServer(t){
  const got=[],server=tls.createServer({key,cert},s=>{s.on('data',d=>got.push(d));s.on('error',()=>{});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return {got,port:server.address().port};
}
test('inspectCertificate reads an untrusted certificate directly and sends no data',async t=>{
  const s=await tlsServer(t),c=await inspectCertificate('127.0.0.1',s.port,{timeoutMs:3000});
  assert.equal(c.authorized,false);assert.match(c.authorizationError,/SELF_SIGNED/);assert.equal(c.hostnameError,undefined);assert.equal(c.validTo.getUTCFullYear(),2126);
  await new Promise(r=>setTimeout(r,100));assert.deepEqual(s.got,[]);
});
test('inspectCertificate tunnels through CONNECT and checks the requested host name',async t=>{
  const s=await tlsServer(t),seen=[],proxy=http.createServer();
  proxy.on('connect',(req,socket,head)=>{seen.push(req.url);if(req.url.startsWith('denied'))return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');const r=net.connect(s.port,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');r.write(head);r.pipe(socket);socket.pipe(r);});r.on('error',()=>socket.destroy());socket.on('error',()=>r.destroy());});
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{proxy.closeAllConnections();proxy.close(r);}));
  const uri=`http://127.0.0.1:${proxy.address().port}`,c=await inspectCertificate('other.test',443,{proxy:uri,timeoutMs:3000});
  assert.equal(c.authorized,false);assert.match(c.hostnameError,/other\.test/);assert.deepEqual(seen,['other.test:443']);
  await assert.rejects(inspectCertificate('denied.test',443,{proxy:uri,timeoutMs:3000}),/接続先/);
});
test('inspectCertificate honours timeout and abort',async t=>{
  const server=net.createServer(s=>{s.on('error',()=>{});s.resume();});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const port=server.address().port,start=Date.now();await assert.rejects(inspectCertificate('127.0.0.1',port,{timeoutMs:300}));assert(Date.now()-start<2000);
  const ac=new AbortController();setTimeout(()=>ac.abort(),100);await assert.rejects(inspectCertificate('127.0.0.1',port,{timeoutMs:5000,signal:ac.signal}),/中断/);
});
