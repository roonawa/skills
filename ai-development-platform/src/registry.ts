import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { checked, content, safeName } from './files.js';

export type SkillCategory = 'core' | 'qa';
const categories: {category: SkillCategory; root: string}[] = [
  {category:'core',root:fileURLToPath(new URL('../skills/core/',import.meta.url))},
  {category:'qa',root:fileURLToPath(new URL('../skills/qa/',import.meta.url))},
];
export interface Skill { name: string; description: string; version: string; category: SkillCategory }
export function parseSkill(name: string, source: string): Omit<Skill,'category'> {
  safeName(name);
  const parts = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(source);
  if (!parts || !parts[2].trim()) throw new Error('Skill のメタデータまたは本文がありません。');
  const yaml = parseDocument(parts[1]);
  if (yaml.errors.length || yaml.warnings.length) throw new Error('Skill の YAML が不正です。');
  const data = yaml.toJS({maxAliasCount:0});
  const version = data?.metadata?.version;
  if (data?.name !== name || typeof data.description !== 'string' || !data.description.trim() ||
      data.description.length > 1024 || typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Skill 名、説明、metadata.version を確認してください。');
  }
  return {name,description:data.description.trim(),version};
}
const unsupported = (path: string) => new Error('Skill に配布できないファイルがあります: ' + path);
/** Reads SKILL.md and the .md files directly under references/. Anything else (links, nested directories, other files) is rejected. */
export function readSkillDirectory(directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b) => a.name < b.name ? -1 : 1)) {
    if (entry.isFile() && entry.name === 'SKILL.md') files['SKILL.md'] = content(checked(directory,entry.name)) as string;
    else if (entry.isDirectory() && entry.name === 'references') {
      const base = checked(directory,'references');
      for (const child of readdirSync(base,{withFileTypes:true}).sort((a,b) => a.name < b.name ? -1 : 1)) {
        const path = 'references/' + child.name;
        if (!child.isFile() || !child.name.endsWith('.md')) throw unsupported(path);
        files[path] = content(checked(directory,path)) as string;
      }
    } else throw unsupported(entry.name);
  }
  return files;
}
function findSkill(name: string): {category: SkillCategory; directory: string} | undefined {
  safeName(name);
  const found = categories.filter(({root}) => existsSync(join(root,name)));
  if (found.length > 1) throw new Error('Skill 名が core と qa で重複しています: ' + name);
  return found[0] && {category:found[0].category,directory:checked(found[0].root,name)};
}
export function loadSkill(name: string): {source: string; info: Skill; files: Record<string, string>} {
  const found = findSkill(name);
  if (!found) throw new Error('同梱 Registry に指定の Skill がありません。');
  const files = readSkillDirectory(found.directory);
  const source = files['SKILL.md'];
  if (!source) throw new Error('同梱 Registry に指定の Skill がありません。');
  return {source,info:{...parseSkill(name,source),category:found.category},files};
}
export function listSkills(): Skill[] {
  const names = new Set<string>();
  for (const {root} of categories) if (existsSync(root)) for (const name of readdirSync(root)) names.add(name);
  return [...names].sort().map(name => loadSkill(name).info);
}

/** Hash of a whole Skill. A SKILL.md-only Skill hashes exactly as skillHash does, so existing release records stay valid. */
export function skillSetHash(files: Record<string, string>): string {
  const paths = Object.keys(files).sort();
  if (paths.length === 1 && paths[0] === 'SKILL.md') return skillHash(files['SKILL.md']);
  const hash = createHash('sha256');
  for (const path of paths) hash.update(path + '\0' + files[path].replace(/\r\n/g,'\n') + '\0');
  return hash.digest('hex');
}

/** Hash of a Skill's content. Line endings are normalized because a checkout on Windows may convert them. */
export function skillHash(source: string): string {
  return createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * Content hashes of every released version of a Skill (skills/history.json, written by scripts/skill-history.mjs).
 * The environment variable AIDEV_HISTORY_FILE names another file instead, so tests can use a copy.
 */
export function releasedHashes(name: string): Record<string, string[]> {
  const override = process.env.AIDEV_HISTORY_FILE;
  const file = override ? resolve(override) : fileURLToPath(new URL('../skills/history.json', import.meta.url));
  const text = content(file);
  if (text === undefined) throw new Error('Skill の版の記録（' + (override ? file : 'skills/history.json') + '）がありません。');
  const versions: unknown = (JSON.parse(text) as Record<string, unknown>)[safeName(name)];
  if (typeof versions !== 'object' || versions === null) return {};
  const result: Record<string, string[]> = {};
  for (const [version, hashes] of Object.entries(versions)) {
    if (Array.isArray(hashes) && hashes.every(hash => typeof hash === 'string')) result[version] = hashes;
  }
  return result;
}
