import { readdirSync, lstatSync } from 'node:fs';
import { checked, content, install, safeName } from './files.js';
import { listSkills, loadSkill } from './registry.js';
import { parseTemplate, templateFiles, type Template } from './adapter.js';

const config = 'aidev.json';
const hosts = ['.claude/skills','.agents/skills'];
const receipts = '.aidev/installed';
// Skills call the CLI by name; the path differs per machine, so each worker sets AIDEV_CLI.
const agents = [
  '# 開発規約',
  '既存の設計とテストを確認し、実行結果と残件を報告する。',
  '',
  '## aidev CLI の呼び出し方',
  'このプロジェクトは aidev 開発基盤で管理する。CLI は基盤リポジトリの dist/cli.js で、Node.js 22 以上を使いプロジェクト直下で実行する。各作業者は環境変数 AIDEV_CLI に cli.js の絶対パスを設定する。',
  '',
  '- PowerShell: `node $env:AIDEV_CLI verify`',
  '- bash / zsh: `node "$AIDEV_CLI" verify`',
  '',
  'Skill 内の `aidev …` はこの形式で実行する。AIDEV_CLI が未設定、または指すファイルがない場合は、パスを推測・探索せず担当者に確認する。',
  '',
].join('\n');
export function initialize(root: string, name: string, dryRun: boolean, template: Template = 'core') {
  const directory = checked(root,safeName(name));
  return install(directory,{
    ...templateFiles(template),
    'AGENTS.md':agents,
    'CLAUDE.md':'@AGENTS.md\n',
    [config]:JSON.stringify({schemaVersion:1,template},null,2)+'\n'
  },dryRun);
}
export function readConfig(root: string) {
  const value = content(checked(root,config));
  if (!value) throw new Error('プロジェクト直下で実行してください。aidev.json がありません。');
  let data;
  try { data = JSON.parse(value); } catch { throw new Error('aidev.json の JSON が不正です。'); }
  if (data?.schemaVersion !== 1) throw new Error('未対応の設定バージョンです。');
  return {schemaVersion:1, template:parseTemplate(data.template)};
}
function skillFiles(name: string): Record<string,string> {
  const {info,source} = loadSkill(name);
  const files: Record<string,string> = {};
  for (const host of hosts) files[host+'/'+name+'/SKILL.md'] = source;
  files[receipts+'/'+name] = info.version+'\n';
  return files;
}
export function addSkill(root: string, name: string, dryRun: boolean) {
  readConfig(root);
  return install(root,skillFiles(name),dryRun);
}
export function verify(root: string): string[] {
  readConfig(root);
  const dir = checked(root,receipts);
  const names = lstatSync(dir,{throwIfNoEntry:false}) ? readdirSync(dir) : [];
  const registered = new Set(listSkills().map(skill => skill.name));
  // Also discover managed copies left by an interrupted installation.
  for (const host of hosts) {
    const path = checked(root,host);
    if (!lstatSync(path,{throwIfNoEntry:false})) continue;
    for (const name of readdirSync(path)) {
      if (registered.has(name) && !names.includes(name)) names.push(name);
    }
  }
  for (const name of names) {
    if (!registered.has(name)) {
      const renamed = 'aidev-' + name;
      throw new Error(registered.has(renamed)
        ? 'Skill ' + name + ' は ' + renamed + ' に改名されました。skill add ' + renamed +
          ' を実行し、旧名の配置と .aidev/installed/' + name + ' を内容確認のうえ削除してください。'
        : '同梱 Registry にない Skill が登録されています: ' + name);
    }
    const missing = install(root,skillFiles(name),true);
    if (missing.length) throw new Error('配置ファイルが不足しています: '+missing.join(', '));
  }
  return names.sort();
}
