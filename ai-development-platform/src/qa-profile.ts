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
  'aidev-qa-bug-ticket': ['product', 'issue_tracker'],
  'aidev-qa-report': onlyProduct,
};
const minimum: Record<string, Record<string, number>> = {
  'aidev-qa-regression-compare': {environments: 2},
  'aidev-qa-authz-test': {roles: 2},
};
const loginMethods = ['saml', 'oidc', 'form', 'native-form', 'certificate', 'none'];
const evidenceMethods = ['lfs', 'external', 'local'];
const envName = /^[A-Z][A-Z0-9_]*$/;
const productName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** owner/name with the same name rule as the Gitea client ("." and ".." alone are refused). */
const giteaRepo = /^(?!\.+\/)[A-Za-z0-9_.-]+\/(?!\.+$)[A-Za-z0-9_.-]+$/;

const secretPatterns: {name: string; pattern: RegExp}[] = [
  {name: 'Bearer トークン', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/},
  {name: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/},
  {name: 'Cookie', pattern: /^\s*(?:-\s*)?(?:Set-)?Cookie\s*:\s*\S/i},
  {name: 'セッション ID', pattern: /\bsessionid\s*=\s*\S/i},
  {name: '秘密鍵', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/},
  {name: '認証情報を含む URL', pattern: /:\/\/[^\s/:@]+:[^\s/@]+@/},
];
const secretWords = new Set(['password', 'passwd', 'pwd', 'secret', 'token', 'apikey', 'passphrase', 'privatekey', 'credential', 'credentials']);
// Matches only a key and its separator (not the value), so every key on a line is examined in linear time.
const keyValue = /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]+)["']?\s*[:=]\s*/g;
const valueLimit = 1000;

/** A URL that is valid for the profile (http or https) and has no user name, password, query or fragment (a secret may hide there). */
function plainUrl(value: unknown): boolean {
  try {
    if (typeof value !== 'string') return false;
    const parsed = new URL(value.trim());
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch { return false; }
}

/**
 * Whether a key names a credential, judged by the words of the key (split at _ and -), so `pass_rate` or
 * `tokenizer` are not credentials. `*_env` keys hold environment variable names and are never credentials.
 * The one exception: a `*_url` key whose value is a plain URL (for example `password_reset_url`).
 * Used by both the front matter walk and the line scan so they agree.
 */
function isSecretKey(key: string, value: unknown): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[_-]+/).filter(Boolean);
  if (words.length === 0 || words[words.length - 1] === 'env') return false;
  const last = words[words.length - 1];
  const named = last === 'pass' || words.some((word, i) =>
    secretWords.has(word) || ((word === 'api' || word === 'private') && words[i + 1] === 'key'));
  if (!named) return false;
  return !(words[words.length - 1] === 'url' && plainUrl(value));
}

/** A non-empty scalar, or a list or map holding at least one (at any depth). */
function hasScalar(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasScalar);
  if (isObject(value)) return Object.values(value).some(hasScalar);
  return typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && value.trim() !== '');
}

function secretIn(line: string): string | undefined {
  for (const {name, pattern} of secretPatterns) if (pattern.test(line)) return name;
  for (const match of line.matchAll(keyValue)) {
    const key = match[1];
    if (!isSecretKey(key, undefined)) continue;
    // The value is read only for a secret key. Leading quotes and spaces are skipped before the cap is applied,
    // and a value longer than the cap is treated as a secret outright (no *_url exemption, no empty-value skip).
    let start = match.index + match[0].length;
    while (start < line.length && (line[start] === '"' || line[start] === "'" || line[start] === ' ' || line[start] === '\t')) start++;
    const rest = line.slice(start, start + valueLimit + 1);
    const raw = rest.split(/[,}\n]/, 1)[0];
    if (!(raw.length > valueLimit)) {
      const value = raw.replace(/\s+#.*$/, '').replace(/[\s,}\]'"]+$/, '');
      if (!value || !isSecretKey(key, value)) continue;
    }
    return key + ' に値が書かれています';
  }
  return undefined;
}

