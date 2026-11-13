import { fileURLToPath } from 'node:url';
import { checked, content } from './files.js';
import { checkReact } from './react.js';
import { checkUnity } from './unity.js';
import type { Finding } from './review.js';

export interface CheckResult {
  name: string;
  status: 'passed' | 'failed' | 'unavailable';
  detail?: string;
  fingerprint?: string;
  /** Review gates only: each finding is tracked separately so that an unresolved issue counts as a repeated failure. */
  findings?: Finding[];
}

const adapters = {
  core: () => [{name:'application', status:'unavailable', detail:'core にはアプリ用の検査がありません。'}],
  react: checkReact,
  unity: checkUnity
} satisfies Record<string, (root: string) => CheckResult[] | Promise<CheckResult[]>>;

export type Template = keyof typeof adapters;

export function parseTemplate(value: unknown): Template {
  if (typeof value !== 'string' || !Object.hasOwn(adapters,value)) {
    throw new Error('未対応のテンプレートです。core、react、unity から選んでください。');
  }
  return value as Template;
}

export function templateFiles(template: Template): Record<string,string> {
  if (template === 'core') return {};
  const source = fileURLToPath(new URL('../templates/'+template+'/',import.meta.url));
  const manifest = content(checked(source,'files.json'));
  if (!manifest) throw new Error('テンプレートの配布一覧がありません。');
  const paths: unknown = JSON.parse(manifest);
  if (!Array.isArray(paths) || !paths.length) throw new Error('テンプレートの配布一覧が不正です。');
  const files: Record<string,string> = Object.create(null);
  for (const path of paths) {
    if (typeof path !== 'string' || Object.hasOwn(files,path)) throw new Error('配布パスが不正です。');
    const value = content(checked(source,path));
    if (value === undefined) throw new Error('配布対象がありません: '+path);
    files[path] = value;
  }
  return files;
}

export async function checkProject(template: Template, root: string) {
  const checks: CheckResult[] = await adapters[template](root);
  const failed = checks.some(check => check.status === 'failed');
  const unavailable = !checks.length || checks.some(check => check.status === 'unavailable');
  return {template, checks, exitCode: failed ? 1 : unavailable ? 2 : 0};
}
