'use strict';

const { escapeHtml, inlineFormat } = require('./html-utils');

function renderMetaTable(meta) {
  const rows = meta
    .map(({ key, value }) => `<tr><th>${escapeHtml(key)}</th><td>${inlineFormat(value)}</td></tr>`)
    .join('\n');
  return `<table class="meta-table">\n${rows}\n</table>`;
}

function renderReferenceSection(id, heading, text) {
  if (!text) return '';
  const body = escapeHtml(text)
    .split('\n')
    .map((line) => `<p>${line || '&nbsp;'}</p>`)
    .join('\n');
  return `<details class="reference-section" id="${id}">
<summary>${escapeHtml(heading)}</summary>
<div class="reference-body">${body}</div>
</details>`;
}

const STATUS_OPTIONS = [
  { value: 'ok', label: 'OK' },
  { value: 'ng', label: 'NG' },
  { value: 'pending', label: '未実施' },
  { value: 'na', label: '保留(N/A)' },
];

function renderStatusOptions(tcId) {
  return STATUS_OPTIONS.map(({ value, label }) => {
    const checkedAttr = value === 'pending' ? ' checked' : '';
    const inputId = `status-${tcId}-${value}`;
    return `<label class="status-option status-${value}" for="${inputId}">
<input type="radio" id="${inputId}" name="status-${tcId}" value="${value}"${checkedAttr}>
<span>${label}</span>
</label>`;
  }).join('\n');
}

function renderTestCaseRow(tc) {
  const safeId = escapeHtml(tc.id);
  return `<article class="tc-row" data-tc-id="${safeId}">
<header class="tc-header">
<span class="tc-id">${safeId}</span>
<span class="tc-name">${inlineFormat(tc.name)}</span>
<span class="tc-kind">${escapeHtml(tc.kind)}</span>
</header>
<dl class="tc-detail">
<dt>手順</dt><dd>${inlineFormat(tc.steps)}</dd>
<dt>期待結果</dt><dd>${inlineFormat(tc.expected)}</dd>
<dt>上流ID</dt><dd>${escapeHtml(tc.upstreamId)}</dd>
<dt>備考</dt><dd>${inlineFormat(tc.note)}</dd>
</dl>
<div class="tc-status-group" role="radiogroup" aria-label="判定">
${renderStatusOptions(safeId)}
</div>
<div class="tc-comment">
<label for="comment-${safeId}">コメント</label>
<textarea id="comment-${safeId}" name="comment-${safeId}"></textarea>
</div>
<div class="tc-evidence">
<label class="upload-button">エビデンス画像を追加
<input type="file" accept="image/*" multiple class="evidence-input" data-gallery="gallery-${safeId}">
</label>
<div class="gallery" id="gallery-${safeId}"></div>
</div>
</article>`;
}

