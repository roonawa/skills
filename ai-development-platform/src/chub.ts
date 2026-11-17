import { readFileSync } from 'node:fs';

/**
 * Read-only C-HUB client (stage 1 of docs/autonomous-runner-design.md).
 * Writes (comments, section moves) are deliberately absent: the API shape and the AI account are unconfirmed.
 * The request type only allows GET, and the client checks it again at run time.
 */
export interface HttpRequest {
  method: 'GET';
  url: string;
  headers: Record<string, string>;
}
export interface HttpResponse {
  status: number;
  body: string;
}
export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

export interface ChubConfig {
  baseUrl: string;
  token: string;
  boards: string[];
  sections: {ready: string; running?: string; needsHuman: string};
  allowedRepositories: string[];
}

export class ChubError extends Error {}
export class ChubHttpError extends ChubError {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const messages: Record<number, string> = {
  401: 'C-HUB: 401 トークンが違う・期限切れ・失効済み、または接続先の違い',
  403: 'C-HUB: 403 トークンの権限不足（task-manager:read が必要）',
  404: 'C-HUB: 404 対象が見つからない',
  429: 'C-HUB: 429 回数上限に達しました（再試行後も解消せず）',
};

/** Default transport: Node's fetch, GET only, no redirects (the token must not follow a redirect), 30 s timeout. */
export const fetchTransport: Transport = async request => {
  if (request.method !== 'GET') throw new ChubError('C-HUB への書き込みは許可されていません。');
  let response: Response;
  try {
    response = await fetch(request.url, {method: 'GET', headers: request.headers, redirect: 'manual',
      signal: AbortSignal.timeout(30_000)});
  } catch (error) {
    // The cause may contain the URL; report only the error code.
    const cause = (error as {cause?: {code?: unknown}}).cause;
    const code = typeof cause?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(cause.code) ? cause.code :
      (error as {name?: unknown}).name === 'TimeoutError' ? 'TIMEOUT' : 'UNKNOWN';
    throw new ChubError('C-HUB に接続できません（' + code + '）');
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    return {status: response.status, body: ''};
  }
  return {status: response.status, body: await readLimited(response)};
};

/** Largest response body read from C-HUB. A board's task list is far smaller; anything larger is refused unread. */
export const maxResponseBytes = 20 * 1024 * 1024;

/** Reads the body up to maxResponseBytes and stops reading as soon as the limit is passed. */
async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  const tooLarge = () => new ChubError('C-HUB の応答が大きすぎます（' + maxResponseBytes / 1024 / 1024 + ' MiB を超えました）。');
  if (declared > maxResponseBytes) {
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
      if (total > maxResponseBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ChubError) throw error;
    throw new ChubError('C-HUB の応答を読み取れませんでした。');
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export interface ChubProject {id: string; title: string; archived: boolean}
export interface ChubSection {id: string; name: string}
export type ChubTask = Record<string, unknown> & {id: string};

const base = '/api/plugin/task-manager';
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;

function checkId(value: string, label: string): string {
  if (!idPattern.test(value)) throw new ChubError(label + ' の形式が不正です。');
  return encodeURIComponent(value);
}

/** archived arrives as 0/1 or "0"/"1"; the string "0" is truthy, so compare the text. */
export function isArchived(value: unknown): boolean {
  return ['1', 'true'].includes(String(value ?? 0).trim().toLowerCase());
}

function data(json: unknown): Record<string, unknown> {
  const value = (json as {data?: unknown} | null)?.data;
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}
function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(item => typeof item === 'object' && item !== null) : [];
}

export interface ChubClientOptions {
  baseUrl: string;
  token: string;
  transport?: Transport;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
}

export type ChubClient = ReturnType<typeof createChubClient>;

export function createChubClient(options: ChubClientOptions) {
  const root = options.baseUrl.replace(/\/+$/, '');
  const transport = options.transport ?? fetchTransport;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const interval = options.intervalMs ?? 500;
  let first = true;

  async function get(path: string, query?: Record<string, string>): Promise<unknown> {
    const url = root + path + (query ? '?' + new URLSearchParams(query).toString() : '');
    const request: HttpRequest = {method: 'GET', url,
      headers: {Authorization: 'Bearer ' + options.token, Accept: 'application/json'}};
    if (!first) await sleep(interval);
    first = false;
    let response = await transport(request);
    if (response.status === 429) {
      await sleep(60_000);
      response = await transport(request);
    }
    if (response.status !== 200) {
      throw new ChubHttpError(response.status, messages[response.status] ?? 'C-HUB: HTTP ' + response.status);
    }
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      throw new ChubError('C-HUB のレスポンスが JSON ではありません。');
    }
  }

