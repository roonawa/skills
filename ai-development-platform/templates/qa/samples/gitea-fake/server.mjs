// 確認用の偽の Gitea サーバー（見本・架空）。node:http だけで動く。
// 使い方: GITEA_FAKE_TOKEN=<任意の値> node server.mjs [--port N]
// Issue の作成と検索の2経路だけに答え、Issue はメモリ上にだけ持つ。127.0.0.1 だけで待ち受ける。
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

const issues = [];

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text)});
  res.end(text);
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { resolve(null); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
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
  if (req.method === 'GET' && url.pathname === '/__issues') return send(res, 200, issues);
  const m = /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/issues$/.exec(url.pathname);
  if (!m) { req.resume(); return send(res, 404, {message: 'not found'}); }
  const [owner, repo] = [decodeURIComponent(m[1]), decodeURIComponent(m[2])];
  if (req.method === 'GET') {
    const q = url.searchParams.get('q') ?? '';
    return send(res, 200, issues.filter(i => i.owner === owner && i.repo === repo && (i.title.includes(q) || i.body.includes(q))));
  }
  if (req.method === 'POST') {
    const raw = await readBody(req);
    let input;
    try { input = JSON.parse(raw); } catch { input = null; }
    if (typeof input !== 'object' || input === null || typeof input.title !== 'string' || !input.title) {
      return send(res, 422, {message: 'title is required'});
    }
    const number = issues.filter(i => i.owner === owner && i.repo === repo).length + 1;
    const origin = 'http://127.0.0.1:' + server.address().port;
    const issue = {number, title: input.title, body: typeof input.body === 'string' ? input.body : '', state: 'open',
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
