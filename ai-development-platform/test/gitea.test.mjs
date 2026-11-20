import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createGiteaClient, fetchGiteaTransport, GiteaError } from '../dist/gitea.js';
import { BASE, TOKEN, fakeGitea } from './gitea-fake.mjs';

const created = {status: 201, body: JSON.stringify({number: 7, html_url: 'https://gitea.example.internal/o/r/issues/7', id: 99})};

test('create an issue with the token only in the header', async () => {
  const fake = fakeGitea(() => created);
  const client = createGiteaClient({baseUrl: BASE + '/', token: TOKEN, transport: fake.transport});
  const result = await client.createIssue('org', 'app', {title: '題名', body: '本文'});
  assert.deepEqual(result, {number: 7, html_url: 'https://gitea.example.internal/o/r/issues/7'});
  const [call] = fake.calls;
  assert.equal(call.method, 'POST');
  assert.equal(call.url, BASE + '/api/v1/repos/org/app/issues');
  assert.deepEqual(JSON.parse(call.body), {title: '題名', body: '本文'});
  assert.equal(call.headers.Authorization, 'token ' + TOKEN);
  assert.ok(!call.url.includes(TOKEN));
  assert.ok(!call.body.includes(TOKEN));
});

test('token never leaves the request header', async () => {
  for (const status of [401, 403, 404, 422, 500]) {
    const fake = fakeGitea(() => ({status, body: 'echo ' + TOKEN}));
    const client = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fake.transport});
    await assert.rejects(client.createIssue('org', 'app', {title: 't', body: 'b'}), error => {
      assert.ok(error instanceof GiteaError);
      assert.ok(!error.message.includes(TOKEN));
      assert.ok(!error.message.includes('gitea.example.internal'));
      assert.match(error.message, /Gitea/);
      return true;
    });
  }
});

test('fixed messages for 401, 403, 404 and 422', async () => {
  const seen = new Set();
  for (const status of [401, 403, 404, 422]) {
    const client = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fakeGitea(() => ({status, body: ''})).transport});
    await assert.rejects(client.findIssues('o', 'r', 'x'), error => {
      assert.match(error.message, new RegExp(String(status)));
      assert.match(error.message, /[ぁ-ん]/);
      seen.add(error.message);
      return true;
    });
  }
  assert.equal(seen.size, 4);
});

test('refuse redirects', async () => {
  for (const status of [300, 301, 302, 307, 399]) {
    const fake = fakeGitea(() => ({status, body: '', location: 'https://evil.example/'}));
    const client = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fake.transport});
    await assert.rejects(client.createIssue('o', 'r', {title: 't', body: 'b'}), GiteaError);
    assert.equal(fake.calls.length, 1);
  }
});

test('refuse http except localhost', () => {
  const make = baseUrl => createGiteaClient({baseUrl, token: TOKEN, transport: fakeGitea().transport});
  assert.throws(() => make('http://gitea.example.test'), GiteaError);
  assert.throws(() => make('ftp://gitea.example.test'), GiteaError);
  assert.throws(() => make('not a url'), GiteaError);
  assert.throws(() => make('https://user:pw@gitea.example.test'), GiteaError);
  assert.doesNotThrow(() => make('http://127.0.0.1:3999'));
  assert.doesNotThrow(() => make('http://localhost:3999'));
  assert.doesNotThrow(() => make('https://gitea.example.test'));
});

test('find issues by query', async () => {
  const list = [{number: 1, title: 'a', html_url: 'https://h/1', state: 'open', extra: 'x'}];
  const fake = fakeGitea(() => ({status: 200, body: JSON.stringify(list)}));
  const client = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fake.transport});
  const found = await client.findIssues('org', 'app', '日本語 & q=1');
  assert.deepEqual(found, [{number: 1, title: 'a', body: '', html_url: 'https://h/1', state: 'open', user: {login: ''}}]);
  const url = new URL(fake.calls[0].url);
  assert.equal(fake.calls[0].method, 'GET');
  assert.equal(url.pathname, '/api/v1/repos/org/app/issues');
  assert.equal(url.searchParams.get('type'), 'issues');
  assert.equal(url.searchParams.get('state'), 'all');
  assert.equal(url.searchParams.get('q'), '日本語 & q=1');
  assert.ok(!fake.calls[0].url.includes(' '));
  assert.ok(!fake.calls[0].url.includes(TOKEN));
});

test('only 200 counts for GET and only 201 for POST', async () => {
  const get = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fakeGitea(() => ({status: 201, body: '[]'})).transport});
  await assert.rejects(get.findIssues('o', 'r', 'x'), GiteaError);
  const post = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fakeGitea(() => ({status: 200, body: created.body})).transport});
  await assert.rejects(post.createIssue('o', 'r', {title: 't', body: 'b'}), GiteaError);
});

