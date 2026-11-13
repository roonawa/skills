import { lstatSync, readFileSync, mkdirSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { join, dirname, sep, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

export function safeName(name: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name)) {
    throw new Error('名前には小文字・数字・区切りのハイフンを使用してください。予約名は使用できません。');
  }
  return name;
}

// All callers supply relative paths assembled from constants and validated names.
export function checked(root: string, relative: string): string {
  if (isAbsolute(relative)) throw new Error('絶対パスは使用できません。');
  let current = root;
  for (const part of relative.split(/[\\/]/)) {
    if (!part || part === '.' || part === '..' || part.includes(':')) throw new Error('不正なパスです。');
    current += sep + part;
    if (lstatSync(current, {throwIfNoEntry:false})?.isSymbolicLink()) throw new Error('リンクを含む配置先は使用できません。');
  }
  return current;
}
export function content(path: string): string | undefined {
  const info = lstatSync(path, {throwIfNoEntry:false});
  if (!info) return undefined;
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error('通常ファイル（1 MiB 以下）が必要です。');
  return readFileSync(path,'utf8');
}

export function install(root: string, files: Record<string,string>, dryRun: boolean): string[] {
  const pending = Object.keys(files).filter(relative => {
    const existing = content(checked(root,relative));
    if (existing !== undefined && existing !== files[relative]) throw new Error('既存ファイルと競合しています: ' + relative);
    return existing === undefined;
  });
  if (dryRun) return pending;
  for (const relative of pending) {
    const path = checked(root,relative);
    mkdirSync(dirname(path),{recursive:true});
    const temp = join(dirname(path),'.aidev-' + randomUUID());
    writeFileSync(temp,files[relative],{flag:'wx'});
    try {
      // Publish a complete file without replacing an existing inode.
      linkSync(temp,path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EOPNOTSUPP') {
        // Restricted filesystems may allow exclusive creation but deny hard links.
        try {
          writeFileSync(checked(root,relative),files[relative],{flag:'wx'});
        } catch (createError) {
          if ((createError as NodeJS.ErrnoException).code !== 'EEXIST' ||
              content(checked(root,relative)) !== files[relative]) throw createError;
        }
      } else if (code !== 'EEXIST' || content(checked(root,relative)) !== files[relative]) {
        throw error;
      }
    } finally {
      unlinkSync(temp);
    }
  }
  return pending;
}
