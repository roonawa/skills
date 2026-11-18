import { randomUUID } from 'node:crypto';
import { readdirSync, lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checked, content, install, safeName } from './files.js';
import { listSkills, loadSkill, releasedHashes, skillHash, skillSetHash } from './registry.js';
import { parseTemplate, templateFiles, type Template } from './adapter.js';

const config = 'aidev.json';
const hosts = ['.claude/skills','.agents/skills'];
const receipts = '.aidev/installed';
// Lists the hosts verified as a released copy before an update began writing; see updateSkill.
const updating = '.aidev/updating';
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
  const {info,files} = loadSkill(name);
  const result: Record<string,string> = {};
  for (const host of hosts) for (const [path,text] of Object.entries(files)) result[host+'/'+name+'/'+path] = text;
  result[receipts+'/'+name] = info.version+'\n';
  return result;
}
/** The SKILL.md and references/*.md actually present in one host's copy of a Skill; undefined when there is no SKILL.md. */
function installedFiles(root: string, host: string, name: string): Record<string,string> | undefined {
  const base = host+'/'+name;
  const skill = content(checked(root,base+'/SKILL.md'));
  if (skill === undefined) return undefined;
  const files: Record<string,string> = {'SKILL.md':skill};
  const references = checked(root,base+'/references');
  if (lstatSync(references,{throwIfNoEntry:false})) {
    for (const entry of readdirSync(references).sort()) {
      if (entry.endsWith('.md')) files['references/'+entry] = content(checked(root,base+'/references/'+entry)) as string;
    }
  }
  return files;
}
export function addSkill(root: string, name: string, dryRun: boolean) {
  readConfig(root);
  return install(root,skillFiles(name),dryRun);
}

/**
 * Replaces an installed Skill with the bundled version. A copy is replaced only when it is byte-for-byte a released
 * version of the recorded one (line endings aside), so a copy the user edited is never overwritten.
 */
export function updateSkill(root: string, name: string, dryRun: boolean) {
  readConfig(root);
  const {info,files} = loadSkill(name);
  const receipt = content(checked(root,receipts+'/'+name));
  if (receipt === undefined) throw new Error('Skill ' + name + ' は登録されていません。skill add を使ってください。');
  const from = receipt.trim();
  const known = releasedHashes(name)[from] ?? [];
  const target = skillSetHash(files);
  const writes: [string,string][] = [];
  const removed: string[] = [];
  const edited: string[] = [];
  // An interrupted update leaves a mix of old and new files in a host. Hosts verified before it began writing are
  // listed in the marker, so a retry replaces them instead of mistaking the mix for a user edit.
  const markerText = content(checked(root,updating+'/'+name));
  let verified: string[] = [];
  try { verified = markerText === undefined ? [] : hosts.filter(host => (JSON.parse(markerText) as string[]).includes(host)); } catch { /* an unreadable marker vouches for nothing */ }
  const released: string[] = [];
  for (const host of hosts) {
    const base = host+'/'+name+'/';
    const current = installedFiles(root,host,name);
    if (current !== undefined && skillSetHash(current) === target) { released.push(host); continue; }
    if (current !== undefined && !known.includes(skillSetHash(current)) && !verified.includes(host)) {
      edited.push(...Object.keys(current).map(path => base+path));
      continue;
    }
    released.push(host);
    for (const [path,text] of Object.entries(files)) {
      if (current?.[path] === undefined || skillHash(current[path]) !== skillHash(text)) writes.push([base+path,text]);
    }
    // A reference that an earlier release had and this one does not is removed with the replacement.
    for (const path of Object.keys(current ?? {})) if (!Object.hasOwn(files,path)) removed.push(base+path);
  }
  if (edited.length) {
    throw new Error((known.length ? '登録時の版 ' + from + ' から内容が変わっている' : '登録時の版 ' + from + ' の内容が記録にない') +
      'ため、更新しません: ' + edited.join(', ') + '。変更を確認して必要なら退避し、該当ファイルと .aidev/installed/' + name +
      ' を削除してから skill add ' + name + ' を実行してください。');
  }
  const receiptWrite: [string,string][] = from !== info.version ? [[receipts+'/'+name,info.version+'\n']] : [];
  if (!dryRun) {
    // Write each file completely before it replaces the old one; stale references go next and the receipt last, so an
    // interrupted update leaves copies that are either the old or the new release and can be retried.
    const replace = ([path,text]: [string,string]) => {
      const target = checked(root,path);
      mkdirSync(dirname(target),{recursive:true});
      const temp = join(dirname(target),'.aidev-'+randomUUID());
      writeFileSync(temp,text,{flag:'wx'});
      renameSync(temp,target);
    };
    if (writes.length || removed.length) replace([updating+'/'+name,JSON.stringify(released)]);
    writes.forEach(replace);
    for (const path of removed) unlinkSync(checked(root,path));
    receiptWrite.forEach(replace);
    if (markerText !== undefined || writes.length || removed.length) unlinkSync(checked(root,updating+'/'+name));
  }
  return {name,from,to:info.version,pending:[...writes.map(([path]) => path),...removed,...receiptWrite.map(([path]) => path)]};
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
    const recorded = content(checked(root,receipts+'/'+name))?.trim();
    const bundled = loadSkill(name).info.version;
    if (recorded !== undefined && recorded !== bundled) {
      throw new Error('Skill ' + name + ' の配置は版 ' + recorded + '、同梱の版は ' + bundled + ' です。aidev skill update ' + name +
        ' で更新できます（利用者が編集したコピーは更新しません）。');
    }
    const missing = install(root,skillFiles(name),true);
    if (missing.length) throw new Error('配置ファイルが不足しています: '+missing.join(', '));
  }
  return names.sort();
}
