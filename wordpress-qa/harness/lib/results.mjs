import fs from 'node:fs';
import path from 'node:path';

export function releaseGate(rows) {
  return rows.length>0 && rows.every(r=>!r.required || r.status==='pass' || (r.status==='not_applicable' && !!r.reason?.trim()));
}
export function classify(result, annotations) {
  if(result.status==='skipped' && annotations.some(a=>a.type==='qa-review')) return 'review';
  if(result.status==='interrupted' || result.errors?.some(e=>(e.message??'').includes('BLOCKED:'))) return 'blocked';
  return ({passed:'pass',failed:'fail',timedOut:'fail',skipped:'not_run'})[result.status] ?? 'blocked';
}
export function escapeHTML(value) { return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function writeReport(runDir, report) {
  report.gatePassed = releaseGate(report.rows) && !(report.errors?.length) && !report.recovery?.pending && report.runStatus==='finished';
  report.summary = Object.fromEntries(['pass','fail','blocked','not_run','not_applicable','review'].map(s=>[s,report.rows.filter(r=>r.status===s).length]));
  report.preparationCount=report.rows.filter(r=>r.preparationRequired).length;
  const pending=path.join(runDir,`results.${process.pid}.tmp`);
  fs.writeFileSync(pending,JSON.stringify(report,null,2));
  // Windows readers/virus scanners may briefly hold the destination open.
  for(let attempt=0;;attempt++) {
    try{fs.renameSync(pending,path.join(runDir,'results.json'));break;}
    catch(error){
      if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=9)throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);
    }
  }
  const e=escapeHTML;
  const rows=report.rows.map(r=>`<tr><td>${e(r.id)}</td><td>${e(r.title)}</td><td>${r.required?'必須':'参考'}</td><td class="${e(r.status)}">${e(r.status)}</td><td><pre>${e(r.reason)}</pre>${r.setting?`<pre>${e(JSON.stringify(r.setting,null,2))}</pre>`:''}${r.details?`<details><summary>検証内容</summary><pre>${e(JSON.stringify(r.details,null,2))}</pre></details>`:''}${r.diagnostics?`<details><summary>実行経過・失敗時の証拠</summary><pre>${e(JSON.stringify(r.diagnostics,null,2))}</pre></details>`:''}${r.review?`<details open><summary>手動レビュー</summary><pre>${e(JSON.stringify(r.review,null,2))}</pre></details>`:''}${(r.evidence??[]).map(f=>`<a href="${e(f.split('/').map(encodeURIComponent).join('/'))}">${e(f)}</a>`).join('<br>')}</td></tr>`).join('');
  fs.writeFileSync(path.join(runDir,'report.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>QA ${e(report.name)}</title><style>body{font:15px system-ui;max-width:1250px;margin:32px auto;padding:0 20px;color:#172b3a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #cbd5e1;padding:10px;text-align:left;vertical-align:top}th{background:#e9eef4}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.pass{color:#17633b}.fail,.blocked{color:#b21f2d}.review,.not_run{color:#8a5400}a{color:#174ea6}small{color:#526170}</style><h1>${e(report.name)} QA</h1><p>検査台帳の必須条件：<strong>${report.gatePassed?'充足':'未達'}</strong>。これは定義済み検査の判定であり、公開の自動承認ではありません。</p><p>${e(JSON.stringify(report.summary))}</p><small>実行 ${e(report.runId)} / ${e(report.startedAt)} / ${e(report.environment)} / ${e(report.baseURL)}<br>設定SHA256 ${e(report.configHash)} / revision ${e(report.revision??'未指定')} / ${e(report.runtime)}</small><p>未選択の検査もnot_runとして記録。手動確認結果は別途証拠付きで判断してください。</p><pre>${e((report.errors??[]).join('\n'))}</pre><table><thead><tr><th>ID</th><th>確認項目</th><th>重要度</th><th>結果</th><th>根拠・証拠</th></tr></thead><tbody>${rows}</tbody></table></html>`);
}
