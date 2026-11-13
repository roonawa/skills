import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm run test:react から起動してください。');
const root = mkdtempSync(join(tmpdir(),'aidev-react-smoke-'));
function run(cwd, args, expectedStatus = 0) {
  const result = spawnSync(process.execPath,args,{cwd,encoding:'utf8',windowsHide:true});
  assert.equal(result.status,expectedStatus,result.error?.message ?? result.stdout + result.stderr);
  return result.stdout;
}
try {
  run(root,[cli,'init','web','--template','react']);
  const project = join(root,'web');
  run(project,[npmCli,'ci','--ignore-scripts','--no-audit','--no-fund']);
  const report = JSON.parse(run(project,[cli,'check']));
  assert.deepEqual(report.checks.map(check => [check.name,check.status]),[
    ['typecheck','passed'],['lint','passed'],['test','passed'],['coverage','passed'],['build','passed']
  ]);
  assert.ok(statSync(join(project,'dist','index.html')).size > 0);
  console.log(JSON.stringify(report));
  const source = join(project,'src','score.ts');
  writeFileSync(source,'export const score: number = "0";\n');
  // New code arrives with its test; coverage counts modules that no test imports.
  writeFileSync(join(project,'src','score.test.tsx'), [
    "import assert from 'node:assert/strict';",
    "import { test } from 'node:test';",
    "import { score } from './score';",
    "test('初期スコアは数値の 0', () => assert.equal(score, 0));",
    ''
  ].join('\n'));
  // The security and spec gates come from an AI review; this smoke test supplies a passing one.
  const review = join(project,'.aidev','reviews','score-type.json');
  mkdirSync(join(project,'.aidev','reviews'),{recursive:true});
  writeFileSync(review,JSON.stringify({security:{status:'passed',findings:[]},spec:{status:'passed',findings:[]}}));
  const workflow = [cli,'workflow','check','score-type','--review','.aidev/reviews/score-type.json'];
  const baseline = JSON.parse(run(project,workflow,1));
  assert.equal(baseline.state,'repair');
  assert.ok(baseline.checks.some(check => check.name === 'typecheck' && check.status === 'failed'));
  assert.deepEqual(baseline.checks.filter(check => ['security','spec'].includes(check.name)).map(check => check.status),
    ['passed','passed']);
  writeFileSync(source,'export const score: number = 0;\n');
  const repaired = JSON.parse(run(project,workflow));
  assert.equal(repaired.state,'review');
  assert.equal(repaired.attempts,1);
  console.log(JSON.stringify({task:repaired.task,state:repaired.state,attempts:repaired.attempts}));
  // A module that no test imports must still lower coverage below the threshold.
  writeFileSync(join(project,'src','discount.ts'), [
    'export function discount(total: number, member: boolean): number {',
    '  if (total <= 0) return 0;',
    '  if (member) return Math.floor(total * 0.9);',
    '  if (total >= 10000) return total - 500;',
    '  return total;',
    '}',
    ''
  ].join('\n'));
  const untested = JSON.parse(run(project,[cli,'check'],1));
  assert.deepEqual(untested.checks.filter(check => check.status !== 'passed').map(check => check.name),['coverage']);
  console.log(JSON.stringify({untested:untested.checks.map(check => [check.name,check.status])}));
} finally {
  rmSync(root,{force:true,recursive:true});
}
