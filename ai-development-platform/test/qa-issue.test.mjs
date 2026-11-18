import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildIssue, createIssueFromRun } from '../dist/qa-issue.js';
import { checkProfileText } from '../dist/qa-profile.js';
import { BASE, TOKEN, fakeGitea, giteaRepo } from './gitea-fake.mjs';

const RUN = 'runs/20261118-new-cases';
const MARKER = '<!-- aidev-qa: sample-web TC-order-002 -->';
const profile = (tracker = `issue_tracker: {type: gitea, url: ${BASE}, repo: qa-org/sample-web}\n`) =>
  '---\nproduct: sample-web\n' + tracker + '---\n# 観点\n';

const result = `# 実行結果 20261118-new-cases

- 環境: new
- 版: 2.3.0（画面の右下の表示）
- 実行日時: 2026-11-18 14:05〜14:21（テストの実行の記録から）
- 備考: 冒頭に足した行

| TC-ID | 結果 | 証跡 | Issue |
|---|---|---|---|
| TC-order-001 | OK | runs/20261118-new-cases/evidence/TC-order-001/ | |
| TC-order-002 | NG | runs/20261118-new-cases/evidence/TC-order-002/ | |
| TC-order-003 | 実行不能 | | |
| TC-order-004 | NG | runs/20261118-new-cases/evidence/TC-order-004/ | |

## 実行の条件

- コマンド: test_commands の e2e

\`\`\`markdown
### TC-order-002 囲みの中の見出しは読まない
- 実際の結果: 囲みの中
| TC-order-002 | OK | x | |
\`\`\`

## NG の詳細

### TC-order-002 数量が上限を 1 超えると注文できない
- AC: AC-022
- テスト: automation/web/tests/order.spec.ts の「TC-order-002 …」
- 再現手順
  1. 購入者のロール（SAMPLE_BUYER_USER）でログインする
  2. 商品の詳細画面（商品コード P-0001）で数量に 100 を入れ、注文を押す
- 期待結果: 注文されず、数量の欄の下に「数量は 99 以下にしてください」と表示される
- 実際の結果: 注文履歴の画面に移り、数量 100 の注文が先頭の行に出た。エラーの表示はなかった
  \`\`\`text
  - POST /api/orders 201
  \`\`\`
- 証跡: runs/20261118-new-cases/evidence/TC-order-002/（02-after-submit.png、02-after-submit.values.json）
- 再現: 3回とも同じ
- 補足: 期待結果の誤りの可能性は低い（設計書 4.2 に上限 99 の記載がある）

### TC-order-004 送料が表示されない
- AC: AC-030
- 再現手順
  1. カートを開く
- 期待結果: 送料が表示される
- 実際の結果: 送料の欄が空
- 証跡: runs/20261118-new-cases/evidence/TC-order-004/
- 再現: 3回とも同じ

## 実行不能の理由

### TC-order-003
- 理由: 前提の在庫切れの商品が環境にない
`.replace(/\r\n/g, '\n'); // A CRLF checkout must not change the fixture.

