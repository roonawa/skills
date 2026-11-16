// Fake C-HUB for the tests. No network: responses come from a route table.
export const TOKEN = 'chub_secret_token_value_1234';
export const BASE = 'https://chub.example.internal:3030';
export const env = {CHUB_TOKEN: TOKEN, CHUB_BASE_URL: BASE};

const ok = data => ({status: 200, body: JSON.stringify({ok: true, data})});

export const template = (repo = 'org/app', acs = ['AC-001: 一覧に件数を出す', 'AC-002: 0件なら空表示']) =>
  ['対象リポジトリ: ' + repo, '基準ブランチ: main', '受け入れ条件:', ...acs.map(a => '- ' + a), 'やらないこと:', '- 検索', '参考: docs/spec.md'].join('\n');

export function fakeChub({tasks = [], overrides = {}} = {}) {
  const calls = [];
  const routes = {
    '/api/plugin/task-manager/projects': ok({projects: [
      {id: 'tp-1', title: 'テスト用ボード', archived: '0'},
      {id: 'tp-old', title: '古いボード', archived: '1'},
    ]}),
    '/api/plugin/task-manager/projects/tp-1/sections': ok({sections: [
      {id: 351, name: 'AI実装待ち'}, {id: 352, name: 'AI実行中'}, {id: 353, name: '人の確認待ち'}]}),
    '/api/plugin/task-manager/projects/tp-1/tasks': ok({tasks: tasks.map(({description, comments, ...t}) => t)}),
    ...Object.fromEntries(tasks.map(t => ['/api/plugin/task-manager/tasks/' + t.id, ok({task: t})])),
    ...overrides,
  };
  const transport = async request => {
    calls.push(request);
    const path = new URL(request.url).pathname;
    return routes[path] ?? {status: 404, body: ''};
  };
  return {transport, calls};
}

export const task = (id, section, description, extra = {}) =>
  ({id, title: 'タスク ' + id, section_id: section, created_at: extra.created_at ?? '2026-11-01 09:00:00', description, ...extra});
