// Site-specific ordinary Playwright code, not a custom test language.
export async function run({page,expect,token,mail,attach}) {
  await page.goto('/contact');
  const submit=page.getByRole('button',{name:'送信'});
  await submit.click();
  expect(await page.getByLabel('お名前').evaluate(el=>el.validity.valueMissing)).toBe(true);
  await page.getByLabel('お名前').fill('QA テスト');
  await page.getByLabel('メールアドレス').fill('qa@example.test');
  await page.getByLabel('お問い合わせ内容').fill(token);
  // Register the listener before submitting; fixed sleeps are not used.
  const eventPromise=page.waitForRequest(req=>new URL(req.url()).pathname==='/collect'&&req.method()==='POST');
  await submit.click();
  await expect(page.getByRole('status')).toHaveText('送信しました');
  const event=await eventPromise;
  const payload=event.postDataJSON();
  expect(payload).toEqual({event:'generate_lead',token});
  await attach('analytics',{event:payload.event,token});
  const messages=await mail({to:'qa@example.test',subject:`お問い合わせ ${token}`,textIncludes:token,count:1,settleMs:300});
  await attach('mail',messages);
}

export async function cleanup({request,token,config}) {
  // This endpoint belongs to the local demo only. Real projects provide their own scoped cleanup.
  if(config.environment==='local') {
    const response=await request.delete(`/__test/messages/${encodeURIComponent(token)}`);
    if(response.status()!==204) throw new Error('demo cleanup failed');
  }
}
