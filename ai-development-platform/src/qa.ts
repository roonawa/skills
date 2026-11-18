import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { checked } from './files.js';
import { checkProfile } from './qa-profile.js';
import type { CheckResult } from './adapter.js';

/** Checks every knowledge/<product>/profile.md. Reports error codes and paths only, never the matched text. */
export function checkQa(root: string): CheckResult[] {
  const base = checked(root, 'knowledge');
  const products = existsSync(base)
    ? readdirSync(base, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    : [];
  const results: CheckResult[] = [];
  for (const product of products) {
    const file = 'knowledge/' + product + '/profile.md';
    if (!existsSync(join(base, product, 'profile.md'))) continue;
    const name = 'profile:' + product;
    try {
      const {errors} = checkProfile(root, file);
      results.push(errors.length
        ? {name, status: 'failed', detail: errors.map(e => e.code + (e.path ? ' ' + e.path : '') + (e.line ? ' (行 ' + e.line + ')' : '')).join('、')}
        : {name, status: 'passed'});
    } catch (error) {
      results.push({name, status: 'failed', detail: error instanceof Error ? error.message : String(error)});
    }
  }
  if (!results.length) results.push({name: 'profile', status: 'unavailable', detail: 'knowledge/<製品名>/profile.md がありません。knowledge/profile.template.md をコピーして作成してください。'});
  return results;
}
