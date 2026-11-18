import { parseDocument } from 'yaml';
import { checked, content } from './files.js';

/**
 * Checks a QA project profile (Markdown with YAML front matter) before QA Skills rely on it. Only the shape is
 * checked mechanically. Credentials never belong in the profile: roles name environment variables instead.
 */
export interface ProfileIssue {code: string; message: string; path?: string; line?: number}
export interface ProfileReport {file: string; product?: string; errors: ProfileIssue[]; warnings: ProfileIssue[]}

const onlyProduct = ['product'];
/** Required profile fields per QA Skill (design 5.1). Some also need a minimum count, see `minimum`. */
export const profileRequirements: Record<string, string[]> = {
  'aidev-qa-strategy': onlyProduct,
  'aidev-qa-test-design': onlyProduct,
  'aidev-qa-test-review': onlyProduct,
  'aidev-qa-test-run': ['product', 'test_commands'],
  'aidev-qa-characterization': ['product', 'environments', 'roles', 'stack', 'evidence'],
  'aidev-qa-regression-compare': ['product', 'environments', 'evidence'],
  'aidev-qa-authz-test': ['product', 'environments', 'roles', 'login'],
  'aidev-qa-login-session': ['product', 'environments', 'roles', 'login'],
  'aidev-qa-desktop-gui': ['product', 'stack', 'evidence'],
  'aidev-qa-screen-verification': onlyProduct,
  'aidev-qa-fix-verify': onlyProduct,
  'aidev-qa-cause-repro': onlyProduct,
  'aidev-qa-bug-ticket': onlyProduct,
  'aidev-qa-report': onlyProduct,
};
const minimum: Record<string, Record<string, number>> = {
  'aidev-qa-regression-compare': {environments: 2},
  'aidev-qa-authz-test': {roles: 2},
};
const loginMethods = ['saml', 'oidc', 'form', 'certificate', 'none'];
const evidenceMethods = ['lfs', 'external', 'local'];
const envName = /^[A-Z][A-Z0-9_]*$/;
const productName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const secretPatterns: {name: string; pattern: RegExp}[] = [
  {name: 'Bearer トークン', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/},
  {name: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/},
  {name: 'Cookie', pattern: /^\s*(?:-\s*)?(?:Set-)?Cookie\s*:\s*\S/i},
  {name: 'セッション ID', pattern: /\bsessionid\s*=\s*\S/i},
  {name: '秘密鍵', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/},
];
const keyValue = /([A-Za-z0-9_-]*(?:password|passwd|secret|token)[A-Za-z0-9_-]*)["']?\s*[:=]\s*([^,}\n]+)/ig;

function secretIn(line: string): string | undefined {
  for (const {name, pattern} of secretPatterns) if (pattern.test(line)) return name;
  for (const match of line.matchAll(keyValue)) {
    const key = match[1];
    if (/_env$/i.test(key)) continue;
    const value = match[2].replace(/\s+#.*$/, '').replace(/[\s,}\]'"]+$/, '').replace(/^['"\s]+/, '');
    if (!value) continue;
    return key + ' に値が書かれています';
  }
  return undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function checkProfileText(file: string, text: string, skill?: string): ProfileReport {
  if (skill !== undefined && !Object.hasOwn(profileRequirements, skill)) {
    throw new Error('不明な Skill 名です: ' + skill + '（' + Object.keys(profileRequirements).join(', ') + '）');
  }
  const report: ProfileReport = {file, errors: [], warnings: []};
  const error = (code: string, message: string, path?: string, line?: number) =>
    report.errors.push({code, message, ...(path ? {path} : {}), ...(line ? {line} : {})});
  const normalized = text.replace(/\r\n?/g, '\n');
  normalized.split('\n').forEach((line, index) => {
    const found = secretIn(line);
    if (found) error('secret', '秘密情報らしい記述があります（' + found + '）。環境変数の名前だけを書いてください。', undefined, index + 1);
  });
  const parts = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!parts) {
    error('front-matter', '先頭に --- で囲んだ YAML の front matter がありません。');
    return report;
  }
  const yaml = parseDocument(parts[1]);
  if (yaml.errors.length || yaml.warnings.length) {
    error('front-matter', 'front matter の YAML が不正です。');
    return report;
  }
  const data: unknown = yaml.toJS({maxAliasCount: 0});
  if (!isObject(data)) {
    error('front-matter', 'front matter はキーと値の組で書いてください。');
    return report;
  }
  if (typeof data.product === 'string') report.product = data.product;

  const checkEnvNames = (value: unknown, path: string) => {
    if (Array.isArray(value)) value.forEach((entry, i) => checkEnvNames(entry, path + '[' + i + ']'));
    else if (isObject(value)) {
      for (const [key, entry] of Object.entries(value)) {
        const next = path ? path + '.' + key : key;
        if (key.endsWith('_env') && !(typeof entry === 'string' && envName.test(entry))) {
          error('env-name', key + ' には環境変数の名前（大文字・数字・アンダースコア）だけを書いてください。値は書けません。', next);
        } else checkEnvNames(entry, next);
      }
    }
  };
  checkEnvNames(data, '');

  const shape = (path: string, message: string) => error('format', message, path);
  const url = (value: unknown, path: string) => {
    let ok = false;
    try { ok = typeof value === 'string' && ['http:', 'https:'].includes(new URL(value).protocol); } catch { /* invalid */ }
    if (!ok) error('url', 'URL は http: か https: で始まる形で書いてください。', path);
  };
  const list = (key: string, each: (entry: Record<string, unknown>, path: string) => void) => {
    const value = data[key];
    if (value === undefined) return;
    if (!Array.isArray(value)) { shape(key, key + ' は一覧で書いてください。'); return; }
    value.forEach((entry, i) => {
      const path = key + '[' + i + ']';
      if (!isObject(entry)) shape(path, path + ' はキーと値の組で書いてください。');
      else each(entry, path);
    });
  };
  const text1 = (entry: Record<string, unknown>, key: string, path: string) => {
    if (typeof entry[key] !== 'string' || !entry[key].trim()) shape(path + '.' + key, path + '.' + key + ' が必要です。');
  };

  if (data.product !== undefined && !(typeof data.product === 'string' && productName.test(data.product) && data.product.length <= 64)) {
    shape('product', 'product は小文字・数字・ハイフンで書いてください。');
  }
  list('environments', (entry, path) => {
    text1(entry, 'name', path);
    if (entry.url !== undefined) url(entry.url, path + '.url');
  });
  list('roles', (entry, path) => text1(entry, 'name', path));
  if (data.login !== undefined) {
    const login = data.login;
    if (!isObject(login)) shape('login', 'login はキーと値の組で書いてください。');
    else {
      if (!loginMethods.includes(login.method as string)) shape('login.method', 'login.method は ' + loginMethods.join('・') + ' のどれかにしてください。');
      if (login.entry_url !== undefined) url(login.entry_url, 'login.entry_url');
      if (login.certificate_thumbprint !== undefined &&
          !(typeof login.certificate_thumbprint === 'string' && /^[0-9a-fA-F]{40}$/.test(login.certificate_thumbprint))) {
        shape('login.certificate_thumbprint', 'login.certificate_thumbprint は40桁の16進数で書いてください。');
      }
    }
  }
  if (data.stack !== undefined && !(Array.isArray(data.stack) && data.stack.every(item => typeof item === 'string'))) {
    shape('stack', 'stack は文字列の一覧で書いてください。');
  }
  list('test_commands', (entry, path) => { text1(entry, 'name', path); text1(entry, 'run', path); });
  if (data.evidence !== undefined) {
    const evidence = data.evidence;
    if (!isObject(evidence)) shape('evidence', 'evidence はキーと値の組で書いてください。');
    else {
      if (!evidenceMethods.includes(evidence.method as string)) shape('evidence.method', 'evidence.method は ' + evidenceMethods.join('・') + ' のどれかにしてください。');
      if (evidence.retention !== undefined && typeof evidence.retention !== 'string') shape('evidence.retention', 'evidence.retention は 90d のような文字列で書いてください。');
    }
  }

  const required = skill === undefined ? onlyProduct : profileRequirements[skill];
  for (const key of required) {
    const value = data[key];
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    const least = skill === undefined ? undefined : minimum[skill]?.[key];
    if (empty) error('required', key + ' が必要です' + (skill ? '（' + skill + '）。' : '。'), key);
    else if (least !== undefined && (!Array.isArray(value) || value.length < least)) {
      error('required', key + ' は ' + least + ' 件以上必要です（' + skill + '）。', key);
    }
  }
  return report;
}

/** Reads and checks a profile inside the project. */
export function checkProfile(root: string, file: string, skill?: string): ProfileReport {
  const text = content(checked(root, file));
  if (text === undefined) throw new Error('プロファイルがありません: ' + file);
  return checkProfileText(file, text, skill);
}
