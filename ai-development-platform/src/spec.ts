import { checked, content } from './files.js';

/**
 * Checks a task specification before `workflow run` spends money on sessions. Only the shape is checked
 * mechanically; whether the criteria are right is for people and the review gate.
 *
 * Format (Markdown headings or `見出し:` lines, as in the C-HUB request template):
 *   受け入れ条件  - AC-001: 観測できる結果 …   (required; `取り下げ` keeps the number but drops the criterion)
 *   やらないこと  - …                          (required)
 *   判断待ち      なし                          (optional; any open item stops the run)
 */
export interface SpecIssue {code: string; message: string; line?: number}
export interface SpecReport {
  file: string;
  acceptance: string[];
  withdrawn: string[];
  outOfScope: number;
  pending: string[];
  errors: SpecIssue[];
  warnings: SpecIssue[];
}

const sectionNames = ['受け入れ条件', 'やらないこと', '判断待ち'] as const;
type Section = typeof sectionNames[number] | 'other';
const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const label = /^\s*(受け入れ条件|やらないこと|判断待ち)\s*[:：]\s*(.*)$/;
const criterion = /^\s*(?:[-*・]\s*)?(AC-\d{1,6})\s*[:：]\s*(.*)$/;
const item = /^\s*(?:[-*・]|\d+[.)]|\|)\s*(.*)$/;
const none = /^(?:なし|特になし|該当なし|ありません|none)[。.]?$/i;
// Words that cannot be judged as written (aidev-requirements: use values or mark ⚠要確認).
const vague = ['適切', '正しく', '速やかに', '短時間', 'ほぼ', '十分', 'なるべく', 'いい感じ', '必要に応じて', '可能な限り', 'など'];
const maxCriteria = 10;

function sectionOf(title: string): Section {
  const name = sectionNames.find(section => title.includes(section));
  return name ?? 'other';
}

export function checkSpecText(file: string, text: string): SpecReport {
  const report: SpecReport = {file, acceptance: [], withdrawn: [], outOfScope: 0, pending: [], errors: [], warnings: []};
  const error = (code: string, message: string, line?: number) => report.errors.push({code, message, ...(line ? {line} : {})});
  const warn = (code: string, message: string, line?: number) => report.warnings.push({code, message, ...(line ? {line} : {})});
  const seen = new Set<string>();
  const found = new Set<Section>();
  let section: Section = 'other';
  let outOfScopeNone = false;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, index) => {
    const number = index + 1;
    const title = heading.exec(line);
    const labelled = label.exec(line);
    if (title) {
      section = sectionOf(title[1]);
      found.add(section);
      return;
    }
    let rest = line;
    if (labelled) {
      section = labelled[1] as Section;
      found.add(section);
      rest = labelled[2];
      if (!rest.trim()) return;
    }
    if (/⚠\s*要確認/.test(line)) error('unconfirmed', '⚠要確認 が残っています。値を決めるか、判断待ちに移してください。', number);
    if (section === '受け入れ条件') {
      const match = criterion.exec(rest);
      if (!match) return;
      const [, id, description] = match;
      if (seen.has(id)) error('duplicate-id', id + ' が重複しています。番号は振り直さず、1つの AC に1つの番号を使ってください。', number);
      seen.add(id);
      const body = description.trim();
      if (/^取り下げ/.test(body)) { report.withdrawn.push(id); return; }
      if (!body) { error('empty-criterion', id + ' に内容がありません。', number); return; }
      if (/判断待ち/.test(body)) error('pending-criterion', id + ' が判断待ちです。判断が出てから実装に回してください。', number);
      report.acceptance.push(id);
      const words = vague.filter(word => body.includes(word));
      if (words.length) warn('vague-criterion', id + ' に判定できない語（' + words.join('・') + '）があります。具体的な値にしてください。', number);
      return;
    }
    const entry = item.exec(rest);
    const value = (entry ? entry[1] : rest).replace(/\|/g, ' ').trim();
    if (!value || /^[-:\s]+$/.test(value) || /^(?:ID|論点)\b/.test(value)) return;
    if (section === 'やらないこと') {
      if (none.test(value)) outOfScopeNone = true;
      else report.outOfScope += 1;
    }
    if (section === '判断待ち' && !none.test(value)) report.pending.push(value.slice(0, 120));
  });
  if (!found.has('受け入れ条件')) error('missing-acceptance-section', '「受け入れ条件」の節がありません。');
  if (!report.acceptance.length) error('no-criteria', '受け入れ条件に `- AC-001: …` の形の行が1件もありません。');
  if (!found.has('やらないこと')) error('missing-out-of-scope', '「やらないこと」の節がありません。関係者が期待しそうだが今回扱わないことを書いてください。');
  else if (!report.outOfScope) warn(outOfScopeNone ? 'out-of-scope-none' : 'empty-out-of-scope',
    '「やらないこと」が空です。実装が範囲を広げすぎたかをレビューが判定できません。');
  if (report.pending.length) error('open-questions', '判断待ちが ' + report.pending.length + ' 件残っています。判断が出るまで実装に回さないでください。');
  if (report.acceptance.length > maxCriteria) warn('too-large', '受け入れ条件が ' + report.acceptance.length +
    ' 件あります。1タスクには大きすぎる可能性があります。aidev-task-planning で分けることを検討してください。');
  return report;
}

/** Reads and checks a specification inside the project. */
export function checkSpec(root: string, relative: string): SpecReport {
  const text = content(checked(root, relative));
  if (text === undefined) throw new Error('仕様書がありません: ' + relative);
  return checkSpecText(relative, text);
}
