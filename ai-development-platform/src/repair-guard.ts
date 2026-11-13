import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { content } from './files.js';

const ignored = new Set([
  '.git', '.svn', '.hg', '.aidev', '.next', '.nuxt', '.cache', '.tox', '.venv',
  'node_modules', 'vendor', 'coverage', 'dist', 'build', 'builds', 'target',
  'library', 'temp', 'logs', 'obj', 'usersettings',
]);

const testDirectory = /(?:^|\/)(?:__tests__|tests?|specs?|e2e)(?:\/|$)/i;
const testSource = /\.(?:[cm]?[jt]sx?|cs|fs|java|kt|go|rs|py|rb|php|cpp|cc|cxx|swift|feature)$/i;
const testName = /(?:[._-](?:test|tests|spec)|(?:^|\/)test_[^/]+|(?:Test|Tests|Spec))\.[^.]+$/;
const securityFile = /^(?:\.snyk|\.gitleaks(?:ignore|\.toml)|(?:\.semgrep|semgrep|trivy|\.checkov)\.ya?ml|\.semgrepignore|\.trivyignore(?:\.ya?ml)?|\.bandit|\.secrets\.baseline)$/i;
const securityPath = /(?:^|\/)(?:\.semgrep|\.github\/codeql)\/.*\.ya?ml$|^\.github\/workflows\/[^/]*(?:security|codeql|semgrep|gitleaks|snyk|trivy)[^/]*\.ya?ml$/i;
// Settings that decide what lint, type checking and tests enforce. Adding one can disable a check,
// so callers also compare additions (see CONFIG_PREFIX).
const checkConfig = /^(?:(?:ts|js)config(?:\.[\w-]+)?\.json|biome\.jsonc?|\.eslintrc(?:\.(?:[cm]?js|json|ya?ml))?|eslint\.config\.[cm]?[jt]s|(?:vite|vitest|jest|playwright|cypress)\.config\.[cm]?[jt]s|vitest\.workspace\.[cm]?[jt]s|\.mocharc\.(?:[cm]?js|json|jsonc|ya?ml)|\.(?:c8|nyc)rc(?:\.(?:json|ya?ml))?|\.editorconfig|\.globalconfig|Directory\.Build\.(?:props|targets)|[^/]+\.ruleset)$/i;
export const CONFIG_PREFIX = 'config:';
const protectedScript = /^(?:pre|post)?(?:typecheck|lint|test|build)(?:$|:)|(?:^|[:-])(?:audit|security|sast|semgrep|snyk|gitleaks|trivy)(?:$|[:-])/i;

function identity(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function scriptIdentities(path: string): string[] {
  let manifest;
  try {
    manifest = JSON.parse(content(path) ?? '');
  } catch {
    throw new Error('package.json の検査スクリプトを読み取れません。');
  }
  const scripts = Object.entries(manifest?.scripts ?? {}).flatMap(([name, command]) =>
    protectedScript.test(name) && typeof command === 'string'
      ? [identity('script',name,command)] : []);
  // Lint and test runners also read settings embedded in package.json.
  const embedded = ['eslintConfig','jest','mocha','c8','nyc'].flatMap(key =>
    manifest?.[key] === undefined ? [] : [CONFIG_PREFIX + identity('manifest',key,JSON.stringify(manifest[key]))]);
  return [...scripts, ...embedded];
}

/** Only opaque guard identities leave this function. Test contents remain editable; check settings do not. */
export function captureGuard(root: string): string[] {
  const identities: string[] = [];
  function visit(directory: string, prefix: string): void {
    for (const entry of readdirSync(directory, {withFileTypes:true})) {
      const relative = prefix + entry.name;
      const path = join(directory,entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name.toLowerCase())) visit(path,relative + '/');
        continue;
      }
      if (!entry.isFile()) continue;
      if (relative === 'package.json') identities.push(...scriptIdentities(path));
      if (testSource.test(relative) && (testDirectory.test(relative) || testName.test(relative))) {
        identities.push(identity('test',relative));
      }
      if (securityFile.test(entry.name) || securityPath.test(relative)) {
        const policy = content(path);
        if (policy === undefined) throw new Error('セキュリティ検査設定が読み取り中に変更されました。');
        identities.push(identity('policy',relative,policy));
      }
      if (checkConfig.test(entry.name)) {
        const config = content(path);
        if (config === undefined) throw new Error('検査設定が読み取り中に変更されました。');
        identities.push(CONFIG_PREFIX + identity('config',relative,config));
      }
    }
  }
  visit(root,'');
  return identities.sort();
}
