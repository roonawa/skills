// 見本 Web の初期データ。テストとサーバーが共用する。
// ユーザー名とパスワードは環境変数から読む。既定値は持たない。

export const ACCOUNTS = [
  {key: 'staff', role: 'staff', envPrefix: 'SAMPLE_STAFF'},
  {key: 'staffFifty', role: 'staff', envPrefix: 'SAMPLE_STAFF_FIFTY'},
  {key: 'staffEmpty', role: 'staff', envPrefix: 'SAMPLE_STAFF_EMPTY'},
  {key: 'staffOther', role: 'staff', envPrefix: 'SAMPLE_STAFF_OTHER'},
  {key: 'admin', role: 'admin', envPrefix: 'SAMPLE_ADMIN'},
];

export function requiredEnvNames() {
  return ACCOUNTS.flatMap(a => [a.envPrefix + '_USER', a.envPrefix + '_PASSWORD']);
}

function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const ITEMS = ['ノートPC', 'プロジェクター', 'モバイルルーター', '延長コード', 'ホワイトボード', 'ビデオカメラ'];

export function seed(env = process.env) {
  const missing = requiredEnvNames().filter(n => !env[n]);
  if (missing.length) throw new Error('環境変数が未設定です: ' + missing.join(', '));
  const users = ACCOUNTS.map(a => ({key: a.key, role: a.role, username: env[a.envPrefix + '_USER'], password: env[a.envPrefix + '_PASSWORD']}));
  const names = users.map(u => u.username);
  if (new Set(names).size !== names.length) throw new Error('ユーザー名が重複しています');

  const loans = [];
  // 同じ貸出日の行ができるよう、2 件ずつ同じ日付にする。
  const add = (ownerKey, count, start, noteEvery) => {
    for (let i = 0; i < count; i++) {
      const loanDate = addDays(start, Math.floor(i / 2));
      loans.push({
        id: loans.length + 1, ownerKey,
        item: ITEMS[i % ITEMS.length] + ' ' + (i + 1),
        loanDate, dueDate: addDays(loanDate, 7),
        note: noteEvery && i % noteEvery === 0 ? 'メモ ' + (i + 1) : '',
      });
    }
  };
  add('staffOther', 3, '2026-02-01', 1);
  add('staff', 55, '2026-03-01', 3);
  add('staffFifty', 50, '2026-04-01', 0);
  return {users, loans};
}
