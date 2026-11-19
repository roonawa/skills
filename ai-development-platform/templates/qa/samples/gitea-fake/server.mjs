// 確認用の偽の Gitea サーバー（見本・架空）。node:http だけで動く。
// 使い方: GITEA_FAKE_TOKEN=<任意の値> node server.mjs [--port N]
// Issue の作成と検索、GET /api/v1/user（トークンの持ち主の確認）に答える。確認用に GET /__issues も返す。Issue はメモリ上にだけ持つ。127.0.0.1 だけで待ち受ける。
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

const MAX_BODY = 64 * 1024;

let port = 3000;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--port') port = Number(argv[++i]);
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('--port には 0 から 65535 の整数を指定してください');
  process.exit(2);
}
const token = process.env.GITEA_FAKE_TOKEN;
if (!token) {
  console.error('環境変数 GITEA_FAKE_TOKEN に確認用の任意の値を設定してください');
  process.exit(1);
}
const digest = value => createHash('sha256').update(value).digest();
const expected = digest('token ' + token);

const login = 'fake-user';
const issues = [];

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text)});
  res.end(text);
}

// 本文を読む。上限を超えたら読むのをやめて too_large を返す。途中で切れたとき（close・aborted・error）も必ず終わる。
function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = value => { if (!done) { done = true; resolve(value); } };
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { chunks.length = 0; finish('too_large'); req.pause(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(null));
    req.on('aborted', () => finish(null));
    req.on('close', () => finish(null));
  });
}

const server = createServer(async (req, res) => {
  if (!timingSafeEqual(digest(req.headers.authorization ?? ''), expected)) {
    req.resume();
    return send(res, 401, {message: 'token is required'});
  }
  try {
    await handle(req, res);
  } catch {
    // 不正な URL などで落とさない。
    if (!res.headersSent) send(res, 400, {message: 'bad request'});
    else res.end();
  }
});

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/v1/user') return send(res, 200, {login});
  if (req.method === 'GET' && url.pathname === '/__issues') return send(res, 200, issues);
  const m = /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/issues$/.exec(url.pathname);
  if (!m) { req.resume(); return send(res, 404, {message: 'not found'}); }
  const [owner, repo] = [decodeURIComponent(m[1]), decodeURIComponent(m[2])];
  if (req.method === 'GET') {
    const q = url.searchParams.get('q') ?? '';
    const hits = issues.filter(i => i.owner === owner && i.repo === repo && (i.title.includes(q) || i.body.includes(q)));
    // 本物の Gitea に合わせて page（1 から）と limit で区切る。どちらも無ければ全件を返す。
    const limit = Number(url.searchParams.get('limit'));
    const page = Number(url.searchParams.get('page') ?? 1);
    if (url.searchParams.has('limit') && Number.isInteger(limit) && limit > 0 && Number.isInteger(page) && page > 0) {
      return send(res, 200, hits.slice((page - 1) * limit, page * limit));
    }
    return send(res, 200, hits);
  }
  if (req.method === 'POST') {
    const raw = await readBody(req);
    if (raw === 'too_large') {
      res.writeHead(413, {'content-type': 'application/json; charset=utf-8', connection: 'close'});
      return res.end(JSON.stringify({message: 'request body too large'}));
    }
    let input;
    try { input = JSON.parse(raw); } catch { input = null; }
    if (typeof input !== 'object' || input === null || typeof input.title !== 'string' || !input.title) {
      return send(res, 422, {message: 'title is required'});
    }
    const number = issues.filter(i => i.owner === owner && i.repo === repo).length + 1;
    const origin = 'http://127.0.0.1:' + server.address().port;
    const issue = {number, title: input.title, body: typeof input.body === 'string' ? input.body : '', state: 'open', user: {login},
      html_url: origin + '/' + owner + '/' + repo + '/issues/' + number, owner, repo};
    issues.push(issue);
    return send(res, 201, issue);
  }
  req.resume();
  send(res, 405, {message: 'method not allowed'});
}

server.listen(port, '127.0.0.1', () => {
  console.log('listening http://localhost:' + server.address().port);
});
