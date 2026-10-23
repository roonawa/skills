import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { envHeaders } from './lib/mailpit.mjs';
const context=JSON.parse(fs.readFileSync(process.env.WPQA_CONTEXT,'utf8'));
export default defineConfig({
  testDir:'./tests', timeout:context.config.timeoutMs*4, expect:{timeout:context.config.timeoutMs},
  workers:1, retries:0, forbidOnly:true, fullyParallel:false,
  outputDir:path.join(context.runDir,'artifacts'),
  snapshotPathTemplate:path.join(context.baselineDir,'{arg}{ext}'),
  updateSnapshots:'none',
  reporter:[['list'],['./lib/reporter.mjs']],
  use:{baseURL:context.config.baseURL,browserName:'chromium',locale:'ja-JP',timezoneId:'Asia/Tokyo',
    viewport:{width:1280,height:800}, colorScheme:'light',reducedMotion:'reduce',
    extraHTTPHeaders:context.operation?.handlesAuthentication?{}:envHeaders(context.config.headersEnv),
    actionTimeout:context.config.timeoutMs,navigationTimeout:context.config.timeoutMs,
    screenshot:'only-on-failure',trace:process.env.WPQA_OPERATION_ID?'off':'retain-on-failure',serviceWorkers:'block'}
});
