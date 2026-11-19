import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checked } from './files.js';
import type { QaRepository } from './qa-trace-parse.js';
import type { IssueStatus, TraceReport } from './qa-trace.js';

/**
 * The `--html FILE` page of `aidev qa trace`: one self-contained page with the links AC → TC → latest result → Issue.
 * It carries IDs, AC text, TC names, results, issue numbers and run directories, never the free text of result.md
 * (steps, actual results, reasons, notes) nor its evidence cells, which are free text too. Every string from the
 * repository is escaped.
 */

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string));
}

const RESULT_PILL: Record<string, string> = {OK: 'ok', NG: 'ng', '実行不能': 'pending'};
const ISSUE_PILL: Record<IssueStatus, string> = {'確認済み': 'ok', '未確認': 'pending', '要確認': 'pending', '効いていない': 'ng'};

/** The numbers at the top of the page. Each is computed from the JSON report only, so the page and the JSON agree. */
export function traceSummary(report: TraceReport) {
  const latest = new Map<string, string>();
  const tcs = new Set<string>();
  for (const item of report.coverage) {
    for (const tc of item.cases) tcs.add(tc);
    for (const row of item.latest) latest.set(row.tc, row.result);
  }
  const results = [...latest.values()];
  const issues = (status: IssueStatus) => report.issues.filter(issue => issue.status === status).length;
  return {
    acs: report.acs, cases: report.cases, runs: report.runs,
    acCovered: report.coverage.filter(item => item.cases.length).length,
    acUncovered: report.coverage.filter(item => !item.cases.length).length,
    acWithResult: report.coverage.filter(item => item.latest.length).length,
    ok: results.filter(result => result === 'OK').length,
    ng: results.filter(result => result === 'NG').length,
    blocked: results.filter(result => result === '実行不能').length,
    notRun: tcs.size - latest.size,
    confirmed: issues('確認済み'), unconfirmed: issues('未確認'), recheck: issues('要確認'), notFixed: issues('効いていない'),
    errors: report.findings.filter(finding => finding.level === 'error').length,
    warnings: report.findings.filter(finding => finding.level === 'warning').length,
  };
}

const count = (name: string, value: number, tone: string, label: string) =>
  `<span class="n ${tone}" data-count="${name}">${value}</span><span class="l">${label}</span>`;
const headers = (...names: string[]) => names.map(name => `<th scope="col">${escapeHtml(name)}</th>`).join('');
const card = (label: string, counts: string[]) =>
  `<div class="summary-card"><div class="label">${label}</div><div class="counts">${counts.join('')}</div></div>`;

/** Local time with its zone offset, e.g. `2026-11-19 13:40 +09:00`, so the page says which clock it used. */
function timestamp(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const zone = (offset < 0 ? '-' : '+') + two(Math.floor(Math.abs(offset) / 60)) + ':' + two(Math.abs(offset) % 60);
  return date.getFullYear() + '-' + two(date.getMonth() + 1) + '-' + two(date.getDate()) + ' ' + two(date.getHours()) + ':' + two(date.getMinutes()) + ' ' + zone;
}

