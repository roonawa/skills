import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const sampleDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'qa', 'samples', 'desktop');
const appDir = join(sampleDir, 'app');
const gated = process.platform === 'win32' && process.env.AIDEV_TEST_DESKTOP === '1';

test('desktop sample builds', { skip: !gated }, () => {
  const r = spawnSync('dotnet', ['build', appDir, '-c', 'Release', '--nologo'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
test('desktop profile lists automation ids that exist in xaml', () => {
  const profile = readFileSync(join(sampleDir, 'knowledge', 'sample-desktop', 'profile.md'), 'utf8');
  const xaml = readFileSync(join(appDir, 'MainWindow.xaml'), 'utf8');
  for (const id of ['StockGrid', 'SaveButton', 'DeleteButton', 'StatusText']) {
    assert.ok(profile.includes(id), 'profile ' + id);
    assert.ok(xaml.includes('AutomationProperties.AutomationId="' + id + '"'), 'xaml ' + id);
  }
});
test('desktop sample stock.csv has header and 5 rows', () => {
  const lines = readFileSync(join(appDir, 'stock.csv'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  assert.equal(lines[0], '品名,数量,置き場所');
  assert.equal(lines.length, 6);
});