  return Object.freeze({
    async listProjects(): Promise<ChubProject[]> {
      return list(data(await get(base + '/projects')).projects).map(project => ({
        id: String(project.id), title: String(project.title ?? ''), archived: isArchived(project.archived)}));
    },
    // Sections come with the project detail (OpenAPI: GET /projects/{projectId} returns data.sections).
    async listSections(projectId: string): Promise<ChubSection[]> {
      const path = base + '/projects/' + checkId(projectId, 'プロジェクトID');
      return list(data(await get(path)).sections).map(section => ({id: String(section.id), name: String(section.name ?? '')}));
    },
    async listTasks(projectId: string, showCompleted = false): Promise<ChubTask[]> {
      const path = base + '/projects/' + checkId(projectId, 'プロジェクトID') + '/tasks';
      const tasks = list(data(await get(path, showCompleted ? {show_completed: 'true'} : undefined)).tasks);
      return tasks.map(task => ({...task, id: String(task.id)}));
    },
    async getTask(taskId: string): Promise<ChubTask> {
      const task = data(await get(base + '/tasks/' + checkId(taskId, 'タスクID'))).task;
      if (typeof task !== 'object' || task === null) throw new ChubError('C-HUB のタスクの形式が想定と違います。');
      return {...task as Record<string, unknown>, id: String((task as {id?: unknown}).id)};
    },
  });
}

/** Finds the non-archived project whose ID (tp-...) or exact title is `board`. An ID match wins over a title. */
export async function findBoard(client: ChubClient, board: string): Promise<ChubProject | undefined> {
  const projects = (await client.listProjects()).filter(project => !project.archived);
  return projects.find(project => project.id === board) ?? projects.find(project => project.title === board);
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.trim())) {
    throw new ChubError('設定の ' + label + ' は文字列の配列にしてください。');
  }
  return value.map(item => item.trim());
}

/**
 * Reads the configuration file (optional) and the environment. CHUB_BASE_URL and CHUB_TOKEN take precedence.
 * Error messages never include the token, the URL or the file contents.
 */
export function loadChubConfig(file: string | undefined, env: NodeJS.ProcessEnv = process.env): ChubConfig {
  let raw: Record<string, unknown> = {};
  if (file) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      throw new ChubError('設定ファイルを読めません。');
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
      raw = parsed as Record<string, unknown>;
    } catch {
      throw new ChubError('設定ファイルの JSON が壊れているか、形式が違います。');
    }
  }
  const chub = (typeof raw.chub === 'object' && raw.chub !== null ? raw.chub : {}) as Record<string, unknown>;
  const baseUrl = String(env.CHUB_BASE_URL || chub.baseUrl || '').trim().replace(/\/+$/, '');
  const token = String(env.CHUB_TOKEN || chub.token || '').trim();
  if (!token) throw new ChubError('C-HUB のトークンがありません（環境変数 CHUB_TOKEN または設定の chub.token）。');
  if (/\s/.test(token)) throw new ChubError('C-HUB のトークンに空白が含まれています。');
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ChubError('C-HUB の接続先がありません、または URL の形式が違います（CHUB_BASE_URL または chub.baseUrl）。');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ChubError('C-HUB の接続先は https:// で始まり、認証情報やクエリを含まない URL にしてください。');
  }
  const sections = (typeof raw.sections === 'object' && raw.sections !== null ? raw.sections : {}) as Record<string, unknown>;
  const name = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return {
    baseUrl,
    token,
    boards: raw.boards === undefined ? [] : strings(raw.boards, 'boards'),
    sections: {
      ready: name(sections.ready, 'AI実装待ち'),
      running: name(sections.running, 'AI実行中'),
      needsHuman: name(sections.needsHuman, '人の確認待ち'),
    },
    allowedRepositories: raw.allowedRepositories === undefined ? [] : strings(raw.allowedRepositories, 'allowedRepositories'),
  };
}

/** Removes every occurrence of the secrets from text that is about to be printed. */
export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  return out;
}