const STYLE = `
:root { color-scheme: light; }
body { font-family: "Segoe UI", "Hiragino Kaku Gothic ProN", sans-serif; margin: 0; padding: 0; background: #f5f6f8; color: #1f2430; }
header.report-header { background: #1f2d3d; color: #fff; padding: 24px 32px; }
header.report-header h1 { margin: 0; font-size: 1.5rem; }
main { max-width: 1000px; margin: 0 auto; padding: 24px 16px 96px; }
table.meta-table { width: 100%; border-collapse: collapse; background: #fff; margin-bottom: 24px; }
table.meta-table th, table.meta-table td { border: 1px solid #d7dbe0; padding: 8px 12px; text-align: left; font-size: 0.9rem; }
table.meta-table th { width: 220px; background: #eef1f5; }
.run-meta { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
.run-meta label { display: flex; flex-direction: column; font-size: 0.85rem; gap: 4px; }
.run-meta input { padding: 6px 8px; border: 1px solid #c7ccd4; border-radius: 4px; }
details.reference-section { background: #fff; border: 1px solid #d7dbe0; border-radius: 6px; margin-bottom: 12px; padding: 8px 16px; }
details.reference-section summary { cursor: pointer; font-weight: 600; padding: 4px 0; }
.reference-body p { margin: 4px 0; font-size: 0.85rem; line-height: 1.6; }
.summary-panel { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 12px; background: #fff; border: 1px solid #d7dbe0; border-radius: 8px; padding: 16px; margin-bottom: 24px; position: sticky; top: 0; z-index: 5; }
.stat-tile { text-align: center; }
.stat-tile .stat-value { display: block; font-size: 1.6rem; font-weight: 700; }
.stat-tile .stat-label { display: block; font-size: 0.75rem; color: #5b6472; }
.stat-ok .stat-value { color: #1a7f37; }
.stat-ng .stat-value { color: #cf222e; }
.stat-pending .stat-value { color: #9a6700; }
.stat-na .stat-value { color: #6e7781; }
.tc-row { background: #fff; border: 1px solid #d7dbe0; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.tc-header { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; margin-bottom: 8px; }
.tc-header .tc-id { font-weight: 700; }
.tc-header .tc-kind { margin-left: auto; font-size: 0.75rem; padding: 2px 8px; background: #eef1f5; border-radius: 999px; }
.tc-detail { display: grid; grid-template-columns: 100px 1fr; gap: 4px 12px; font-size: 0.85rem; margin: 0 0 12px; }
.tc-detail dt { color: #5b6472; }
.tc-detail dd { margin: 0; white-space: pre-wrap; }
.tc-status-group { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.status-option { border: 1px solid #c7ccd4; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 0.85rem; display: flex; align-items: center; gap: 6px; }
.status-option input { margin: 0; }
.status-option.checked.status-ok { background: #dafbe1; border-color: #1a7f37; }
.status-option.checked.status-ng { background: #ffebe9; border-color: #cf222e; }
.status-option.checked.status-pending { background: #fff8c5; border-color: #9a6700; }
.status-option.checked.status-na { background: #eef1f5; border-color: #6e7781; }
.tc-comment { margin-bottom: 12px; }
.tc-comment label { display: block; font-size: 0.8rem; color: #5b6472; margin-bottom: 4px; }
.tc-comment textarea { width: 100%; min-height: 120px; box-sizing: border-box; padding: 8px; border: 1px solid #c7ccd4; border-radius: 4px; font-family: inherit; }
.upload-button { display: inline-block; padding: 6px 12px; border: 1px dashed #8a94a6; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
.upload-button input { display: none; }
.gallery { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.thumb { position: relative; display: inline-block; }
.thumb img { width: 90px; height: 90px; object-fit: cover; border-radius: 4px; border: 1px solid #d7dbe0; cursor: zoom-in; }
.thumb-remove { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; border: none; background: #1f2430; color: #fff; cursor: pointer; line-height: 1; }
.save-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #1f2d3d; padding: 12px 16px; display: flex; justify-content: center; }
.save-bar button { background: #2f80ed; color: #fff; border: none; border-radius: 6px; padding: 10px 24px; font-size: 1rem; cursor: pointer; }
#lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: none; align-items: center; justify-content: center; z-index: 20; }
#lightbox.open { display: flex; }
#lightbox img { max-width: 90vw; max-height: 90vh; }
`;

