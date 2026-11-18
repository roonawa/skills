import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed } from '../templates/qa/samples/web/app/seed.mjs';

const samples = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'qa', 'samples');
const serverPath = join(samples, 'web', 'app', 'server.mjs');

// 架空の値。実在の資格情報ではない。
const fakeEnv = {
  SAMPLE_STAFF_USER: 'staff-a', SAMPLE_STAFF_PASSWORD: 'pw-staff-a',
  SAMPLE_STAFF_FIFTY_USER: 'staff-b', SAMPLE_STAFF_FIFTY_PASSWORD: 'pw-staff-b',
  SAMPLE_STAFF_EMPTY_USER: 'staff-c', SAMPLE_STAFF_EMPTY_PASSWORD: 'pw-staff-c',
  SAMPLE_STAFF_OTHER_USER: 'staff-d', SAMPLE_STAFF_OTHER_PASSWORD: 'pw-staff-d',
  SAMPLE_ADMIN_USER: 'admin-a', SAMPLE_ADMIN_PASSWORD: 'pw-admin-a',
};
const creds = {
  staff: ['staff-a', 'pw-staff-a'], fifty: ['staff-b', 'pw-staff-b'], empty: ['staff-c', 'pw-staff-c'],
  other: ['staff-d', 'pw-staff-d'], admin: ['admin-a', 'pw-admin-a'],
};

function cleanEnv(extra) {
  const env = {...process.env};
  for (const k of Object.keys(env)) if (k.startsWith('SAMPLE_')) delete env[k];
  return {...env, ...extra};
}

async function start(t, version, extra = fakeEnv) {
  const child = spawn(process.execPath, [serverPath, '--version', version, '--port', '0'], {
    env: cleanEnv(extra), stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { child.kill(); });
  let buf = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start: ' + buf)), 10000);
    child.stdout.on('data', d => {
      buf += d;
      const m = /listening http:\/\/localhost:(\d+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + ': ' + buf)); });
  });
  return 'http://127.0.0.1:' + port;
}

async function login(base, [user, password]) {
  const res = await fetch(base + '/login', {
    method: 'POST', redirect: 'manual',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({username: user, password}),
  });
  assert.equal(res.status, 303);
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('sid='));
  assert.ok(cookie);
  return {cookie};
}
const get = (base, path, s) => fetch(base + path, {redirect: 'manual', headers: s ? {cookie: s.cookie} : {}});
const post = (base, path, s, fields) => fetch(base + path, {
  method: 'POST', redirect: 'manual',
  headers: {'content-type': 'application/x-www-form-urlencoded', ...(s ? {cookie: s.cookie} : {})},
  body: new URLSearchParams(fields),
});

const data = seed(fakeEnv);
const userOf = key => data.users.find(u => u.key === key);
const loansOf = key => data.loans.filter(l => l.ownerKey === key);
const byId = (a, b) => a - b;

function rowIds(html) {
  return [...html.matchAll(/data-testid="loan-row" data-loan-id="(\d+)"/g)].map(m => Number(m[1]));
}

test('seed has the documented shape', () => {
  assert.equal(data.users.filter(u => u.role === 'staff').length, 4);
  assert.equal(data.users.filter(u => u.role === 'admin').length, 1);
  assert.equal(loansOf('staffEmpty').length, 0);
  assert.equal(loansOf('staffFifty').length, 50);
  assert.ok(loansOf('staff').length >= 51);
  const notes = loansOf('staff').map(l => l.note);
  assert.ok(notes.some(n => n) && notes.some(n => !n));
  assert.throws(() => seed({}), /SAMPLE_/);
});

test('server refuses to start without credentials in env', async () => {
  const child = spawn(process.execPath, [serverPath, '--version', 'new', '--port', '0'], {env: cleanEnv({}), stdio: 'ignore'});
  // A server that starts anyway would never exit; stop it after a while so the test fails instead of hanging.
  const timer = setTimeout(() => child.kill(), 10000);
  const code = await new Promise(resolve => child.on('exit', resolve));
  clearTimeout(timer);
  assert.equal(code, 1, 'the server should exit with code 1 instead of starting');
});

