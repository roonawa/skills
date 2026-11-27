// The runner deployment examples (examples/runner) stay usable with the runner as built.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { loadChubConfig } from '../dist/chub.js';

const example = path => fileURLToPath(new URL('../examples/runner/' + path, import.meta.url));

test('the example configuration loads, holds no secret and keeps notifications off', () => {
  const text = readFileSync(example('runner.json'), 'utf8');
  assert.doesNotMatch(text, /token|secret|password/i);
  const config = loadChubConfig(example('runner.json'), {CHUB_TOKEN: 'from-the-environment'});
  assert.equal(config.token, 'from-the-environment');
  assert.ok(config.stateDir);
  assert.deepEqual(config.allowedRepositories, ['ailesys-dev-gitea/aidev-trial']);
  assert.equal(JSON.parse(text).notify, false);
});

test('the example workflow starts by hand only, on the dedicated runner, and runs one task with secrets from Gitea', () => {
  const workflow = parse(readFileSync(example('.gitea/workflows/aidev-runner.yml'), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'], 'schedule stays commented out until stage 3');
  const job = workflow.jobs.run;
  assert.equal(job['runs-on'], 'aidev');
  assert.ok(job['timeout-minutes'] > 0);
  assert.equal(job.env.NODE_OPTIONS, '--use-system-ca');
  const step = job.steps.find(s => typeof s.run === 'string' && s.run.includes('--once'));
  assert.match(step.run, /runner\.js" --once --config runner\.json$/);
  for (const name of ['CHUB_TOKEN', 'GITEA_TOKEN']) assert.equal(step.env[name], '${{ secrets.' + name + ' }}');
  // Secrets reach only the step that needs them.
  assert.ok(!JSON.stringify(job.env).includes('secrets.'));
});
