import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Run records of the unattended runner (docs/autonomous-runner-design.md 5.2, 5.6).
 * The runner never writes to C-HUB, so these files are what tells it that a task version was already handled
 * and that a run stopped before its result was saved. They live in a fixed directory on the runner host,
 * not in the job's working directory, which is recreated for every job.
 */

/** First 8 hex digits of the SHA-256 of the description, after normalising line ends and trailing spaces. */
export function taskVersion(description: string): string {
  const normalized = description.replace(/\r\n?/g, '\n').split('\n')
    .map(line => line.replace(/[ \t　]+$/, '')).join('\n').replace(/\n+$/, '');
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 8);
}

/** aidev task name for one version of a C-HUB task: `<task ID>-<version>`. */
export function taskNameOf(id: string, description: string): string {
  return id + '-' + taskVersion(description);
}

// aidev task names (src/files.ts safeName): lower case, digits and single hyphens, at most 64 characters.
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isTaskName = (name: string) => namePattern.test(name) && name.length <= 64;

export interface RunResult {
  /** review / needs-human from aidev, or not-eligible / interrupted / runner-error from the runner. */
  state: string;
  reason: string;
  attempts?: number | null;
  url?: string;
}
export interface RunRecord {
  name: string;
  taskId: string;
  board: string;
  title: string;
  startedAt: string;
  finishedAt?: string;
  result?: RunResult;
}

export type RunRecords = ReturnType<typeof createRunRecords>;

export function createRunRecords(directory: string, now: () => Date = () => new Date()) {
  const runs = join(directory, 'runs');
  const file = (name: string) => {
    if (!isTaskName(name)) throw new Error('実行記録の名前が aidev のタスク名の規則に合いません。');
    return join(runs, name + '.json');
  };
  const read = (name: string): RunRecord | undefined => {
    const path = file(name);
    if (!existsSync(path)) return undefined;
    try {
      const record = JSON.parse(readFileSync(path, 'utf8')) as RunRecord;
      if (typeof record !== 'object' || record === null || record.name !== name) throw new Error();
      return record;
    } catch {
      // A damaged record still marks the version as handled; it is reported as interrupted.
      return {name, taskId: '', board: '', title: '', startedAt: ''};
    }
  };
  const replace = (record: RunRecord) => {
    const path = file(record.name);
    const pending = path + '.pending';
    writeFileSync(pending, JSON.stringify(record, null, 2) + '\n', {flush: true});
    renameSync(pending, path);
  };
  return Object.freeze({
    read,
    list(): RunRecord[] {
      if (!existsSync(runs)) return [];
      return readdirSync(runs).filter(entry => entry.endsWith('.json')).map(entry => entry.slice(0, -5))
        .filter(isTaskName).map(name => read(name) as RunRecord);
    },
    /** Creates the record exclusively. False when it already exists, so two runners cannot take the same version. */
    start(record: Omit<RunRecord, 'startedAt' | 'finishedAt' | 'result'>): boolean {
      mkdirSync(runs, {recursive: true});
      let fd: number;
      try {
        fd = openSync(file(record.name), 'wx');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      }
      try {
        writeSync(fd, JSON.stringify({...record, startedAt: now().toISOString()}, null, 2) + '\n');
      } finally {
        closeSync(fd);
      }
      return true;
    },
    finish(name: string, result: RunResult): void {
      const record = read(name);
      if (!record) throw new Error('開始の記録がない実行は終了できません。');
      replace({...record, finishedAt: now().toISOString(), result});
    },
  });
}
