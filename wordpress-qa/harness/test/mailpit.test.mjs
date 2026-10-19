import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { waitForMail } from '../lib/mailpit.mjs';

test('matches correlated mail recipients and body, rejects missing mail, never deletes unrelated mail', async () => {
  const methods=[];
  const server=createServer((req,res)=>{
    methods.push(req.method); res.setHeader('content-type','application/json');
    res.end(JSON.stringify(req.url.startsWith('/api/v1/search') ? {messages:[{ID:'m1',Subject:'問い合わせ qa-unique'}]} : {ID:'m1',Subject:'問い合わせ qa-unique',To:[{Address:'qa@example.test'}],Text:'Message qa-unique'}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    const mail=await waitForMail({url},{token:'qa-unique',to:'qa@example.test',subject:'問い合わせ qa-unique',textIncludes:'Message qa-unique',count:1,timeoutMs:500,settleMs:30});
    assert.equal(mail.length,1);
    await assert.rejects(waitForMail({url},{token:'qa-missing',to:'qa@example.test',count:1,timeoutMs:100,settleMs:10}),/mail count/);
    assert.ok(methods.every(m=>m==='GET'));
  } finally { await new Promise(r=>server.close(r)); }
});