function sandbox(t, text = result, profileText = profile()) {
  const root = mkdtempSync(join(tmpdir(), 'aidev-issue-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'knowledge', 'sample-web'), {recursive: true});
  writeFileSync(join(root, 'knowledge', 'sample-web', 'profile.md'), profileText);
  mkdirSync(join(root, ...RUN.split('/')), {recursive: true});
  writeFileSync(join(root, ...RUN.split('/'), 'result.md'), text);
  const file = join(root, ...RUN.split('/'), 'result.md');
  return {root, file, read: () => readFileSync(file, 'utf8'), options: (extra = {}) =>
    ({root, profile: 'knowledge/sample-web/profile.md', run: RUN, tc: 'TC-order-002', dryRun: false, token: TOKEN, giteaUrl: BASE, ...extra})};
}
const handler = (existing = []) => giteaRepo({issues: existing}).handler;
const methods = fake => fake.calls.map(c => c.method + ' ' + new URL(c.url).pathname.replace('/api/v1/repos/qa-org/sample-web', ''));

test('build a title and body from the NG detail', () => {
  const {title, body} = buildIssue(result, 'TC-order-002', {product: 'sample-web', run: RUN});
  assert.equal(title, '[TC-order-002] 数量が上限を 1 超えると注文できない');
  assert.equal(body.split('\n')[0], MARKER);
  for (const part of ['AC-022', 'TC-order-002', RUN, '1. 購入者のロール（SAMPLE_BUYER_USER）でログインする',
    '2. 商品の詳細画面（商品コード P-0001）で数量に 100 を入れ、注文を押す',
    '注文されず、数量の欄の下に「数量は 99 以下にしてください」と表示される',
    '注文履歴の画面に移り、数量 100 の注文が先頭の行に出た', '- POST /api/orders 201',
    'runs/20261118-new-cases/evidence/TC-order-002/（02-after-submit.png', '3回とも同じ', '設計書 4.2', '環境: new', '2.3.0']) {
    assert.ok(body.includes(part), part);
  }
  for (const heading of ['## 再現手順', '## 期待結果', '## 実際の結果', '## 再現の回数', '## 証跡の場所']) assert.ok(body.includes('\n' + heading + '\n'), heading);
  assert.ok(!body.includes('囲みの中'));
  assert.ok(!body.includes('送料'));
  // CRLF and extra header lines do not change the result.
  assert.deepEqual(buildIssue(result.replace(/\n/g, '\r\n'), 'TC-order-002', {product: 'sample-web', run: RUN}), {title, body});
});

test('refuse a TC that is not NG', () => {
  for (const tc of ['TC-order-001', 'TC-order-003']) {
    assert.throws(() => buildIssue(result, tc, {product: 'sample-web', run: RUN}), /NG ではありません/, tc);
  }
  assert.throws(() => buildIssue(result, 'TC-order-999', {product: 'sample-web', run: RUN}), /TC-order-999/);
  const noDetail = result.replace('### TC-order-004 送料が表示されない', '### TC-order-005 別のケース');
  assert.throws(() => buildIssue(noDetail, 'TC-order-004', {product: 'sample-web', run: RUN}), /NG の詳細/);
  const twice = result.replace('| TC-order-003 | 実行不能 | | |', '| TC-order-002 | NG | | |');
  assert.throws(() => buildIssue(twice, 'TC-order-002', {product: 'sample-web', run: RUN}), /2 行/);
});

test('refuse a body that contains secrets', async t => {
  const secret = 'abc123secretvalue';
  const text = result.replace('  - POST /api/orders 201', '  Cookie: sessionid=' + secret);
  for (const dryRun of [false, true]) {
    const box = sandbox(t, text);
    const fake = fakeGitea(handler());
    await assert.rejects(createIssueFromRun(box.options({dryRun, transport: fake.transport})), error => {
      assert.match(error.message, /秘密情報/);
      assert.match(error.message, /\d+ 行目/);
      assert.ok(!error.message.includes(secret) && !error.message.includes('sessionid') && !error.message.includes(TOKEN));
      return true;
    });
    assert.equal(fake.calls.length, 0);
    assert.equal(box.read(), text);
  }
});

test('do not create a duplicate issue', async t => {
  const box = sandbox(t);
  const fake = fakeGitea(handler([
    {number: 3, title: '[TC-order-0021] x', body: '<!-- aidev-qa: sample-web TC-order-0021 -->', html_url: BASE + '/i/3', state: 'open'},
    {number: 5, title: '[TC-order-002] 数量', body: MARKER + '\n本文', html_url: BASE + '/i/5'},
  ]));
  const out = await createIssueFromRun(box.options({transport: fake.transport}));
  assert.equal(out.created, false);
  assert.deepEqual(out.issue, {number: 5, url: BASE + '/i/5'});
  assert.deepEqual(methods(fake), ['GET /api/v1/user', 'GET /issues']);
  assert.deepEqual(out.ignored, []);
  const query = new URL(fake.calls[1].url).searchParams;
  assert.equal(query.get('q'), 'aidev-qa: sample-web TC-order-002');
  assert.equal(query.get('limit'), '50');
  assert.ok(box.read().includes('| TC-order-002 | NG | runs/20261118-new-cases/evidence/TC-order-002/ | #5 |'));
});

test('dry run sends nothing and writes nothing', async t => {
  const box = sandbox(t);
  const fake = fakeGitea(handler());
  // Ruling: a dry run sends nothing at all (not even the duplicate search) and needs no token.
  const out = await createIssueFromRun(box.options({dryRun: true, token: undefined, transport: fake.transport}));
  assert.equal(fake.calls.length, 0);
  assert.equal(box.read(), result);
  assert.equal(out.dryRun, true);
  assert.equal(out.created, false);
  assert.equal(out.issue, null);
  assert.equal(out.title, '[TC-order-002] 数量が上限を 1 超えると注文できない');
  assert.ok(out.body.startsWith(MARKER));
  assert.deepEqual(out.to, {type: 'gitea', url: BASE, repo: 'qa-org/sample-web'});
  assert.deepEqual(readdirSync(join(box.root, ...RUN.split('/'))), ['result.md']);
});

test('write back only the issue cell', async t => {
  for (const eol of ['\n', '\r\n']) {
    const original = result.replace(/\n/g, eol);
    const box = sandbox(t, original);
    const fake = fakeGitea(handler());
    const out = await createIssueFromRun(box.options({transport: fake.transport}));
    assert.equal(out.created, true);
    assert.deepEqual(out.issue, {number: 7, url: BASE + '/qa-org/sample-web/issues/7'});
    assert.deepEqual(methods(fake), ['GET /api/v1/user', 'GET /issues', 'POST /issues']);
    const sent = JSON.parse(fake.calls[2].body);
    assert.ok(sent.body.startsWith(MARKER));
    const row = '| TC-order-002 | NG | runs/20261118-new-cases/evidence/TC-order-002/ | |';
    assert.equal(box.read(), original.replace(row, row.slice(0, -2) + ' #7 |'));
    assert.deepEqual(readdirSync(join(box.root, ...RUN.split('/'))), ['result.md']);
    assert.ok(!JSON.stringify(out).includes(TOKEN));
  }
});

test('the token goes only to GITEA_URL, and the profile must name the same origin', async t => {
  for (const dryRun of [false, true]) {
    for (const giteaUrl of [undefined, '', 'https://other.example.internal', 'http://gitea.example.internal',
      'https://gitea.example.internal:8443', 'not a url', 'https://u:p@gitea.example.internal']) {
      const box = sandbox(t);
      const fake = fakeGitea(handler());
      await assert.rejects(createIssueFromRun(box.options({dryRun, giteaUrl, transport: fake.transport})), error => {
        assert.match(error.message, /GITEA_URL/);
        assert.ok(!error.message.includes('other.example') && !error.message.includes(TOKEN) && !error.message.includes('u:p'));
        return true;
      }, String(giteaUrl));
      assert.equal(fake.calls.length, 0);
      assert.equal(box.read(), result);
    }
  }
  // GITEA_URL (with its path) is the base URL actually used.
  const box = sandbox(t);
  const fake = fakeGitea(handler());
  await createIssueFromRun(box.options({giteaUrl: BASE + '/gitea', transport: fake.transport}));
  assert.ok(fake.calls.every(call => call.url.startsWith(BASE + '/gitea/api/v1/')));
});

test('only open issues of the token user count as duplicates', async t => {
  for (const [seed, reason] of [[{user: {login: 'someone-else'}}, '別のユーザーが作成'], [{state: 'closed'}, '閉じている'],
    [{user: null}, '別のユーザーが作成']]) {
    const box = sandbox(t);
    const fake = fakeGitea(handler([{number: 5, title: '[TC-order-002] 偽', body: MARKER + '\n偽の本文', html_url: BASE + '/i/5', ...seed}]));
    const out = await createIssueFromRun(box.options({transport: fake.transport}));
    assert.equal(out.created, true, reason);
    assert.equal(out.issue.number, 7);
    assert.deepEqual(out.ignored, [{number: 5, reason}]);
    assert.ok(!JSON.stringify(out).includes('偽の本文'));
    assert.ok(box.read().includes('evidence/TC-order-002/ | #7 |'));
  }
});

test('stop instead of overwriting a different issue number', async t => {
  const text = result.replace('evidence/TC-order-002/ | |', 'evidence/TC-order-002/ | #3 |');
  const box = sandbox(t, text);
  const fake = fakeGitea(handler());
  await assert.rejects(createIssueFromRun(box.options({transport: fake.transport})), /#3/);
  assert.deepEqual(methods(fake), ['GET /api/v1/user', 'GET /issues']);
  assert.equal(box.read(), text);
  // The same number that the search finds is not a conflict.
  const again = fakeGitea(handler([{number: 3, title: 't', body: MARKER, html_url: BASE + '/i/3', state: 'open'}]));
  const out = await createIssueFromRun(box.options({transport: again.transport}));
  assert.equal(out.created, false);
  assert.equal(out.issue.number, 3);
  assert.equal(box.read(), text);
  // Something other than an issue number in the cell is refused before anything is sent.
  const odd = sandbox(t, result.replace('evidence/TC-order-002/ | |', 'evidence/TC-order-002/ | 起票済み |'));
  const none = fakeGitea(handler());
  await assert.rejects(createIssueFromRun(odd.options({transport: none.transport})), /Issue の列/);
  assert.equal(none.calls.length, 0);
});

test('a missing or malformed token stops before sending', async t => {
  for (const token of [undefined, '', 'has space', '改行\n']) {
    const box = sandbox(t);
    const fake = fakeGitea(handler());
    await assert.rejects(createIssueFromRun(box.options({token, transport: fake.transport})), error => {
      assert.match(error.message, /GITEA_TOKEN/);
      if (token) assert.ok(!error.message.includes(token));
      return true;
    });
    assert.equal(fake.calls.length, 0);
  }
});

test('reject a run directory or TC-ID outside the expected form', async t => {
  const box = sandbox(t);
  for (const run of ['../runs/20261118-x', 'runs/../x', 'cases', 'runs/2026-11-18-x', 'C:/runs/20261118-x']) {
    await assert.rejects(createIssueFromRun(box.options({run, dryRun: true})), /runs/, run);
  }
  for (const tc of ['order-002', 'TC-order-002 -->', 'TC-a/b']) {
    await assert.rejects(createIssueFromRun(box.options({tc, dryRun: true})), /TC-ID/, tc);
  }
  const out = await createIssueFromRun(box.options({run: RUN + '/', dryRun: true}));
  assert.equal(out.dryRun, true);
});

test('profile check requires issue_tracker for bug-ticket', async t => {
  const r = checkProfileText('p.md', profile(''), 'aidev-qa-bug-ticket');
  assert.ok(r.errors.some(e => e.code === 'required' && e.path === 'issue_tracker'));
  assert.deepEqual(checkProfileText('p.md', profile(), 'aidev-qa-bug-ticket').errors, []);
  for (const bad of ['issue_tracker: {type: github, url: https://h.example, repo: a/b}\n',
    'issue_tracker: {type: gitea, url: https://h.example, repo: a}\n', 'issue_tracker: {type: gitea, url: https://h.example, repo: a/b/c}\n',
    'issue_tracker: {type: gitea, url: https://h.example, repo: ../b}\n', 'issue_tracker: {type: gitea, repo: a/b}\n', 'issue_tracker: gitea\n']) {
    assert.ok(checkProfileText('p.md', profile(bad), 'aidev-qa-bug-ticket').errors.some(e => e.path?.startsWith('issue_tracker')), bad);
  }
  const box = sandbox(t, result, profile(''));
  await assert.rejects(createIssueFromRun(box.options({dryRun: true})), /issue_tracker/);
});

test('reject issue_tracker with http to a non-local host', () => {
  const tracker = url => profile(`issue_tracker: {type: gitea, url: "${url}", repo: a/b}\n`);
  for (const url of ['http://gitea.example.test', 'ftp://gitea.example.test', 'https://gitea.example.test/?a=1', 'https://gitea.example.test/#x']) {
    const r = checkProfileText('p.md', tracker(url), 'aidev-qa-bug-ticket');
    assert.ok(r.errors.some(e => e.path === 'issue_tracker.url'), url);
  }
  for (const url of ['http://localhost:3999', 'http://127.0.0.1:3999', 'https://gitea.example.test/sub']) {
    assert.deepEqual(checkProfileText('p.md', tracker(url), 'aidev-qa-bug-ticket').errors, [], url);
  }
});

test('the CLI creates an issue with GITEA_TOKEN and never prints it', async t => {
  const issues = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if (req.headers.authorization !== 'token ' + TOKEN) { res.writeHead(401); res.end(); return; }
      if (req.method === 'GET' && req.url === '/api/v1/user') { res.writeHead(200); res.end(JSON.stringify({login: 'qa-worker'})); return; }
      if (req.method === 'GET') { res.writeHead(200); res.end(JSON.stringify(issues)); return; }
      const input = JSON.parse(raw);
      issues.push({number: 9, title: input.title, body: input.body, html_url: 'http://127.0.0.1/i/9', state: 'open', user: {login: 'qa-worker'}});
      res.writeHead(201); res.end(JSON.stringify(issues.at(-1)));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }));
  const url = 'http://127.0.0.1:' + server.address().port;
  const box = sandbox(t, result, profile(`issue_tracker: {type: gitea, url: "${url}", repo: qa-org/sample-web}\n`));
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const invoke = (args, token) => new Promise(resolve => {
    const env = {...process.env};
    delete env.GITEA_TOKEN;
    env.GITEA_URL = url;
    if (token !== undefined) env.GITEA_TOKEN = token;
    const child = spawn(process.execPath, [cli, 'qa', 'issue', 'create', '--profile', 'knowledge/sample-web/profile.md', '--run', RUN, '--tc', 'TC-order-002', ...args],
      {cwd: box.root, env});
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { out += chunk; });
    child.on('close', status => resolve({status, out}));
  });
  const dry = await invoke(['--dry-run']);
  assert.equal(dry.status, 0, dry.out);
  assert.equal(JSON.parse(dry.out).dryRun, true);
  const missing = await invoke([]);
  assert.equal(missing.status, 1, missing.out);
  assert.match(JSON.parse(missing.out).error, /GITEA_TOKEN/);
  const real = await invoke([], TOKEN);
  assert.equal(real.status, 0, real.out);
  assert.ok(!real.out.includes(TOKEN));
  assert.deepEqual(JSON.parse(real.out), {ok: true, issue: {number: 9, url: 'http://127.0.0.1/i/9'}, created: true, dryRun: false, resultUpdated: true, neutralized: {}, ignored: []});
  assert.ok(box.read().includes('evidence/TC-order-002/ | #9 |'));
  const repeat = await invoke([], TOKEN);
  assert.equal(JSON.parse(repeat.out).created, false);
  assert.equal(issues.length, 1);
});

