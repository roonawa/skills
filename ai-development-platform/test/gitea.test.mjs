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
  assert.deepEqual(found, [{number: 1, title: 'a', body: '', html_url: 'https://h/1', state: 'open'}]);
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
  assert.deepEqual(Object.keys(client).sort(), ['createIssue', 'findIssues']);
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

test('findIssues reads only the first page of 50', async () => {
  const fake = fakeGitea(() => ({status: 200, body: '[]'}));
  await createGiteaClient({baseUrl: BASE, token: TOKEN, transport: fake.transport}).findIssues('o', 'r', 'x');
  assert.equal(new URL(fake.calls[0].url).searchParams.get('limit'), '50');
  assert.equal(new URL(fake.calls[0].url).searchParams.get('page'), null);
});
