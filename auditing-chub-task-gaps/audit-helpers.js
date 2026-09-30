// C-HUB 巡回用ヘルパー(閲覧専用)。javascript_tool でそのまま貼って1回実行する。
// ページ再読み込みで消えるので、リロードしたら再注入する。
// 書き込み操作は一切含まない。クリックは「タスク名(.task-manager-task-title)」と「パネルを閉じる」「リスト」のみ。
(() => {
  // 担当者欄が空の行は '--'。写真アイコンの担当者は文字が無く、先頭がステータス語になる(=担当者あり)。
  const ST = new Set(['未着手','進行中','対応中','保留','差し戻し','確認中','レビュー中','テスト中','待機中','失注','見積中']);
  // 期限の表記: 今日/昨日/明日、9/25、2027/4/1、範囲(明日~10/2 は終端で判定)
  const isDue = x => /^(今日|昨日|明日|\d{1,2}\/\d{1,2}|\d{4}\/\d{1,2}\/\d{1,2}|.*~.*)$/.test(x);
  const T = (() => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate()]; })();
  const before = (y, m, d) => y < T[0] || (y === T[0] && (m < T[1] || (m === T[1] && d < T[2])));
  const od = d => {
    if (d.includes('~')) d = d.split('~')[1];
    if (d === '昨日') return true;
    if (d === '今日' || d === '明日') return false;
    let m = d.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (m) return before(+m[1], +m[2], +m[3]);
    m = d.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) return before(T[0], +m[1], +m[2]);
    return false;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const closeBtn = () => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'パネルを閉じる' && b.offsetParent !== null);

  window.__getRows = () => [...document.querySelectorAll('.task-manager-task-row')].filter(r => r.offsetParent);

  // 行の分類: U=担当者未入力 / N=期限未入力 / O=期限切れ / ''=指摘なし・完了
  window.__info = r => {
    const tEl = r.querySelector('.task-manager-task-title') || r;
    const t = tEl.innerText.trim().replace(/\n/g, ' ');
    const rest = r.innerText.replace(tEl.innerText, '').split('\n').map(x => x.trim()).filter(Boolean);
    if (rest.includes('完了')) return { t, cls: '', due: '', a: '' };
    const due = rest.filter(isDue).pop() || '';
    const a = rest[0];
    const cls = a === '--' ? 'U' : (!due ? 'N' : (od(due) ? 'O' : ''));
    return { t, cls, due, a: ST.has(a) ? '(photo)' : a };
  };

  // 指摘行の一覧 "index|分類|タイトル30字|担当(頭文字)|期限"
  window.__list = () => {
    const o = [];
    window.__getRows().forEach((r, i) => { const x = window.__info(r); if (x.cls) o.push(i + '|' + x.cls + '|' + x.t.slice(0, 30) + '|' + x.a + '|' + x.due); });
    return o;
  };

  // セクション折りたたみ検出: 各セクションの (全行/表示行)。差があれば折りたたまれている
  window.__chk = () => [...document.querySelectorAll('.task-manager-section')].map(s => {
    const n = s.querySelectorAll('.task-manager-task-row').length;
    const v = [...s.querySelectorAll('.task-manager-task-row')].filter(r => r.offsetParent).length;
    return s.innerText.split('\n')[0].slice(0, 14) + ':' + n + '/' + v;
  }).join(' , ');

  // 詳細パネルの担当者名・期限・コメント抜粋(期限/遅れ/担当調整に触れる行のみ最大2行)
  const cmt = () => {
    const leaf = [...document.querySelectorAll('*')].find(e => e.children.length == 0 && /^コメント \(\d+\)/.test(e.textContent.trim()));
    if (!leaf) return '';
    let n = leaf; while (n && !n.innerText.includes('基本情報')) n = n.parentElement;
    const c = n.innerText.slice(n.innerText.indexOf('コメント ('));
    const out = []; let who = '';
    for (const l of c.split('\n')) {
      if (/^\d{4}-\d\d-\d\d \d\d:\d\d/.test(l)) who = l.slice(5, 10);
      if (/期限|遅れ|遅延|延期|担当者|アサイン|調整中|回答待ち|見送り|保留/.test(l) && out.length < 2) out.push(who + ' ' + l.slice(0, 80));
    }
    return out.join(' / ');
  };
  const panel = () => {
    const h = [...document.querySelectorAll('*')].find(e => e.children.length == 0 && e.textContent.trim() === '基本情報' && e.offsetParent !== null);
    if (!h) return null;
    let n = h; while (n && !n.innerText.includes('コメント')) n = n.parentElement;
    const L = n.innerText.split('\n').map(s => s.trim()).filter(Boolean);
    const g = k => { const i = L.indexOf(k); return i < 0 ? '?' : L[i + 1]; };
    return { a: g('担当者'), d: g('期限'), c: cmt() };
  };
  const hasTitle = key => [...document.querySelectorAll('textarea,input')].some(v => v.value && v.value.includes(key));

  // 指定indexの行を順に開いて担当者名・コメントを収集。window.__R に "index|分類|タイトル|担当者名|期限|備考" を積む。
  // 1件ずつ直列。完了は window.__done。await せずに起動し、別呼び出しで __done をポーリングする。
  window.__pr = async idxs => {
    window.__R = []; window.__done = false; window.__err = '';
    try {
      for (const i of idxs) {
        const r = window.__getRows()[i]; if (!r) continue;
        const x = window.__info(r), key = x.t.slice(0, 10); let p = null;
        for (let k = 0; k < 2 && !p; k++) {
          window.__getRows()[i].querySelector('.task-manager-task-title').click();   // タイトル文字のみクリック(チェック丸は触らない)
          for (let w = 0; w < 20 && !hasTitle(key); w++) await sleep(250);
          if (hasTitle(key)) p = panel();
        }
        window.__R.push([i, x.cls, x.t.slice(0, 30), p ? p.a : 'MISMATCH', p ? p.d : '', p ? p.c : ''].join('|'));
      }
    } catch (e) { window.__err = String(e); }
    const c = closeBtn(); c && c.click();
    window.__done = true;
  };

  // プロジェクト切替後に呼ぶ: リスト表示にして分類し、O/N行だけ詳細パネルを読みに行く(U行は読まない)。
  // 戻り値は件数のみ(出力制限対策)。結果は __L(全指摘)と __R(パネル確認分)。
  window.__go = async () => {
    const c = closeBtn(); c && c.click(); await sleep(800);
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'リスト' && b.offsetParent !== null); b && b.click();
    await sleep(4000);
    window.__L = window.__list();
    const idx = window.__L.filter(s => s.split('|')[1] !== 'U').map(s => +s.split('|')[0]);
    window.__pr(idx);
    return window.__L.length + ' flagged, panel ' + idx.length;
  };

  // 出力用: 出力上限(約2000字)と「= ? &」を含む出力のブロック回避のため、短くして返す
  window.__sum = (a, b, n = 28) => window.__R.slice(a, b).map(s => { const p = s.split('|'); return p[1] + ';' + p[2].slice(0, n) + ';' + p[3] + ';' + p[4] + (p[5] ? ';' + p[5].slice(0, 40) : ''); }).join('\n').replace(/[?=&]/g, ' ');
  // 担当者未入力(U)は「タイトル先頭」だけ短く返す
  window.__uList = (a, b, n = 24) => window.__L.filter(s => s.split('|')[1] === 'U').slice(a, b).map(s => s.split('|')[2].slice(0, n) + (s.split('|')[4] ? '(' + s.split('|')[4] + ')' : '')).join(' / ').replace(/[?=&]/g, ' ');
})();
