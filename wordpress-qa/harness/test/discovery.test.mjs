import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sitemapEntries } from '../lib/discovery.mjs';
test('extracts URL sets and sitemap indexes without inventing expectations', () => {
  assert.deepEqual(sitemapEntries('<urlset><url><loc>https://example.test/a?x=1&amp;y=2</loc></url></urlset>','https://example.test'),{kind:'pages',urls:['https://example.test/a?x=1&y=2']});
  assert.deepEqual(sitemapEntries('<sitemapindex><sitemap><loc>https://example.test/child.xml</loc></sitemap></sitemapindex>','https://example.test'),{kind:'sitemaps',urls:['https://example.test/child.xml']});
  assert.throws(()=>sitemapEntries('<html>Login</html>','https://example.test'),/sitemap/);
  assert.throws(()=>sitemapEntries('<urlset><url><loc>https://other.test/</loc></url></urlset>','https://example.test'),/same origin/);
});
