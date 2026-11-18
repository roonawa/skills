// 備品貸出アプリ（見本・架空）。node:http だけで動く。
// 使い方: node server.mjs --version old|new [--port N]
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { seed, requiredEnvNames } from './seed.mjs';

const PAGE_SIZE = 50;
const MAX_BODY = 64 * 1024;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--version') out.version = argv[++i];
    else if (argv[i] === '--port') out.port = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.version !== 'old' && args.version !== 'new') {
  console.error('使い方: node server.mjs --version old|new [--port N]');
  process.exit(2);
}
const version = args.version;
const port = args.port === undefined ? (version === 'old' ? 4101 : 4102) : Number(args.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('--port には 0 から 65535 の整数を指定してください');
  process.exit(2);
}

let data;
try {
  data = seed(process.env);
} catch (e) {
  console.error(e.message);
  console.error('必要な環境変数: ' + requiredEnvNames().join(', '));
  process.exit(1);
}
const { users, loans } = data;
const userByKey = new Map(users.map(u => [u.key, u]));
const sessions = new Map(); // sid -> user

const digest = s => createHash('sha256').update(String(s)).digest();
function findUser(username, password) {
  let found = null;
  for (const u of users) {
    const nameOk = timingSafeEqual(digest(u.username), digest(username));
    const passOk = timingSafeEqual(digest(u.password), digest(password));
    if (nameOk && passOk) found = u;
  }
  return found;
}

