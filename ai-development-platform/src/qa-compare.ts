import { lstatSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checked, content } from './files.js';

export interface CompareResult { round: number; status: string; note?: string; screenshot?: string; screenshots?: string[] }
export interface CompareManifest {
  title: string; customer?: string; generatedAt?: string; rounds: string[];
  screens: { screen: string; testCases: { name: string; note?: string; results: CompareResult[] }[] }[];
}
export interface RenderOptions { link: boolean; outDir: string }

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MIME: Record<string,string> = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'};
const LABEL = {ok:'OK',ng:'NG',pending:'未実施'};

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string));
}
/** Normalise status spellings: pass/passed -> ok, fail/failed -> ng, anything else -> pending. */
function statusKey(status: unknown): 'ok' | 'ng' | 'pending' {
  const key = String(status ?? '').toLowerCase();
  if (key === 'ok' || key === 'pass' || key === 'passed') return 'ok';
  if (key === 'ng' || key === 'fail' || key === 'failed') return 'ng';
  return 'pending';
}
function isObject(value: unknown): value is Record<string,unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, where: string, optional = false): void {
  if (value === undefined && optional) return;
  if (typeof value !== 'string') throw new Error('マニフェストの形式が不正です: ' + where + ' は文字列にしてください。');
}
function validate(manifest: unknown): asserts manifest is CompareManifest {
  if (!isObject(manifest)) throw new Error('マニフェストの形式が不正です: オブジェクトが必要です。');
  text(manifest.title,'title'); text(manifest.customer,'customer',true); text(manifest.generatedAt,'generatedAt',true);
  if (!Array.isArray(manifest.rounds) || !manifest.rounds.length) throw new Error('マニフェストの形式が不正です: rounds は 1 件以上の配列にしてください。');
  manifest.rounds.forEach((r,i) => text(r,'rounds['+i+']'));
  if (!Array.isArray(manifest.screens)) throw new Error('マニフェストの形式が不正です: screens は配列にしてください。');
  const count = manifest.rounds.length;
  manifest.screens.forEach((screen: unknown, s: number) => {
    if (!isObject(screen) || !Array.isArray(screen.testCases)) throw new Error('マニフェストの形式が不正です: screens['+s+'] に screen と testCases が必要です。');
    text(screen.screen,'screens['+s+'].screen');
    screen.testCases.forEach((tc: unknown, c: number) => {
      const at = 'screens['+s+'].testCases['+c+']';
      if (!isObject(tc) || !Array.isArray(tc.results)) throw new Error('マニフェストの形式が不正です: ' + at + ' に name と results が必要です。');
      text(tc.name,at+'.name'); text(tc.note,at+'.note',true);
      tc.results.forEach((r: unknown, i: number) => {
        const rat = at+'.results['+i+']';
        if (!isObject(r) || !Number.isInteger(r.round) || (r.round as number) < 0 || (r.round as number) >= count) {
          throw new Error('マニフェストの形式が不正です: ' + rat + '.round は 0 以上 ' + count + ' 未満の整数にしてください。');
        }
        text(r.status,rat+'.status'); text(r.note,rat+'.note',true); text(r.screenshot,rat+'.screenshot',true);
        if (r.screenshots !== undefined && (!Array.isArray(r.screenshots) || r.screenshots.some(p => typeof p !== 'string'))) {
          throw new Error('マニフェストの形式が不正です: ' + rat + '.screenshots は文字列の配列にしてください。');
        }
      });
    });
  });
}

function readImage(manifestDir: string, relative: string): {path: string; data: Buffer; mime: string} {
  const mime = MIME[extname(relative).toLowerCase()];
  if (!mime) throw new Error('画像の拡張子は png/jpg/jpeg/gif/webp のみ使用できます: ' + relative);
  let path: string;
  try { path = checked(manifestDir, relative); }
  catch (error) { throw new Error('画像のパスが使用できません: ' + relative + '（' + (error as Error).message + '）'); }
  const info = lstatSync(path, {throwIfNoEntry:false});
  if (!info) throw new Error('画像が見つかりません: ' + relative);
  if (!info.isFile()) throw new Error('画像は通常ファイルにしてください: ' + relative);
  if (info.size > MAX_IMAGE_BYTES) throw new Error('画像が 20 MiB を超えています: ' + relative);
  return {path, data: readFileSync(path), mime};
}

