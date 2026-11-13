import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { CheckResult } from './adapter.js';
import { checked, content } from './files.js';

// [gate name, npm script]. The coverage script carries its thresholds as arguments, so the
// repair guard protects them together with the script (test:* is a protected name).
const gates = [
  ['typecheck','typecheck'],['lint','lint'],['test','test'],['coverage','test:coverage'],['build','build'],
] as const;
const hints: Record<string,string> = {
  coverage: 'test が失敗している場合は先に test を直してください。カバレッジ不足なら、未検証の分岐を確かめるテストを追加してください（除外や下限の変更は担当者の判断）。',
};
const captureLimit = 16_384;

// Drain both pipes to completion while retaining only their beginning and end.
function capture(stream: NodeJS.ReadableStream) {
  let first = '';
  let last = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    const remaining = captureLimit - first.length;
    first += chunk.slice(0, remaining);
    if (chunk.length > remaining) last = (last + chunk.slice(remaining)).slice(-captureLimit);
  });
  return () => first + '\n' + last;
}

async function stopTree(pid: number): Promise<boolean> {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
  }
  const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows','System32','taskkill.exe');
  return new Promise(resolve => {
    const killer = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], {
      stdio:'ignore', windowsHide:true, timeout:5000
    });
    killer.once('error', () => resolve(false));
    killer.once('close', code => resolve(code === 0));
  });
}

function npm(root: string, args: string[], timeoutMs = 300_000) {
  // Only fixed arguments from the gate list are passed to the Windows command shell.
  const windows = process.platform === 'win32';
  const command = windows ? 'cmd.exe' : 'npm';
  const argv = windows ? ['/d','/s','/c','npm '+args.join(' ')] : args;
  const child = spawn(command, argv, {
    cwd:root, stdio:['ignore','pipe','pipe'], windowsHide:true, detached:!windows
  });
  const stdout = capture(child.stdout);
  const stderr = capture(child.stderr);
  return new Promise<{status: number | string; output: string}>(resolve => {
    let timedOut = false;
    const timer = setTimeout(async () => {
      timedOut = true;
      const stopped = child.pid !== undefined && await stopTree(child.pid);
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolve({status:stopped ? 'timeout' : 'timeout-cleanup-failed',output:''});
    }, timeoutMs);
    child.once('error', () => {
      if (timedOut) return;
      clearTimeout(timer);
      resolve({status:'起動失敗',output:''});
    });
    child.once('close', (code, signal) => {
      if (timedOut) return;
      clearTimeout(timer);
      resolve({status:code ?? signal ?? '起動失敗',output:stdout() + '\n' + stderr()});
    });
  });
}

function fingerprint(root: string, gate: string, status: number | string, output: string) {
  const normalized = stripVTControlCharacters(output).replaceAll('\\','/')
    .replaceAll(root.replaceAll('\\','/'), '<project>')
    .replaceAll(tmpdir().replaceAll('\\','/') + '/', '<tmp>/')
    .replace(/<tmp>\/[^/\s]+\//g, '<tmp>/')
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z\b/gi, '<time>')
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|milliseconds|seconds|s)\b/gi, '<duration>')
    .replace(/\b(duration_ms:\s*)[\d.]+/gi, '$1<duration>');
  const lines = normalized.split(/\r?\n/).map(line => line.trim()).filter(line =>
    line && !line.startsWith('>') && !line.startsWith('npm ') && !line.startsWith('at '));
  const diagnostics = lines.filter(line =>
    /\berror\b|\bTS\d+:|\blint\/|\bnot ok\b|\bexpected\b|\bactual\b|assertionerror|cannot |failed|exception/i.test(line));
  const evidence = diagnostics.length ? diagnostics : lines;
  return createHash('sha256').update(JSON.stringify([gate,status,evidence])).digest('hex');
}

export async function checkReact(root: string, timeoutMs = 300_000): Promise<CheckResult[]> {
  const manifest = content(checked(root,'package.json'));
  if (!manifest) return [{name:'package.json',status:'failed',detail:'package.json がありません。'}];
  let pkg;
  try { pkg = JSON.parse(manifest); } catch {
    return [{name:'package.json',status:'failed',detail:'package.json を読み取れません。'}];
  }
  let prerequisite: string | undefined;
  if (!existsSync(join(root,'node_modules'))) prerequisite = 'npm ci --ignore-scripts を先に実行してください。';
  else if ((await npm(root,['--version'])).status !== 0) prerequisite = 'npm を実行できません。PATH を確認してください。';

  const results: CheckResult[] = [];
  for (const [name, script] of gates) {
    if (typeof pkg?.scripts?.[script] !== 'string' || !pkg.scripts[script].trim()) {
      results.push({name,status:'failed',detail:'package.json に script "' + script + '" がありません。'});
    } else if (prerequisite) {
      results.push({name,status:'unavailable',detail:prerequisite});
    } else {
      const {status,output} = await npm(root,['run',script],timeoutMs);
      if (status === 'timeout' || status === 'timeout-cleanup-failed') {
        prerequisite = status === 'timeout'
          ? 'タイムアウトしました。プロセスを停止しました。実行時間を確認してください。'
          : 'タイムアウトしました。プロセスの終了を確認してください。';
        results.push({name,status:'unavailable',detail:prerequisite});
        continue;
      }
      results.push(status === 0 ? {name,status:'passed'} : {
        name,status:'failed',detail:'npm run '+script+' で再現できます。終了状態: '+status+(hints[name] ? '。'+hints[name] : ''),
        fingerprint:fingerprint(root,name,status,output)
      });
    }
  }
  return results;
}