for (const version of ['old', 'new']) {
  test(version + ': unauthenticated requests go to the login screen', async t => {
    const base = await start(t, version);
    for (const path of ['/loans', '/loans/1', '/loans/new', '/loans.csv']) {
      const res = await get(base, path);
      assert.equal(res.status, 302, path);
      assert.equal(res.headers.get('location'), '/login', path);
    }
    const res = await post(base, '/loans', null, {item: 'x'});
    assert.equal(res.status, 302);
  });

  test(version + ': login success, failure and cookie flags', async t => {
    const base = await start(t, version);
    const bad = await post(base, '/login', null, {username: creds.staff[0], password: 'wrong'});
    const bad2 = await post(base, '/login', null, {username: 'nobody', password: 'wrong'});
    assert.equal(bad.status, 401);
    const [t1, t2] = [await bad.text(), await bad2.text()];
    assert.match(t1, /data-testid="login-error"/);
    assert.equal(t1, t2, 'the error does not reveal which field was wrong');
    const ok = await fetch(base + '/login', {
      method: 'POST', redirect: 'manual',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({username: creds.staff[0], password: creds.staff[1]}),
    });
    const cookie = ok.headers.getSetCookie().join(';');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  });

  test(version + ': staff gets 403 for another user loan, admin and owner can open', async t => {
    const base = await start(t, version);
    const staff = await login(base, creds.staff);
    const foreign = loansOf('staffOther')[0];
    const res = await get(base, '/loans/' + foreign.id, staff);
    assert.equal(res.status, 403);
    const body = await res.text();
    assert.ok(!body.includes(foreign.item));
    assert.ok(!body.includes(foreign.note || 'no-note'));
    const admin = await login(base, creds.admin);
    const ok = await get(base, '/loans/' + foreign.id, admin);
    assert.equal(ok.status, 200);
    const html = await ok.text();
    for (const v of [foreign.item, userOf('staffOther').username, foreign.loanDate, foreign.dueDate])
      assert.ok(html.includes(v), v);
    const own = loansOf('staff')[0];
    assert.equal((await get(base, '/loans/' + own.id, staff)).status, 200);
  });

  test(version + ': unknown loan id gives 404', async t => {
    const base = await start(t, version);
    const staff = await login(base, creds.staff);
    assert.equal((await get(base, '/loans/999999', staff)).status, 404);
    assert.equal((await get(base, '/loans/abc', staff)).status, 404);
  });

  test(version + ': list scope, empty message and pagination boundary 50 and 51', async t => {
    const base = await start(t, version);
    const empty = await (await get(base, '/loans', await login(base, creds.empty))).text();
    assert.match(empty, /貸出はありません/);
    assert.ok(!empty.includes('data-testid="loan-row"'));

    const fiftySession = await login(base, creds.fifty);
    const fifty = await (await get(base, '/loans', fiftySession)).text();
    assert.equal(rowIds(fifty).length, 50);
    assert.ok(!/data-testid="next-page" href/.test(fifty));
    assert.equal(rowIds(await (await get(base, '/loans?page=2', fiftySession)).text()).length, 0);

    const staff = await login(base, creds.staff);
    const total = loansOf('staff').length;
    const p1 = await (await get(base, '/loans', staff)).text();
    assert.equal(rowIds(p1).length, 50);
    assert.match(p1, /data-testid="next-page" href="\/loans\?page=2"/);
    assert.ok(!/data-testid="prev-page" href/.test(p1));
    const p2 = await (await get(base, '/loans?page=2', staff)).text();
    assert.equal(rowIds(p2).length, total - 50);
    assert.ok(!/data-testid="next-page" href/.test(p2));
    assert.match(p2, /data-testid="prev-page" href="\/loans\?page=1"/);
    const all = [...rowIds(p1), ...rowIds(p2)].sort(byId);
    assert.deepEqual(all, loansOf('staff').map(l => l.id).sort(byId));
  });

  test(version + ': list scope per role, csv link only for admin', async t => {
    const base = await start(t, version);
    const staffHtml = await (await get(base, '/loans', await login(base, creds.other))).text();
    assert.deepEqual(rowIds(staffHtml).sort(byId), loansOf('staffOther').map(l => l.id).sort(byId));
    assert.ok(!staffHtml.includes('data-testid="csv-export"'));
    const adminHtml = await (await get(base, '/loans', await login(base, creds.admin))).text();
    assert.equal(rowIds(adminHtml).length, 50);
    assert.match(adminHtml, /data-testid="csv-export"/);
  });

  test(version + ': registration validates and records the borrower', async t => {
    const base = await start(t, version);
    const s = await login(base, creds.empty);
    const ok = {item: 'プロジェクター', loan_date: '2026-06-01', due_date: '2026-06-01', note: ''};
    const bad = async over => (await post(base, '/loans', s, {...ok, ...over})).status;
    assert.equal(await bad({item: ''}), 400);
    assert.equal(await bad({item: 'あ'.repeat(51)}), 400);
    assert.equal(await bad({loan_date: ''}), 400);
    assert.equal(await bad({due_date: ''}), 400);
    assert.equal(await bad({note: 'x'.repeat(201)}), 400);
    assert.equal(await bad({due_date: '2026-05-31'}), 400);
    assert.equal(await bad({due_date: '2026-07-02'}), 400);
    assert.equal(await bad({due_date: '2026-02-30'}), 400);
    assert.ok(!(await (await get(base, '/loans', s)).text()).includes('data-testid="loan-row"'));
    for (const over of [{}, {due_date: '2026-07-01'}, {item: 'あ'.repeat(50), note: 'x'.repeat(200)}]) {
      const res = await post(base, '/loans', s, {...ok, ...over});
      assert.equal(res.status, 303);
      assert.equal(res.headers.get('location'), '/loans');
    }
    const list = await (await get(base, '/loans', s)).text();
    assert.equal(rowIds(list).length, 3);
    const id = rowIds(list)[0];
    assert.ok((await (await get(base, '/loans/' + id, s)).text()).includes(creds.empty[0]));
  });

  test(version + ': user supplied text is escaped', async t => {
    const base = await start(t, version);
    const s = await login(base, creds.empty);
    const evil = '<script>alert(1)</script>';
    const res = await post(base, '/loans', s, {item: evil, loan_date: '2026-06-01', due_date: '2026-06-02', note: evil});
    assert.equal(res.status, 303);
    const list = await (await get(base, '/loans', s)).text();
    assert.ok(!list.includes(evil));
    const id = rowIds(list)[0];
    const detail = await (await get(base, '/loans/' + id, s)).text();
    assert.ok(!detail.includes(evil));
    assert.ok(detail.includes('&lt;script&gt;'));
    const rejected = await (await post(base, '/loans', s, {item: evil, loan_date: '', due_date: '', note: ''})).text();
    assert.ok(!rejected.includes(evil));
  });
}

