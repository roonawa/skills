import {test,expect,request as requestFactory} from '@playwright/test';
import fs from 'node:fs';
import {inspectSetting,compareSetting} from '../lib/admin.mjs';
import {checkCancellation} from '../lib/cancellation.mjs';
const ctx=JSON.parse(fs.readFileSync(process.env.WPQA_CONTEXT,'utf8'));
test.use({trace:'off',screenshot:'off',video:'off'});
test.beforeEach(()=>checkCancellation(ctx.runDir));
for(const setting of ctx.config.admin??[]) {
  const row=ctx.report.rows.find(r=>r.id==='admin.'+setting.id);
  if(row?.selected)test(row.id+' | '+row.title,async({browser},info)=>{
    const actual=await inspectSetting({setting,config:ctx.config,browser,requestFactory});
    const result={source:setting.source,path:setting.path,...compareSetting(setting,actual)};
    const file=info.outputPath('admin-setting.json');fs.writeFileSync(file,JSON.stringify(result,null,2));
    await info.attach('admin-setting',{path:file,contentType:'application/json'});
    expect(result.matched,'管理設定が期待値と一致しません').toBe(true);
  });
}
