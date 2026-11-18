/**
 * Minimal Gitea client for `aidev qa issue create` (phase 3).
 * It can read issues and the token's own user, and create an issue; nothing else (no comments, edits, closing, labels or branches).
 * The token travels only in the Authorization header. Error messages never contain the token or the URL.
 */
export interface GiteaRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
}
export interface GiteaResponse {
  status: number;
  body: string;
  location?: string;
}
export type GiteaTransport = (request: GiteaRequest) => Promise<GiteaResponse>;

export class GiteaError extends Error {}

/** Largest response body read from Gitea. An issue list or a created issue is far smaller. */
export const maxGiteaResponseBytes = 2 * 1024 * 1024;

const messages: Record<number, string> = {
  401: 'Gitea: 401 トークンが違う・期限切れ・失効済み、または接続先の違い',
  403: 'Gitea: 403 トークンの権限不足（Issue の書き込み権限が必要）',
  404: 'Gitea: 404 リポジトリが見つからない、またはトークンから見えない',
  422: 'Gitea: 422 Issue の内容が受け付けられませんでした（題名や本文を確認してください）',
};

/** Default transport: Node's fetch with no redirects (the token must not follow one), 30 s timeout, 2 MiB body limit. */
export const fetchGiteaTransport: GiteaTransport = async request => {
  let response: Response;
  try {
    response = await fetch(request.url, {method: request.method, headers: request.headers, body: request.body,
      redirect: 'manual', signal: AbortSignal.timeout(30_000)});
  } catch (error) {
    // The cause may contain the URL; report only the error code.
    const cause = (error as {cause?: {code?: unknown}}).cause;
    const code = typeof cause?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(cause.code) ? cause.code :
      (error as {name?: unknown}).name === 'TimeoutError' ? 'TIMEOUT' : 'UNKNOWN';
    throw new GiteaError('Gitea に接続できません（' + code + '）');
  }
  if (response.status < 200 || response.status > 299) {
    await response.body?.cancel();
    return {status: response.status, body: ''};
  }
  return {status: response.status, body: await readLimited(response)};
};

async function readLimited(response: Response): Promise<string> {
  const tooLarge = () => new GiteaError('Gitea の応答が大きすぎます（' + maxGiteaResponseBytes / 1024 / 1024 + ' MiB を超えました）。');
  if (Number(response.headers.get('content-length')) > maxGiteaResponseBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxGiteaResponseBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof GiteaError) throw error;
    throw new GiteaError('Gitea の応答を読み取れませんでした。');
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export interface GiteaClientOptions {
  baseUrl: string;
  token: string;
  transport?: GiteaTransport;
}
export interface GiteaIssueSummary {number: number; title: string; body: string; html_url: string; state: string; user: {login: string}}
export type GiteaClient = ReturnType<typeof createGiteaClient>;

const namePattern = /^[A-Za-z0-9_.-]+$/;

function checkName(value: string, label: string): string {
  // "." and ".." would change the path once the URL is normalized.
  if (typeof value !== 'string' || !namePattern.test(value) || /^\.+$/.test(value)) throw new GiteaError(label + ' の形式が不正です。');
  return encodeURIComponent(value);
}

function checkBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new GiteaError('Gitea の接続先がない、または URL の形式が違います。');
  }
  const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) {
    throw new GiteaError('Gitea の接続先は https:// で始まり、認証情報やクエリを含まない URL にしてください。');
  }
  return (url.origin + url.pathname).replace(/\/+$/, '');
}

/** A token is printable ASCII without spaces. The message is fixed so the value is never echoed. */
function checkToken(token: unknown): string {
  if (typeof token !== 'string' || !/^[!-~]+$/.test(token)) throw new GiteaError('GITEA_TOKEN が未設定、または形式が違います');
  return token;
}

export function createGiteaClient(options: GiteaClientOptions) {
  const root = checkBaseUrl(options.baseUrl);
  const token = checkToken(options.token);
  const transport = options.transport ?? fetchGiteaTransport;

  async function send(request: GiteaRequest, success: number): Promise<unknown> {
    let response: GiteaResponse;
    try {
      response = await transport(request);
    } catch (error) {
      if (error instanceof GiteaError) throw error;
      throw new GiteaError('Gitea に接続できません（UNKNOWN）');
    }
    if (response.status !== success) {
      const redirect = response.status >= 300 && response.status <= 399;
      throw new GiteaError(redirect ? 'Gitea: ' + response.status + ' 接続先が別の場所へ転送しようとしました（転送は追いません）' :
        messages[response.status] ?? 'Gitea: HTTP ' + response.status);
    }
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      throw new GiteaError('Gitea のレスポンスが JSON ではありません。');
    }
  }

  const headers = (): Record<string, string> => ({Authorization: 'token ' + token, Accept: 'application/json'});
  const issuesPath = (owner: string, repo: string) =>
    root + '/api/v1/repos/' + checkName(owner, 'owner') + '/' + checkName(repo, 'repo') + '/issues';

  return Object.freeze({
    /** The token's own user (read only). Used to count only the worker's own issues as duplicates. */
    async currentUser(): Promise<{login: string}> {
      const json = await send({method: 'GET', url: root + '/api/v1/user', headers: headers()}, 200) as Record<string, unknown> | null;
      if (typeof json !== 'object' || json === null || typeof json.login !== 'string' || !json.login) {
        throw new GiteaError('Gitea の応答にユーザー名がありません。');
      }
      return {login: json.login};
    },
    /**
     * Searches open and closed issues. Only the first page (up to 50) is read: callers pass a narrow query
     * (the duplicate check searches for its marker line), so a match beyond the first page is not expected.
     */
    async findIssues(owner: string, repo: string, query: string): Promise<GiteaIssueSummary[]> {
      const url = issuesPath(owner, repo) + '?' + new URLSearchParams({type: 'issues', state: 'all', q: query, limit: '50'}).toString();
      const json = await send({method: 'GET', url, headers: headers()}, 200);
      if (!Array.isArray(json)) throw new GiteaError('Gitea の Issue 一覧の形式が想定と違います。');
      return json.flatMap(item => {
        const issue = item as Record<string, unknown> | null;
        if (typeof issue !== 'object' || issue === null || typeof issue.number !== 'number') return [];
        const user = issue.user as Record<string, unknown> | null | undefined;
        const login = typeof user === 'object' && user !== null && typeof user.login === 'string' ? user.login : '';
        return [{number: issue.number, title: String(issue.title ?? ''), body: String(issue.body ?? ''), html_url: String(issue.html_url ?? ''),
          state: String(issue.state ?? ''), user: {login}}];
      });
    },
    async createIssue(owner: string, repo: string, issue: {title: string; body: string}): Promise<{number: number; html_url: string}> {
      const request: GiteaRequest = {method: 'POST', url: issuesPath(owner, repo),
        headers: {...headers(), 'Content-Type': 'application/json'}, body: JSON.stringify({title: issue.title, body: issue.body})};
      const json = await send(request, 201) as Record<string, unknown> | null;
      if (typeof json !== 'object' || json === null || typeof json.number !== 'number' || typeof json.html_url !== 'string' || !json.html_url) {
        throw new GiteaError('Gitea の応答に Issue 番号または URL がありません。');
      }
      return {number: json.number, html_url: json.html_url};
    },
  });
}
