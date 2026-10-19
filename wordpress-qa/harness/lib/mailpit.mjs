import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export function envHeaders(name) {
  if(!name) return {};
  if(!process.env[name]) throw new Error(`BLOCKED: environment variable ${name} missing`);
  let value; try { value=JSON.parse(process.env[name]); } catch { throw new Error(`BLOCKED: ${name} must contain JSON headers`); }
  if(!value || Array.isArray(value) || typeof value!=='object' || Object.values(value).some(v=>typeof v!=='string')) throw new Error(`BLOCKED: ${name} must contain string headers`);
  return value;
}
export async function waitForMail(mailpit, expected) {
  if(!mailpit) throw new Error('BLOCKED: mailpit is not configured');
  const {token,to,subject,textIncludes,count=1,timeoutMs=15000,settleMs=500}=expected;
  assert.ok(typeof token==='string' && /^[a-zA-Z0-9-]{8,128}$/.test(token),'unique alphanumeric token required');
  assert.ok(to && Number.isInteger(count) && count>0,'recipient and positive count required');
  const deadline=Date.now()+timeoutMs; let matches=[],stableSince=0;
  async function get(resource) {
    let response;
    try { response=await fetch(new URL(resource,mailpit.url),{headers:envHeaders(mailpit.headersEnv),signal:AbortSignal.timeout(Math.max(1,Math.min(5000,deadline-Date.now()))),redirect:'error'}); }
    catch { throw new Error('BLOCKED: Mailpit API unavailable'); }
    if(!response.ok) throw new Error(`BLOCKED: Mailpit HTTP ${response.status}`);
    return response.json();
  }
  do {
    const result=await get(`/api/v1/search?query=${encodeURIComponent(token)}&limit=100`);
    if(!Array.isArray(result.messages)) throw new Error('BLOCKED: unsupported Mailpit search response');
    if(result.messages.length>=100) throw new Error('BLOCKED: Mailpit result limit reached; use a unique run token');
    matches=[];
    for(const summary of result.messages) {
      const message=await get(`/api/v1/message/${encodeURIComponent(summary.ID)}`);
      if(`${message.Subject??''}\n${message.Text??''}\n${message.HTML??''}`.includes(token)) matches.push(message);
    }
    assert.ok(matches.length<=count,`mail count ${matches.length} exceeds ${count}`);
    if(matches.length===count) {
      stableSince ||= Date.now();
      if(Date.now()-stableSince>=settleMs) break;
    } else stableSince=0;
    if(Date.now()>=deadline) break;
    await delay(Math.min(100,Math.max(1,deadline-Date.now())));
  } while(Date.now()<deadline);
  assert.equal(matches.length,count,`mail count ${matches.length} != ${count}`);
  assert.ok(stableSince && Date.now()-stableSince>=settleMs,'mail observation window did not complete');
  for(const message of matches) {
    assert.deepEqual((message.To??[]).map(x=>x.Address.toLowerCase()).sort(),(Array.isArray(to)?to:[to]).map(x=>x.toLowerCase()).sort(),'mail recipients differ');
    if(subject!==undefined) assert.equal(message.Subject,subject,'mail subject differs');
    if(textIncludes!==undefined) assert.ok((message.Text??'').includes(textIncludes),'mail text differs');
  }
  return matches.map(m=>({id:m.ID,subject:m.Subject,to:m.To?.map(x=>x.Address)}));
}