test('the response of createIssue is parsed defensively', async () => {
  for (const body of ['not json', 'null', '[]', '{}', '{"number":1}', '{"html_url":"https://h/1"}', '{"number":"1","html_url":"https://h/1"}', '{"number":1,"html_url":5}']) {
    const client = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fakeGitea(() => ({status: 201, body})).transport});
    await assert.rejects(client.createIssue('o', 'r', {title: 't', body: 'b'}), GiteaError, body);
  }
  const client = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fakeGitea(() => ({status: 200, body: '{"a":1}'})).transport});
  await assert.rejects(client.findIssues('o', 'r', 'x'), GiteaError);
});

test('owner and repo are validated and encoded', async () => {
  const fake = fakeGitea(() => created);
  const client = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fake.transport});
  for (const bad of ['', 'a/b', '../x', 'a b', 'a?b', 'a#b', '日本', 'a%2Fb']) {
    await assert.rejects(client.createIssue(bad, 'r', {title: 't', body: 'b'}), GiteaError, bad);
    await assert.rejects(client.findIssues('o', bad, 'x'), GiteaError, bad);
  }
  assert.equal(fake.calls.length, 0);
  await client.createIssue('my.org-1_x', 'repo.name', {title: 't', body: 'b'});
  assert.equal(fake.calls[0].url, BASE + '/api/v1/repos/my.org-1_x/repo.name/issues');
});
test('a base URL with a path is kept and trailing slashes are normalized', async () => {
  const fake = fakeGitea(() => created);
  const client = createGiteaClient({baseUrl: 'https://h.example/gitea//', token: TOKEN, transport: fake.transport});
  await client.createIssue('o', 'r', {title: 't', body: 'b'});
  assert.equal(fake.calls[0].url, 'https://h.example/gitea/api/v1/repos/o/r/issues');
});

test('the client has no other write method', () => {
  const client = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fakeGitea().transport});
  assert.deepEqual(Object.keys(client).sort(), ['createIssue', 'currentUser', 'findIssues']);
  assert.ok(Object.isFrozen(client));
});

test('the transport errors do not leak the URL or the token', async () => {
  const client = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: async () => { throw new Error('boom ' + TOKEN + BASE); }});
  await assert.rejects(client.findIssues('o', 'r', 'x'), error => {
    assert.ok(error instanceof GiteaError);
    assert.ok(!error.message.includes(TOKEN) && !error.message.includes('gitea.example'));
    return true;
  });
});

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run('http://127.0.0.1:' + server.address().port);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

test('fetchGiteaTransport does not follow redirects and sends the method, headers and body', async () => {
  let hits = 0;
  let seen;
  await withServer((req, res) => {
    hits++;
    if (req.url === '/redir') { res.writeHead(302, {location: '/final'}); res.end(); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { seen = {method: req.method, auth: req.headers.authorization, body}; res.writeHead(201); res.end('{"ok":1}'); });
  }, async base => {
    const redirected = await fetchGiteaTransport({method: 'GET', url: base + '/redir', headers: {}});
    assert.equal(redirected.status, 302);
    assert.equal(hits, 1);
    const posted = await fetchGiteaTransport({method: 'POST', url: base + '/x', headers: {Authorization: 'token T'}, body: '{"a":1}'});
    assert.equal(posted.status, 201);
    assert.equal(posted.body, '{"ok":1}');
    assert.deepEqual(seen, {method: 'POST', auth: 'token T', body: '{"a":1}'});
  });
});

test('fetchGiteaTransport refuses a response over 2 MiB', async () => {
  await withServer((req, res) => { res.writeHead(200); res.end('x'.repeat(2 * 1024 * 1024 + 10)); }, async base => {
    await assert.rejects(fetchGiteaTransport({method: 'GET', url: base + '/', headers: {}}), error => {
      assert.ok(error instanceof GiteaError);
      assert.ok(!error.message.includes('127.0.0.1'));
      return true;
    });
  });
});

test('fetchGiteaTransport reports only an error code when the connection fails', async () => {
  await assert.rejects(fetchGiteaTransport({method: 'GET', url: 'http://127.0.0.1:1/secret-path', headers: {}}), error => {
    assert.ok(error instanceof GiteaError);
    assert.ok(!error.message.includes('secret-path') && !error.message.includes('127.0.0.1'));
    return true;
  });
});