/** The text left after removing fenced blocks and inline code spans (what Gitea would process). */
function outsideCode(markdown) {
  let fenced = false;
  return markdown.split('\n').filter(line => {
    if (/^\s*(`{3,}|~{3,})/.test(line)) { fenced = !fenced; return false; }
    return !fenced;
  }).map(line => line.replace(/(`+)[\s\S]*?\1/g, '')).join('\n');
}

const probe = '@admin #12 other/repo#3 ![x](https://evil.example/p.png) <img src=https://e/x> ' + BASE + '/o/r/issues/4 ![y][ref] qa@example.com `@keep #7`';
const probed = result
  .replace('- 実際の結果: 注文履歴の画面に移り、', '- 実際の結果: ' + probe + ' 注文履歴の画面に移り、')
  .replace('  - POST /api/orders 201', '  @fenced #8 <b>')
  .replace('### TC-order-002 数量が上限を 1 超えると注文できない', '### TC-order-002 数量 @owner #99 の上限');

test('mentions, references, images and HTML are neutralized outside code', () => {
  const {title, body} = buildIssue(probed, 'TC-order-002', {product: 'sample-web', run: RUN});
  const rest = outsideCode(body.split('\n').slice(1).join('\n')) + '\n' + outsideCode(title);
  for (const pattern of [/(^|[^\w])@\w/,/(^|[^\w])#\d/, /\w\/\w+#\d/, /!\[/, /<[a-z/!]/i, /\/issues\/\d/]) assert.doesNotMatch(rest, pattern, String(pattern));
  for (const part of ['`@admin`', '`#12`', '`other/repo#3`', '`![x](https://evil.example/p.png)`', '`<img src=https://e/x>`',
    '`' + BASE + '/o/r/issues/4`', '`![y][ref]`', ' qa@example.com ', '`@keep #7`', '  @fenced #8 <b>'.trim()]) {
    assert.ok(body.includes(part), part);
  }
  assert.equal(title, '[TC-order-002] 数量 `@owner` `#99` の上限');
  assert.equal(body.split('\n')[0], MARKER);
});

test('the output lists what was neutralized by kind, without values', async t => {
  const box = sandbox(t, probed);
  const out = await createIssueFromRun(box.options({dryRun: true}));
  assert.deepEqual(out.neutralized, {mention: 2, reference: 4, image: 2, html: 1});
  const fake = fakeGitea(handler());
  const real = await createIssueFromRun(sandbox(t, probed).options({transport: fake.transport}));
  assert.deepEqual(real.neutralized, out.neutralized);
  assert.equal(JSON.parse(fake.calls[2].body).body, out.body);
  assert.ok(!JSON.stringify(real).includes('evil.example'));
  assert.deepEqual((await createIssueFromRun(sandbox(t).options({dryRun: true}))).neutralized, {});
});

test('the duplicate marker counts only on the first line of the body', async t => {
  const box = sandbox(t);
  const fake = fakeGitea(handler([{number: 5, title: '[TC-order-002] x', body: '引用:\n' + MARKER, html_url: BASE + '/i/5'}]));
  const out = await createIssueFromRun(box.options({transport: fake.transport}));
  assert.equal(out.created, true);
  assert.equal(out.issue.number, 7);
});

test('a row whose cell count differs from the header is refused before sending', async t => {
  for (const row of ['| TC-order-002 | NG | runs/20261118-new-cases/evidence/TC-order-002/', '| TC-order-002 | NG | runs/20261118-new-cases/evidence/TC-order-002/ |',
    '| TC-order-002 | NG | runs/20261118-new-cases/evidence/TC-order-002/ | | x |']) {
    const text = result.replace('| TC-order-002 | NG | runs/20261118-new-cases/evidence/TC-order-002/ | |', row);
    for (const dryRun of [false, true]) {
      const box = sandbox(t, text);
      const fake = fakeGitea(handler());
      await assert.rejects(createIssueFromRun(box.options({dryRun, transport: fake.transport})), /列の数/, row);
      assert.equal(fake.calls.length, 0);
      assert.equal(box.read(), text);
    }
  }
});

test('a title or body containing the token value is not sent', async t => {
  for (const text of [result.replace('エラーの表示はなかった', 'エラーの表示はなかった（' + TOKEN + '）'),
    result.replace('### TC-order-002 数量が', '### TC-order-002 ' + TOKEN + ' 数量が')]) {
    const box = sandbox(t, text);
    const fake = fakeGitea(handler());
    await assert.rejects(createIssueFromRun(box.options({transport: fake.transport})), error => {
      assert.match(error.message, /GITEA_TOKEN/);
      assert.ok(!error.message.includes(TOKEN));
      return true;
    });
    assert.equal(fake.calls.length, 0);
    assert.equal(box.read(), text);
  }
});

test('many continuation lines and a long case name are handled', () => {
  const many = result.replace('  1. カートを開く', Array.from({length: 150000}, () => '  x').join('\n'))
    .replace('### TC-order-004 送料が表示されない', '### TC-order-004 ' + 'あ'.repeat(400));
  const {title, body} = buildIssue(many, 'TC-order-004', {product: 'sample-web', run: RUN});
  assert.ok([...title].length <= 255, String([...title].length));
  assert.ok(title.startsWith('[TC-order-004] あ'));
  assert.ok(body.includes('x\nx\nx'));
});