export function renderCompareReport(manifestDir: string, manifest: CompareManifest, options: RenderOptions):
    {html: string; assets: Record<string,string>; images: number} {
  validate(manifest);
  const {rounds} = manifest;
  const assets: Record<string,string> = {};
  let images = 0;
  const imageSource = (relative: string): string => {
    const image = readImage(manifestDir, relative);
    images += 1;
    if (!options.link) return 'data:' + image.mime + ';base64,' + image.data.toString('base64');
    const asset = 'assets/' + relative.split(/[\\/]/).join('/');
    assets[asset] = image.path;
    return asset.split('/').map(encodeURIComponent).join('/');
  };

  const counts = rounds.map(() => ({ok:0,ng:0,pending:0}));
  for (const screen of manifest.screens) for (const tc of screen.testCases) for (const r of tc.results) counts[r.round][statusKey(r.status)] += 1;
  const summary = rounds.map((label,i) => {
    const c = counts[i];
    return `
    <div class="summary-card">
      <div class="round-label">${escapeHtml(label)}</div>
      <div class="counts">
        <span class="n good">${c.ok}</span><span class="l">OK</span>
        <span class="n bad">${c.ng}</span><span class="l">NG</span>
        ${c.pending ? `<span class="n muted">${c.pending}</span><span class="l">未実施</span>` : ''}
      </div>
    </div>`;
  }).join('\n');

  const roundCard = (tc: CompareManifest['screens'][number]['testCases'][number], index: number): string => {
    const label = rounds[index];
    const result = tc.results.find(r => r.round === index);
    if (!result) {
      return `
      <div class="round-card">
        <div class="round-head"><span class="round-name">${escapeHtml(label)}</span><span class="pill pending">対象外</span></div>
        <div class="no-shot">このラウンドでは未実施</div>
      </div>`;
    }
    const key = statusKey(result.status);
    const paths = result.screenshots ?? (result.screenshot ? [result.screenshot] : []);
    const sources = paths.map(imageSource);
    const shots = sources.length
      ? `<div class="shot-wrap">${sources.map(src => `<img src="${escapeHtml(src)}" alt="${escapeHtml(tc.name)} - ${escapeHtml(label)}">`).join('')}</div>`
      : '<div class="no-shot">スクリーンショットなし</div>';
    const note = result.note ? `<div class="round-note">${escapeHtml(result.note)}</div>` : '';
    return `
      <div class="round-card">
        <div class="round-head"><span class="round-name">${escapeHtml(label)}</span><span class="pill ${key}">${LABEL[key]}</span></div>
        ${shots}
        ${note}
      </div>`;
  };
  const body = manifest.screens.map(screen => `
  <section class="screen">
    <h2 class="screen-title">${escapeHtml(screen.screen)} <span class="count">(${screen.testCases.length}件のテストケース)</span></h2>
    ${screen.testCases.map(tc => `
    <div class="testcase">
      <div class="testcase-head">
        <div class="testcase-name">${escapeHtml(tc.name)}</div>
        ${tc.note ? `<div class="testcase-note">${escapeHtml(tc.note)}</div>` : ''}
      </div>
      <div class="rounds-grid">
        ${rounds.map((_,i) => roundCard(tc,i)).join('\n')}
      </div>
    </div>`).join('\n')}
  </section>`).join('\n');

  const template = readFileSync(fileURLToPath(new URL('../templates/qa-report/compare.html', import.meta.url)), 'utf8');
  // One pass over the template, so placeholder-like text in the manifest is never substituted again.
  const values: Record<string,string> = {
    TITLE: escapeHtml(manifest.title || 'エビデンス比較レポート'), CUSTOMER: escapeHtml(manifest.customer ?? ''),
    GENERATED_AT: escapeHtml(manifest.generatedAt ?? ''), SCREEN_COUNT: String(manifest.screens.length),
    ROUND_COUNT: String(rounds.length), SUMMARY_CARDS: summary, BODY: body,
  };
  const html = template.replace(/{{([A-Z_]+)}}/g, (_, key: string) => values[key] ?? '');
  return {html, assets, images};
}

export function compareReport(root: string, manifestFile: string, outFile: string, link: boolean):
    {out: string; screens: number; testCases: number; images: number} {
  const manifestPath = checked(root, manifestFile);
  const out = checked(root, outFile);
  if (out.toLowerCase() === manifestPath.toLowerCase()) throw new Error('出力先がマニフェストと同じです: ' + outFile);
  if (!/\.html?$/i.test(outFile)) throw new Error('出力先は .html で終わるファイル名にしてください: ' + outFile);
  const raw = content(manifestPath);
  if (raw === undefined) throw new Error('マニフェストが見つかりません: ' + manifestFile);
  let manifest: unknown;
  try { manifest = JSON.parse(raw); } catch { throw new Error('マニフェストを JSON として読めません: ' + manifestFile); }
  const outDir = dirname(out);
  const {html, assets, images} = renderCompareReport(dirname(manifestPath), manifest as CompareManifest, {link, outDir});
  const existing = lstatSync(out, {throwIfNoEntry:false});
  if (existing && !existing.isFile()) throw new Error('出力先は通常ファイルにしてください: ' + outFile);
  // Plan every asset copy first so a conflict leaves nothing half written.
  const outRelative = outFile.split(/[\\/]/).slice(0,-1);
  const copies = Object.entries(assets).map(([asset,source]) => {
    const target = checked(root, [...outRelative, ...asset.split('/')].join('/'));
    const found = lstatSync(target, {throwIfNoEntry:false});
    if (found && (!found.isFile() || !readFileSync(target).equals(readFileSync(source)))) {
      throw new Error('既存の画像と競合しています: ' + asset);
    }
    return {target, source, exists: !!found};
  });
  mkdirSync(outDir, {recursive:true});
  for (const copy of copies) {
    if (copy.exists) continue;
    mkdirSync(dirname(copy.target), {recursive:true});
    copyFileSync(copy.source, copy.target);
  }
  writeFileSync(out, html, 'utf8');
  const m = manifest as CompareManifest;
  return {out: outFile, screens: m.screens.length, testCases: m.screens.reduce((n,s) => n + s.testCases.length, 0), images};
}