const ESCAPES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
const esc = s => String(s).replace(/[&<>"']/g, c => ESCAPES[c]);

function layout(title, body, user) {
  const nav = user
    ? `<nav><span data-testid="current-user">${esc(user.username)}</span> (${user.role})</nav>`
    : '';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1>${nav}${body}</body></html>`;
}

function send(res, status, body, extra = {}) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    ...extra,
  });
  res.end(body);
}
function redirect(res, location, status = 302, extra = {}) {
  res.writeHead(status, {location, 'cache-control': 'no-store', ...extra});
  res.end();
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

function sessionUser(req) {
  const m = /(?:^|;\s*)sid=([0-9a-f]+)/.exec(req.headers.cookie ?? '');
  return m ? sessions.get(m[1]) ?? null : null;
}

const loginPage = error => layout('ログイン',
  (error ? '<p data-testid="login-error" role="alert">ユーザー名またはパスワードが正しくありません。</p>' : '') +
  '<form method="post" action="/login">' +
  '<label>ユーザー名 <input data-testid="username" name="username" autocomplete="username"></label> ' +
  '<label>パスワード <input data-testid="password" name="password" type="password" autocomplete="current-password"></label> ' +
  '<button data-testid="login-submit" type="submit">ログイン</button></form>');

// 一覧の並び。旧版は貸出日の古い順（同じ日は ID の小さい順）、新版は貸出日の新しい順（同じ日は ID の大きい順）。
function compareLoans(a, b) {
  const byDate = a.loanDate < b.loanDate ? -1 : a.loanDate > b.loanDate ? 1 : 0;
  return version === 'old' ? byDate || a.id - b.id : -byDate || b.id - a.id;
}

function visibleLoans(user) {
  return user.role === 'admin' ? loans : loans.filter(l => l.ownerKey === user.key);
}

function listPage(user, pageParam) {
  const rows = visibleLoans(user).slice().sort(compareLoans);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const n = /^\d{1,6}$/.test(pageParam ?? '') ? Math.max(1, Number(pageParam)) : 1;
  const slice = rows.slice((n - 1) * PAGE_SIZE, n * PAGE_SIZE);
  let body = '<p><a data-testid="new-loan" href="/loans/new">貸出を登録</a>' +
    (user.role === 'admin' ? ' <a data-testid="csv-export" href="/loans.csv">CSV 出力</a>' : '') + '</p>';
  if (rows.length === 0) {
    body += '<p data-testid="empty-message">貸出はありません</p>';
  } else {
    body += '<table data-testid="loan-table"><thead><tr><th>貸出ID</th><th>備品名</th><th>借りた人</th><th>貸出日</th><th>返却予定日</th></tr></thead><tbody>' +
      slice.map(l => `<tr data-testid="loan-row" data-loan-id="${l.id}"><td>${l.id}</td>` +
        `<td><a data-testid="loan-link" href="/loans/${l.id}">${esc(l.item)}</a></td>` +
        `<td>${esc(userByKey.get(l.ownerKey).username)}</td><td>${l.loanDate}</td><td>${l.dueDate}</td></tr>`).join('') +
      '</tbody></table>';
    if (rows.length > PAGE_SIZE) {
      body += '<p data-testid="pager">' +
        (n > 1 ? `<a data-testid="prev-page" href="/loans?page=${n - 1}">前へ</a>` : '<span data-testid="prev-page" aria-disabled="true">前へ</span>') + ' ' +
        `<span data-testid="page-number">${n} / ${pages}</span> ` +
        (n < pages ? `<a data-testid="next-page" href="/loans?page=${n + 1}">次へ</a>` : '<span data-testid="next-page" aria-disabled="true">次へ</span>') + '</p>';
    }
  }
  return layout('貸出一覧', body, user);
}

function detailPage(user, loan) {
  const owner = userByKey.get(loan.ownerKey);
  return layout('貸出の詳細',
    '<dl>' +
    `<dt>備品名</dt><dd data-testid="detail-item">${esc(loan.item)}</dd>` +
    `<dt>借りた人</dt><dd data-testid="detail-borrower">${esc(owner.username)}</dd>` +
    `<dt>貸出日</dt><dd data-testid="detail-loan-date">${loan.loanDate}</dd>` +
    `<dt>返却予定日</dt><dd data-testid="detail-due-date">${loan.dueDate}</dd>` +
    `<dt>備考</dt><dd data-testid="detail-note">${esc(loan.note)}</dd></dl>` +
    '<p><a data-testid="back-to-list" href="/loans">一覧へ戻る</a></p>', user);
}

function formPage(user, values = {}, errors = []) {
  const v = k => esc(values[k] ?? '');
  return layout('貸出の登録',
    (errors.length ? '<ul data-testid="form-errors">' + errors.map(e => `<li data-testid="form-error">${esc(e)}</li>`).join('') + '</ul>' : '') +
    '<form method="post" action="/loans" novalidate>' +
    `<p><label>備品名 <input data-testid="item" name="item" value="${v('item')}"></label></p>` +
    `<p><label>貸出日 <input data-testid="loan-date" name="loan_date" type="date" value="${v('loan_date')}"></label></p>` +
    `<p><label>返却予定日 <input data-testid="due-date" name="due_date" type="date" value="${v('due_date')}"></label></p>` +
    `<p><label>備考 <textarea data-testid="note" name="note">${v('note')}</textarea></label></p>` +
    '<button data-testid="submit" type="submit">登録</button> <a data-testid="cancel" href="/loans">戻る</a></form>', user);
}

const len = s => [...s].length;
function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(s + 'T00:00:00Z');
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s ? null : t;
}

function validate(form) {
  const item = (form.get('item') ?? '').trim();
  const loanDate = (form.get('loan_date') ?? '').trim();
  const dueDate = (form.get('due_date') ?? '').trim();
  const note = form.get('note') ?? '';
  const errors = [];
  if (!item) errors.push('備品名を入力してください。');
  else if (len(item) > 50) errors.push('備品名は 50 文字以内で入力してください。');
  const loanT = loanDate ? parseDate(loanDate) : null;
  const dueT = dueDate ? parseDate(dueDate) : null;
  if (!loanDate) errors.push('貸出日を入力してください。');
  else if (loanT === null) errors.push('貸出日を yyyy-MM-dd で入力してください。');
  if (!dueDate) errors.push('返却予定日を入力してください。');
  else if (dueT === null) errors.push('返却予定日を yyyy-MM-dd で入力してください。');
  if (loanT !== null && dueT !== null) {
    const days = (dueT - loanT) / 86400000;
    if (days < 0 || days > 30) errors.push('返却予定日は貸出日以後、貸出日から 30 日以内にしてください。');
  }
  if (len(note) > 200) errors.push('備考は 200 文字以内で入力してください。');
  return {errors, values: {item, loan_date: loanDate, due_date: dueDate, note}};
}

const csvCell = s => (/[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s);
const csvDate = d => (version === 'old' ? d : d.replaceAll('-', '/'));
function csvBody() {
  const lines = ['貸出ID,備品名,借りた人,貸出日,返却予定日'];
  for (const l of loans) {
    lines.push([l.id, l.item, userByKey.get(l.ownerKey).username, csvDate(l.loanDate), csvDate(l.dueDate)].map(c => csvCell(String(c))).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

const forbidden = (res, user) => send(res, 403, layout('403 権限がありません', '<p data-testid="forbidden">この操作を行う権限がありません。</p><p><a href="/loans">一覧へ戻る</a></p>', user));
const notFound = (res, user) => send(res, 404, layout('404 見つかりません', '<p data-testid="not-found">ページが見つかりません。</p><p><a href="/loans">一覧へ戻る</a></p>', user));

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method;

  if (path === '/login') {
    if (method === 'GET') return send(res, 200, loginPage(false));
    if (method === 'POST') {
      const form = await readForm(req);
      const user = findUser(form.get('username') ?? '', form.get('password') ?? '');
      if (!user) return send(res, 401, loginPage(true));
      const sid = randomBytes(32).toString('hex');
      sessions.set(sid, user);
      return redirect(res, '/loans', 303, {'set-cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`});
    }
    return notFound(res, null);
  }

  const known = path === '/' || path === '/loans' || path === '/loans/new' || path === '/loans.csv' || /^\/loans\/[^/]+$/.test(path);
  if (!known) return notFound(res, sessionUser(req));
  const user = sessionUser(req);
  if (!user) return redirect(res, '/login');

  if (path === '/') return redirect(res, '/loans');
  if (path === '/loans' && method === 'GET') return send(res, 200, listPage(user, url.searchParams.get('page')));
  if (path === '/loans' && method === 'POST') {
    const {errors, values} = validate(await readForm(req));
    if (errors.length) return send(res, 400, formPage(user, values, errors));
    loans.push({id: loans.length + 1, ownerKey: user.key, item: values.item, loanDate: values.loan_date, dueDate: values.due_date, note: values.note});
    return redirect(res, '/loans', 303);
  }
  if (path === '/loans/new' && method === 'GET') return send(res, 200, formPage(user));
  if (path === '/loans.csv' && method === 'GET') {
    if (user.role !== 'admin' && version === 'old') return forbidden(res, user);
    res.writeHead(200, {'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="loans.csv"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
    return res.end(csvBody());
  }
  const m = /^\/loans\/(\d+)$/.exec(path);
  if (m && method === 'GET') {
    const loan = loans.find(l => l.id === Number(m[1]));
    if (!loan) return notFound(res, user);
    if (user.role !== 'admin' && loan.ownerKey !== user.key) return forbidden(res, user);
    return send(res, 200, detailPage(user, loan));
  }
  return notFound(res, user);
}

const server = createServer((req, res) => {
  handle(req, res).catch(e => {
    if (res.headersSent) { res.destroy(); return; }
    send(res, e.message === 'too large' ? 413 : 500, layout('エラー', '<p>処理できませんでした。</p>'));
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`listening http://localhost:${server.address().port}`);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