export function renderTraceHtml(report: TraceReport, repo: QaRepository, generatedAt = new Date()): string {
  const s = traceSummary(report);
  const summary = [
    card('AC の網羅', [count('ac-covered', s.acCovered, 'good', 'TC あり'), count('ac-uncovered', s.acUncovered, s.acUncovered ? 'bad' : 'muted', 'TC なし'),
      count('ac-with-result', s.acWithResult, 'muted', '結果あり')]),
    card('最新の結果（AC につながる TC ごと）', [count('result-ok', s.ok, 'good', 'OK'), count('result-ng', s.ng, 'bad', 'NG'),
      count('result-blocked', s.blocked, 'warn', '実行不能'), count('result-not-run', s.notRun, 'muted', '未実行')]),
    card('Issue の状態', [count('issue-confirmed', s.confirmed, 'good', '確認済み'), count('issue-unconfirmed', s.unconfirmed, 'warn', '未確認'),
      count('issue-recheck', s.recheck, 'warn', '要確認'), count('issue-not-fixed', s.notFixed, 'bad', '効いていない')]),
    card('検査の指摘', [count('finding-error', s.errors, s.errors ? 'bad' : 'muted', 'エラー'), count('finding-warning', s.warnings, 'warn', '警告')]),
  ].join('\n      ');

  const acText = new Map(repo.acceptance.map(item => [item.id, item]));
  const caseName = new Map(repo.cases.map(item => [item.id, item.name]));
  const issueStatus = new Map(report.issues.map(issue => [issue.number, issue.status]));
  const issueBadge = (number: number) => {
    const status = issueStatus.get(number);
    return `<span class="issue"><span class="mono">#${number}</span>${status ? `<span class="pill ${ISSUE_PILL[status]}">${escapeHtml(status)}</span>` : ''}</span>`;
  };

  const acSections = report.coverage.map(item => {
    const ac = acText.get(item.ac);
    const rows = item.cases.map(tc => {
      const latest = item.latest.find(row => row.tc === tc);
      return `<tr>
            <td class="nowrap mono">${escapeHtml(tc)}</td>
            <td>${escapeHtml(caseName.get(tc) ?? '')}</td>
            <td class="nowrap">${latest ? `<span class="pill ${RESULT_PILL[latest.result] ?? 'none'}">${escapeHtml(latest.result)}</span>` : '<span class="pill none">未実行</span>'}</td>
            <td>${latest ? latest.issues.map(issueBadge).join('') : ''}</td>
            <td class="path mono">${latest ? escapeHtml(latest.run) : ''}</td>
          </tr>`;
    }).join('\n          ');
    const table = item.cases.length ? `<div class="table-wrap"><table>
          <thead><tr>${headers('TC-ID', 'テストケース', '最新の結果', 'Issue', 'run')}</tr></thead>
          <tbody>
          ${rows}
          </tbody>
        </table></div>` : '<div class="empty">この AC を参照する TC がありません。</div>';
    return `<div class="ac">
        <div class="ac-head"><span class="ac-id mono">${escapeHtml(item.ac)}</span><span class="ac-text">${escapeHtml(ac?.text ?? '')}</span>${ac?.source ? `<span class="ac-source">出どころ: ${escapeHtml(ac.source)}</span>` : ''}</div>
        ${table}
      </div>`;
  }).join('\n      ');

  const issueRows = report.issues.map(issue => `<tr>
            <td class="nowrap mono">#${issue.number}</td>
            <td class="nowrap"><span class="pill ${ISSUE_PILL[issue.status]}">${escapeHtml(issue.status)}</span></td>
            <td class="mono">${issue.tcs.map(escapeHtml).join('、')}</td>
            <td class="path mono">${escapeHtml(issue.fixRun ?? '')}</td>
          </tr>`).join('\n          ');
  // Findings are rendered from their level, code, message, file and line alone, whatever codes exist. case-not-run can
  // be numerous, so those are folded per cases/ file; the others are listed one by one.
  const level = (finding: TraceReport['findings'][number]) =>
    `<span class="pill ${finding.level === 'error' ? 'ng' : 'pending'}">${finding.level === 'error' ? 'エラー' : '警告'}</span>`;
  const place = (finding: TraceReport['findings'][number]) =>
    escapeHtml(finding.file ?? '') + (finding.line !== undefined ? ':' + finding.line : '');
  const folded = new Map<string, TraceReport['findings']>();
  const single: TraceReport['findings'] = [];
  for (const finding of report.findings) {
    if (finding.code !== 'case-not-run') { single.push(finding); continue; }
    const key = finding.level + '\n' + (finding.file ?? '');
    folded.set(key, [...(folded.get(key) ?? []), finding]);
  }
  const findingRows = [...single.map(finding => `<tr>
            <td class="nowrap">${level(finding)}</td>
            <td class="nowrap mono">${escapeHtml(finding.code)}</td>
            <td>${escapeHtml(finding.message)}</td>
            <td class="path mono">${place(finding)}</td>
          </tr>`), ...[...folded.values()].map(group => `<tr>
            <td class="nowrap">${level(group[0])}</td>
            <td class="nowrap mono">${escapeHtml(group[0].code)}</td>
            <td><details><summary>${escapeHtml(group[0].file ?? '')} の ${group.length} 件</summary><ul class="folded">
              ${group.map(finding => `<li><span class="mono">${place(finding)}</span> ${escapeHtml(finding.message)}</li>`).join('\n              ')}
            </ul></details></td>
            <td class="path mono">${escapeHtml(group[0].file ?? '')}</td>
          </tr>`)].join('\n          ');

  const body = `<section class="part">
    <h2 class="part-title">受け入れ条件ごとのつながり <span class="count">(${report.coverage.length} 件の AC)</span></h2>
      ${acSections || '<div class="empty">受け入れ条件がありません。</div>'}
  </section>

  <section class="part">
    <h2 class="part-title">Issue <span class="count">(${report.issues.length} 件)</span></h2>
    ${report.issues.length ? `<div class="panel table-wrap"><table>
          <thead><tr>${headers('Issue', '状態', 'TC', '改修確認の run')}</tr></thead>
          <tbody>
          ${issueRows}
          </tbody>
        </table></div>` : '<p class="muted">run に書かれた Issue はありません。</p>'}
  </section>

  <section class="part">
    <h2 class="part-title">検査の指摘 <span class="count">(${report.findings.length} 件)</span></h2>
    ${report.findings.length ? `<div class="panel table-wrap"><table>
          <thead><tr>${headers('種類', 'コード', '内容', '場所')}</tr></thead>
          <tbody>
          ${findingRows}
          </tbody>
        </table></div>` : '<p class="muted">指摘はありません。</p>'}
  </section>`;

  const template = readFileSync(fileURLToPath(new URL('../templates/qa-report/trace.html', import.meta.url)), 'utf8');
  // One pass over the template, so placeholder-like text from the repository is never substituted again.
  const values: Record<string, string> = {
    GENERATED_AT: escapeHtml(timestamp(generatedAt)), ACS: String(s.acs), CASES: String(s.cases), RUNS: String(s.runs),
    SUMMARY_CARDS: summary, BODY: body,
  };
  return template.replace(/{{([A-Z_]+)}}/g, (_, key: string) => values[key] ?? '');
}

/** The output path of `--html FILE`, checked before anything is read: relative, no `..` or links, ending in .html or .htm. */
export function traceHtmlPath(root: string, outFile: string): string {
  const out = checked(root, outFile);
  if (!/\.html?$/i.test(outFile)) throw new Error('出力先は .html か .htm で終わるファイル名にしてください。');
  const existing = lstatSync(out, {throwIfNoEntry: false});
  if (existing && !existing.isFile()) throw new Error('出力先は通常ファイルにしてください。');
  return out;
}

/** Writes the page for a repository already read and traced (the repository is not read again). Only `out` is written. */
export function writeTraceHtml(repo: QaRepository, report: TraceReport, out: string): void {
  const html = renderTraceHtml(report, repo);
  mkdirSync(dirname(out), {recursive: true});
  writeFileSync(out, html, 'utf8');
}