const SCRIPT = `
(function () {
  'use strict';

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function computeCounts() {
    var rows = document.querySelectorAll('.tc-row');
    var counts = { ok: 0, ng: 0, pending: 0, na: 0 };
    rows.forEach(function (row) {
      var checked = row.querySelector('input[type=radio]:checked');
      var status = checked ? checked.value : 'pending';
      counts[status] = (counts[status] || 0) + 1;
    });
    return { counts: counts, total: rows.length };
  }

  function renderSummary() {
    var result = computeCounts();
    var counts = result.counts;
    var total = result.total;
    var executed = counts.ok + counts.ng;
    var passRate = executed > 0 ? Math.round((counts.ok / executed) * 1000) / 10 : null;
    var progressRate = total > 0 ? Math.round(((total - counts.pending) / total) * 1000) / 10 : 0;

    setText('stat-total', String(total));
    setText('stat-ok', String(counts.ok));
    setText('stat-ng', String(counts.ng));
    setText('stat-pending', String(counts.pending));
    setText('stat-na', String(counts.na));
    setText('stat-progress', progressRate + '%');
    setText('stat-passrate', passRate === null ? '—' : passRate + '%');
  }

  function updateStatusStyle(row) {
    row.querySelectorAll('.status-option').forEach(function (opt) {
      var input = opt.querySelector('input');
      opt.classList.toggle('checked', !!(input && input.checked));
    });
  }

  function handleChange(event) {
    if (event.target.matches('input[type=radio]')) {
      var row = event.target.closest('.tc-row');
      if (row) updateStatusStyle(row);
      renderSummary();
    } else if (event.target.matches('.evidence-input')) {
      handleImageInput(event.target);
    }
  }

  function handleImageInput(input) {
    var gallery = document.getElementById(input.dataset.gallery);
    var files = Array.prototype.slice.call(input.files || []);
    files.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        addThumbnail(gallery, reader.result, file.name);
      };
      reader.readAsDataURL(file);
    });
    input.value = '';
  }

  function addThumbnail(gallery, dataUrl, name) {
    var wrapper = document.createElement('span');
    wrapper.className = 'thumb';

    var img = document.createElement('img');
    img.src = dataUrl;
    img.alt = name;

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'thumb-remove';
    removeBtn.textContent = '\\u00d7';

    wrapper.appendChild(img);
    wrapper.appendChild(removeBtn);
    gallery.appendChild(wrapper);
  }

  function handleGalleryClick(event) {
    var img = event.target.closest('.gallery img');
    if (img) {
      openLightbox(img.getAttribute('src'));
      return;
    }
    var removeBtn = event.target.closest('.thumb-remove');
    if (removeBtn) {
      var thumb = removeBtn.closest('.thumb');
      if (thumb) thumb.remove();
    }
  }

  function openLightbox(dataUrl) {
    document.getElementById('lightbox-img').src = dataUrl;
    document.getElementById('lightbox').classList.add('open');
  }

  function closeLightbox() {
    document.getElementById('lightbox').classList.remove('open');
  }

  function syncFormStateToDom() {
    document.querySelectorAll('textarea').forEach(function (ta) {
      ta.textContent = ta.value;
    });
    document.querySelectorAll('input[type=radio]').forEach(function (input) {
      if (input.checked) {
        input.setAttribute('checked', 'checked');
      } else {
        input.removeAttribute('checked');
      }
    });
    document.querySelectorAll('input[type=text], input[type=date]').forEach(function (input) {
      input.setAttribute('value', input.value);
    });
  }

  function downloadCurrentState() {
    syncFormStateToDom();
    var htmlString = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
    var blob = new Blob([htmlString], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = window.REPORT_BASENAME + '_結果_' + today + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  document.addEventListener('change', handleChange);
  document.addEventListener('click', handleGalleryClick);
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.tc-row').forEach(updateStatusStyle);
    renderSummary();
    var saveButton = document.getElementById('save-button');
    if (saveButton) saveButton.addEventListener('click', downloadCurrentState);
    var lightboxClose = document.getElementById('lightbox-close');
    if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
  });
})();
`;

function renderReport(spec, options) {
  const basename = (options && options.basename) || 'report';
  const tcRows = spec.testCases.map(renderTestCaseRow).join('\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(spec.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="report-header">
<h1>${escapeHtml(spec.title)}</h1>
</header>
<main>
${renderMetaTable(spec.meta)}
<div class="run-meta">
<label>テスト実施日<input type="date" name="run-date" min="1900-01-01" max="2099-12-31"></label>
<label>実施者<input type="text" name="run-tester" placeholder="氏名"></label>
</div>
${renderReferenceSection('ref-policy', '1. テスト方針・前提（参考）', spec.policyText)}
${renderReferenceSection('ref-env', '2. テスト環境・データ（参考）', spec.envText)}
${renderReferenceSection('ref-criteria', '5. 合否基準・残課題（参考）', spec.criteriaText)}
<section class="summary-panel" aria-label="集計">
<div class="stat-tile"><span class="stat-value" id="stat-total">0</span><span class="stat-label">総TC数</span></div>
<div class="stat-tile stat-ok"><span class="stat-value" id="stat-ok">0</span><span class="stat-label">OK</span></div>
<div class="stat-tile stat-ng"><span class="stat-value" id="stat-ng">0</span><span class="stat-label">NG</span></div>
<div class="stat-tile stat-pending"><span class="stat-value" id="stat-pending">0</span><span class="stat-label">未実施</span></div>
<div class="stat-tile stat-na"><span class="stat-value" id="stat-na">0</span><span class="stat-label">保留(N/A)</span></div>
<div class="stat-tile"><span class="stat-value" id="stat-progress">0%</span><span class="stat-label">実施率</span></div>
<div class="stat-tile"><span class="stat-value" id="stat-passrate">—</span><span class="stat-label">合格率</span></div>
</section>
<section class="tc-list">
${tcRows}
</section>
</main>
<div class="save-bar">
<button type="button" id="save-button">結果をHTMLとして保存</button>
</div>
<div id="lightbox">
<button type="button" id="lightbox-close" aria-label="閉じる" style="position:absolute;top:16px;right:16px;background:none;border:none;color:#fff;font-size:1.5rem;cursor:pointer;">×</button>
<img id="lightbox-img" src="" alt="">
</div>
<script>window.REPORT_BASENAME = ${JSON.stringify(basename)};</script>
<script>${SCRIPT}</script>
</body>
</html>`;
}

module.exports = { renderMetaTable, renderReferenceSection, renderTestCaseRow, renderReport };