/** The same rule as the Gitea client: https, or http only to this machine; no user info, query or fragment. */
function giteaUrl(value: unknown): boolean {
  try {
    if (typeof value !== 'string') return false;
    const url = new URL(value);
    const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    return (url.protocol === 'https:' || local) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function checkProfileText(file: string, text: string, skill?: string): ProfileReport {
  return inspectProfileText(file, text, skill).report;
}

/** Checks a profile and also returns its parsed front matter (only when it could be parsed as a map). */
export function inspectProfileText(file: string, text: string, skill?: string): {report: ProfileReport; data?: Record<string, unknown>} {
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
    return {report};
  }
  const yaml = parseDocument(parts[1]);
  if (yaml.errors.length || yaml.warnings.length) {
    error('front-matter', 'front matter の YAML が不正です。');
    return {report};
  }
  const data: unknown = yaml.toJS({maxAliasCount: 0});
  if (!isObject(data)) {
    error('front-matter', 'front matter はキーと値の組で書いてください。');
    return {report};
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

  // The value itself is never put in the message.
  const findSecretKeys = (value: unknown, path: string) => {
    if (Array.isArray(value)) value.forEach((entry, i) => findSecretKeys(entry, path + '[' + i + ']'));
    else if (isObject(value)) {
      for (const [key, entry] of Object.entries(value)) {
        const next = path ? path + '.' + key : key;
        if (isSecretKey(key, entry) && hasScalar(entry)) {
          error('secret', next + ' に値が書かれています。秘密情報は環境変数の名前（' + key + '_env など）だけを書いてください。', next);
        } else findSecretKeys(entry, next);
      }
    }
  };
  findSecretKeys(data, '');

  const shape = (path: string, message: string) => error('format', message, path);
  const url = (value: unknown, path: string) => {
    let parsed: URL | undefined;
    try { if (typeof value === 'string') parsed = new URL(value); } catch { /* invalid */ }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) error('url', 'URL は http: か https: で始まる形で書いてください。', path);
    else if (parsed.username || parsed.password) error('url', path + ' にユーザー名やパスワードを含めないでください。認証情報は環境変数の名前で書いてください。', path);
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

  if (data.issue_tracker !== undefined) {
    const tracker = data.issue_tracker;
    if (!isObject(tracker)) shape('issue_tracker', 'issue_tracker はキーと値の組（type、url、repo）で書いてください。');
    else {
      if (tracker.type !== 'gitea') shape('issue_tracker.type', 'issue_tracker.type は gitea にしてください。');
      if (!giteaUrl(tracker.url)) {
        error('url', 'issue_tracker.url は https:// で始まる URL にしてください（http:// は localhost と 127.0.0.1 だけ）。ユーザー名、パスワード、クエリ、# は含めません。', 'issue_tracker.url');
      }
      if (!(typeof tracker.repo === 'string' && giteaRepo.test(tracker.repo))) {
        shape('issue_tracker.repo', 'issue_tracker.repo は owner/name の形（英数字、_、.、-）で書いてください。');
      }
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
  return {report, data};
}

/** Reads a profile inside the project, checks it and returns the parsed front matter with the report. */
export function loadProfile(root: string, file: string, skill?: string): {report: ProfileReport; data?: Record<string, unknown>} {
  const text = content(checked(root, file));
  if (text === undefined) throw new Error('プロファイルがありません: ' + file);
  return inspectProfileText(file, text, skill);
}

/** Reads and checks a profile inside the project. */
export function checkProfile(root: string, file: string, skill?: string): ProfileReport {
  const text = content(checked(root, file));
  if (text === undefined) throw new Error('プロファイルがありません: ' + file);
  return checkProfileText(file, text, skill);
}
