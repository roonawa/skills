// Fake Gitea for the tests. No network: the transport records every request and answers from a handler.
export const TOKEN = 'gitea_secret_token_value_5678';
export const BASE = 'https://gitea.example.internal';

export function fakeGitea(handler) {
  const calls = [];
  const transport = async request => {
    calls.push(request);
    return handler ? handler(request) : {status: 404, body: ''};
  };
  return {transport, calls};
}

/**
 * An in-memory repository for fakeGitea: answers GET /api/v1/user (the token's user), searches issues by q in the
 * title or body, and creates issues authored by that user. Seeded issues default to open and to that user.
 */
export function giteaRepo({login = 'qa-worker', issues = [], next = 7} = {}) {
  const state = {login, next, issues: issues.map(issue => ({state: 'open', user: {login}, ...issue}))};
  const handler = request => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.endsWith('/api/v1/user')) return {status: 200, body: JSON.stringify({id: 1, login: state.login})};
    if (request.method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      return {status: 200, body: JSON.stringify(state.issues.filter(issue => issue.title.includes(q) || issue.body.includes(q)))};
    }
    const input = JSON.parse(request.body);
    const number = state.next++;
    const issue = {number, title: input.title, body: input.body, html_url: BASE + '/qa-org/sample-web/issues/' + number, state: 'open', user: {login: state.login}};
    state.issues.push(issue);
    return {status: 201, body: JSON.stringify(issue)};
  };
  return {handler, state};
}