test('fetchGiteaTransport points to the system certificate store when the certificate is not trusted', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const failWith = code => { globalThis.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), {cause: {code}}); }; };
  for (const code of ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT']) {
    failWith(code);
    await assert.rejects(fetchGiteaTransport({method: 'GET', url: 'https://gitea.invalid/api/v1/user', headers: {}}), error => {
      assert.ok(error instanceof GiteaError);
      assert.ok(error.message.includes('（' + code + '）'), error.message);
      assert.ok(error.message.includes('NODE_OPTIONS=--use-system-ca'), error.message);
      assert.ok(!error.message.includes('gitea.invalid'));
      return true;
    });
  }
  // Other failures, including an expired certificate, get no such hint: the system store would not fix them.
  for (const code of ['ECONNREFUSED', 'CERT_HAS_EXPIRED']) {
    failWith(code);
    await assert.rejects(fetchGiteaTransport({method: 'GET', url: 'https://gitea.invalid/', headers: {}}), error => {
      assert.equal(error.message, 'Gitea に接続できません（' + code + '）');
      return true;
    });
  }
});

test('the token is checked at the client boundary and never echoed', () => {
  for (const token of [undefined, '', ' ', 'has space', 'tab\tx', 'line\nbreak', 'トークン', 'x\u007f']) {
    assert.throws(() => createGiteaClient({baseUrl: BASE, token, transport: fakeGitea().transport}), error => {
      assert.ok(error instanceof GiteaError);
      assert.equal(error.message, 'GITEA_TOKEN が未設定、または形式が違います');
      return true;
    }, JSON.stringify(token));
  }
  assert.doesNotThrow(() => createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fakeGitea().transport}));
});

test('findIssues reads pages of 50 until a short page', async () => {
  const items = n => Array.from({length: n}, (_, i) => ({number: i + 1, title: 't', body: 'b', user: {login: 'a'}}));
  const pages = [items(50), items(50), items(7)];
  const fake = fakeGitea(request => ({status: 200, body: JSON.stringify(pages[Number(new URL(request.url).searchParams.get('page')) - 1] ?? [])}));
  const found = await createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fake.transport}).findIssues('o', 'r', 'x');
  assert.equal(found.length, 107);
  assert.deepEqual(fake.calls.map(c => new URL(c.url).searchParams.get('page')), ['1', '2', '3']);
  assert.ok(fake.calls.every(c => new URL(c.url).searchParams.get('limit') === '50'));
});

test('findIssues stops after the first page when it is short, and reads at most 5 pages', async () => {
  const short = fakeGitea(() => ({status: 200, body: '[]'}));
  await createGiteaClient({baseUrl: BASE, token: TOKEN, transport: short.transport}).findIssues('o', 'r', 'x');
  assert.equal(short.calls.length, 1);
  const full = fakeGitea(() => ({status: 200, body: JSON.stringify(Array.from({length: 50}, (_, i) => ({number: i + 1})))}));
  const found = await createGiteaClient({baseUrl: BASE, token: TOKEN, transport: full.transport}).findIssues('o', 'r', 'x');
  assert.equal(full.calls.length, 5);
  assert.equal(found.length, 250);
});

test('findIssues refuses a query that is not a string before sending anything', async () => {
  const fake = fakeGitea(() => ({status: 200, body: '[]'}));
  const client = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fake.transport});
  for (const query of [undefined, null, 5, {}, ['x']]) await assert.rejects(client.findIssues('o', 'r', query), GiteaError, String(query));
  assert.equal(fake.calls.length, 0);
});

test('currentUser reads the login of the token user and parses defensively', async () => {
  const fake = fakeGitea(() => ({status: 200, body: JSON.stringify({id: 1, login: 'qa-worker', email: 'x'})}));
  assert.deepEqual(await createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fake.transport}).currentUser(), {login: 'qa-worker'});
  assert.equal(fake.calls[0].method, 'GET');
  assert.equal(fake.calls[0].url, BASE + '/api/v1/user');
  for (const body of ['null', '[]', '{}', '{"login":""}', '{"login":5}']) {
    const client = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fakeGitea(() => ({status: 200, body})).transport});
    await assert.rejects(client.currentUser(), GiteaError, body);
  }
});

test('findIssues reads the author defensively', async () => {
  const list = [{number: 1, user: {login: 'a'}}, {number: 2, user: null}, {number: 3, user: {login: 4}}, {number: 4}];
  const client = createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fakeGitea(() => ({status: 200, body: JSON.stringify(list)})).transport});
  assert.deepEqual((await client.findIssues('o', 'r', 'x')).map(issue => issue.user.login), ['a', '', '', '']);
});
