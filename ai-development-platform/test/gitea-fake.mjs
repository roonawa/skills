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
