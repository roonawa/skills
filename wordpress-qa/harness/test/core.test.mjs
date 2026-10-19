import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, catalog } from '../lib/config.mjs';
import { releaseGate, classify } from '../lib/results.mjs';

const config = () => ({ name: 'Example', baseURL: 'http://127.0.0.1:4300', environment: 'local',
  pages: [{ id: 'home', path: '/', indexable: true, canonical: 'http://127.0.0.1:4300/' }],
  journeys: [], visuals: [], manual: [] });

test('rejects missing expectations, unknown fields and cross-origin pages', () => {
  assert.throws(() => validateConfig({ ...config(), typo: true }), /Unknown/);
  const c = config(); delete c.pages[0].indexable;
  assert.throws(() => validateConfig(c), /indexable/);
  c.pages[0].indexable = true; c.pages[0].path = 'https://other.invalid/';
  assert.throws(() => validateConfig(c), /same origin/);
});
test('rejects duplicate IDs and unsafe output IDs', () => {
  const c = config(); c.pages.push({ ...c.pages[0] });
  assert.throws(() => validateConfig(c), /Duplicate/);
  c.pages = [{ ...c.pages[0], id: '../outside' }];
  assert.throws(() => validateConfig(c), /id/);
});
test('production journey requires explicit write permission', () => {
  const c = config(); c.environment = 'production';
  c.journeys = [{ id: 'contact', module: './contact.mjs' }];
  assert.throws(() => validateConfig(c), /allowProductionJourneys/);
});
test('rejects malformed optional integration settings', () => {
  for(const mailpit of [false,0,'']) assert.throws(()=>validateConfig({...config(),mailpit}),/mailpit/);
  assert.throws(()=>validateConfig({...config(),policies:[{id:'redirect',path:'/dir/start',statuses:[302],location:123}]}),/location/);
  assert.throws(()=>validateConfig({...config(),journeys:[{id:'contact',module:'contact.mjs',reason:12}]}),/reason/);
});
test('ledger includes unselected suites and manual review', () => {
  const c = config(); c.journeys = [{ id: 'contact', module: './contact.mjs' }];
  c.manual = [{ id: 'design', title: '意図したデザイン', reason: '人の確認が必要' }];
  const rows = catalog(validateConfig(c), 'audit');
  assert.equal(rows.find(x => x.id === 'journey.contact').status, 'not_run');
  assert.equal(rows.find(x => x.id === 'manual.design').status, 'review');
});
test('release gate cannot pass empty, pending, or unexecuted required coverage', () => {
  assert.equal(releaseGate([]), false);
  for (const status of ['fail','blocked','not_run','review'])
    assert.equal(releaseGate([{required:true,status}]), false);
  assert.equal(releaseGate([{required:true,status:'not_applicable'}]), false);
  assert.equal(releaseGate([{required:true,status:'not_applicable',reason:'no upload feature'}]), true);
  assert.equal(releaseGate([{required:true,status:'pass'},{required:false,status:'review'}]), true);
});
test('timeouts fail, interrupted tests block, skipped tests never pass', () => {
  assert.equal(classify({status:'timedOut', errors:[]}, []), 'fail');
  assert.equal(classify({status:'interrupted', errors:[]}, []), 'blocked');
  assert.equal(classify({status:'skipped', errors:[]}, []), 'not_run');
  assert.equal(classify({status:'skipped', errors:[]}, [{type:'qa-review'}]), 'review');
  assert.equal(classify({status:'failed', errors:[{message:'BLOCKED: unavailable'}]}, []), 'blocked');
  assert.equal(classify({status:'failed', errors:[{message:'assert failed'}]}, [{type:'qa-review'}]), 'fail');
});