test('list order differs between versions as intended', async t => {
  const rows = loansOf('staff');
  assert.ok(new Set(rows.map(l => l.loanDate)).size < rows.length, 'seed has same-date loans');
  const expected = {
    old: [...rows].sort((a, b) => a.loanDate.localeCompare(b.loanDate) || a.id - b.id).map(l => l.id),
    new: [...rows].sort((a, b) => b.loanDate.localeCompare(a.loanDate) || b.id - a.id).map(l => l.id),
  };
  for (const version of ['old', 'new']) {
    const base = await start(t, version);
    const s = await login(base, creds.staff);
    const ids = [...rowIds(await (await get(base, '/loans', s)).text()), ...rowIds(await (await get(base, '/loans?page=2', s)).text())];
    assert.deepEqual(ids, expected[version], version);
  }
});

test('csv date format differs only in new', async t => {
  const header = '貸出ID,備品名,借りた人,貸出日,返却予定日';
  const out = {};
  for (const version of ['old', 'new']) {
    const base = await start(t, version);
    const res = await get(base, '/loans.csv', await login(base, creds.admin));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv; charset=utf-8/i);
    const lines = (await res.text()).split(/\r?\n/).filter(Boolean);
    assert.equal(lines[0], header);
    assert.equal(lines.length, data.loans.length + 1);
    out[version] = lines[1].split(',');
  }
  const first = data.loans[0];
  assert.deepEqual(out.old.slice(0, 3), [String(first.id), first.item, userOf(first.ownerKey).username]);
  assert.equal(out.old[3], first.loanDate);
  assert.match(out.old[3], /^\d{4}-\d{2}-\d{2}$/);
  assert.match(out.new[3], /^\d{4}\/\d{2}\/\d{2}$/);
  assert.match(out.new[4], /^\d{4}\/\d{2}\/\d{2}$/);
  assert.equal(out.new[3].replaceAll('/', '-'), first.loanDate);
});

test('planted csv authz defect exists only in new', async t => {
  const status = {};
  for (const version of ['old', 'new']) {
    const base = await start(t, version);
    status[version] = (await get(base, '/loans.csv', await login(base, creds.staff))).status;
  }
  assert.deepEqual(status, {old: 403, new: 200});
});

test('sample docs do not reveal planted differences', () => {
  for (const f of ['requirements.md', 'knowledge/sample-web/profile.md', 'app/README.md']) {
    const text = readFileSync(join(samples, 'web', f), 'utf8');
    assert.doesNotMatch(text, /yyyy\/MM\/dd|\/loans\.csv.{0,20}(200|返る)|わざと/);
    if (f !== 'requirements.md') assert.doesNotMatch(text, /403|未選択|日付の形式/);
  }
});
