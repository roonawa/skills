import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopedHeaders } from '../lib/headers.mjs';
test('browser authentication headers are not forwarded to third-party assets',()=>{
  const headers={accept:'*/*',authorization:'Bearer test-only','x-preview-key':'test-only'};
  const configured={Authorization:'Bearer test-only','X-Preview-Key':'test-only'};
  assert.deepEqual(scopedHeaders(headers,configured,'https://third.test/font','https://site.test'),{accept:'*/*'});
  assert.equal(scopedHeaders(headers,configured,'https://site.test/path','https://site.test').authorization,'Bearer test-only');
});
