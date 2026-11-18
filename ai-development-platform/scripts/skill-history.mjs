// Records the content hash of every released version of each bundled Skill in skills/history.json.
// `aidev skill update` replaces an installed copy only when its hash is a known release of the recorded version,
// so a copy the user edited is never overwritten. Run after changing a Skill: `node scripts/skill-history.mjs`.
// The current working-tree versions are always included; earlier ones come from git history and the existing file.
// A qa Skill has several files and is recorded only as it is now (skillSetHash of the whole set), without git history.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { skillHash, skillSetHash, parseSkill, loadSkill } from '../dist/registry.js';

const platform = fileURLToPath(new URL('..', import.meta.url));
const core = join(platform, 'skills', 'core');
const qa = join(platform, 'skills', 'qa');
const output = join(platform, 'skills', 'history.json');
const history = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : {};

function record(name, source) {
  let version;
  try {
    version = parseSkill(name, source).version;
  } catch {
    return; // A historical copy that no longer parses cannot have been installed by this CLI.
  }
  const hashes = (history[name] ??= {})[version] ??= [];
  const hash = skillHash(source);
  if (!hashes.includes(hash)) hashes.push(hash);
}

function recordSet(name) {
  const {files, info} = loadSkill(name);
  const hashes = (history[name] ??= {})[info.version] ??= [];
  const hash = skillSetHash(files);
  if (!hashes.includes(hash)) hashes.push(hash);
}

const git = args => execFileSync('git', args, {cwd: platform, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
let insideGit = true;
try { git(['rev-parse', '--git-dir']); } catch { insideGit = false; }

for (const name of readdirSync(core).sort()) {
  const path = join(core, name, 'SKILL.md');
  if (insideGit) {
    // Paths relative to this directory: `git log` reads pathspecs from the working directory, and `./` makes
    // `git show COMMIT:./PATH` do the same.
    const gitPath = 'skills/core/' + name + '/SKILL.md';
    for (const commit of git(['log', '--format=%H', '--', gitPath]).split('\n').filter(Boolean).reverse()) {
      try { record(name, git(['show', commit + ':./' + gitPath])); } catch { /* deleted in that commit */ }
    }
  }
  record(name, readFileSync(path, 'utf8'));
}

if (existsSync(qa)) for (const name of readdirSync(qa).sort()) recordSet(name);

const sorted = Object.fromEntries(Object.keys(history).sort().map(name => [name,
  Object.fromEntries(Object.keys(history[name]).sort((a, b) => a.localeCompare(b, 'en', {numeric: true}))
    .map(version => [version, history[name][version]]))]));
writeFileSync(output, JSON.stringify(sorted, null, 2) + '\n');
console.log('skills/history.json: ' + Object.keys(sorted).length + ' skills');
