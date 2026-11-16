import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { checked, content, safeName } from './files.js';

const root = fileURLToPath(new URL('../skills/core/',import.meta.url));
export interface Skill { name: string; description: string; version: string }
export function parseSkill(name: string, source: string): Skill {
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
export function loadSkill(name: string) {
  const directory = checked(root,safeName(name));
  const source = content(checked(directory,'SKILL.md'));
  if (!source) throw new Error('同梱 Registry に指定の Skill がありません。');
  if (readdirSync(directory).length !== 1) throw new Error('この版は SKILL.md 単体の配布に対応します。');
  return {source,info:parseSkill(name,source)};
}
export function listSkills(): Skill[] {
  return readdirSync(root).sort().map(name => loadSkill(name).info);
}

/** Hash of a Skill's content. Line endings are normalized because a checkout on Windows may convert them. */
export function skillHash(source: string): string {
  return createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
}

/** Content hashes of every released version of a Skill (skills/history.json, written by scripts/skill-history.mjs). */
export function releasedHashes(name: string): Record<string, string[]> {
  const file = fileURLToPath(new URL('../skills/history.json', import.meta.url));
  const text = content(file);
  if (text === undefined) throw new Error('Skill の版の記録（skills/history.json）がありません。');
  const versions: unknown = (JSON.parse(text) as Record<string, unknown>)[safeName(name)];
  if (typeof versions !== 'object' || versions === null) return {};
  const result: Record<string, string[]> = {};
  for (const [version, hashes] of Object.entries(versions)) {
    if (Array.isArray(hashes) && hashes.every(hash => typeof hash === 'string')) result[version] = hashes;
  }
  return result;
}
