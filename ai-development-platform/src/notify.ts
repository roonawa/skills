import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Notifications to the key owner's buddy in C-HUB (docs/autonomous-runner-design.md 4): `sugar-forum:digest`,
 * POST /api/plugin/sugar-forum/digest, at most 5 a day. It reaches only the key owner's own buddy.
 *
 * Unconfirmed (design 8): the request body. The public documents give `{ content }` (up to 4000 characters) for the
 * sibling endpoint digest/work-status only; the same shape is assumed here and kept in digestBody() alone.
 * The transport can send one request: POST to that path. The C-HUB reading client stays GET only.
 */
export const digestPath = '/api/plugin/sugar-forum/digest';
export const maxDigestChars = 4000;
export const dailyLimit = 5;

export class NotifyError extends Error {}

export interface DigestRequest {method: 'POST'; url: string; headers: Record<string, string>; body: string}
export type DigestTransport = (request: DigestRequest) => Promise<{status: number}>;

/** Default transport: fetch, POST to the digest path only, no redirects (the token must not follow one), 30 s. */
export const fetchDigestTransport: DigestTransport = async request => {
  if (request.method !== 'POST' || new URL(request.url).pathname !== digestPath) {
    throw new NotifyError('通知の送り先以外には送りません。');
  }
  let response: Response;
  try {
    response = await fetch(request.url, {method: 'POST', headers: request.headers, body: request.body, redirect: 'manual',
      signal: AbortSignal.timeout(30_000)});
  } catch (error) {
    const cause = (error as {cause?: {code?: unknown}}).cause;
    const code = typeof cause?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(cause.code) ? cause.code :
      (error as {name?: unknown}).name === 'TimeoutError' ? 'TIMEOUT' : 'UNKNOWN';
    throw new NotifyError('C-HUB に接続できません（' + code + '）');
  }
  // The reply is not needed: success is read from the status only.
  await response.body?.cancel();
  return {status: response.status};
};

/** The assumed request body (see above). */
export function digestBody(content: string): string {
  return JSON.stringify({content});
}

const statusMessages: Record<number, string> = {
  400: '通知: 400 送った内容の形が受け付けられませんでした（送る形式が未確認。設計書8章）',
  401: '通知: 401 トークンが違う・期限切れ・失効済み',
  403: '通知: 403 キーに sugar-forum:digest の権限がありません',
  404: '通知: 404 送り先が見つかりません（権限が無い場合も 404 になります）',
  429: '通知: 429 回数の上限に達しました',
};

/** Japan time calendar day; the limit of 5 a day is counted per day there. */
export const japanDay = (date: Date) => new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

interface NotifyState {day: string; sent: number; pending: string[]}

export interface DigestNotifierOptions {
  baseUrl: string;
  token: string;
  /** Directory for the counter and the messages waiting for the next day (the runner's stateDir). */
  stateDir: string;
  transport?: DigestTransport;
  now?: () => Date;
}

/**
 * Sends the messages of one runner start as one notification. The first 4 of a day go out as they come; the 5th
 * also says that later results come the next day; after that, messages wait in the state file and go out with the
 * first notification of the next day. A failed send keeps its messages for the next start.
 */
export function createDigestNotifier(options: DigestNotifierOptions) {
  const transport = options.transport ?? fetchDigestTransport;
  const now = options.now ?? (() => new Date());
  const file = join(options.stateDir, 'notify.json');
  const url = options.baseUrl.replace(/\/+$/, '') + digestPath;
  const read = (): NotifyState => {
    try {
      const state = JSON.parse(readFileSync(file, 'utf8')) as NotifyState;
      if (typeof state.day === 'string' && Number.isInteger(state.sent) && Array.isArray(state.pending)) {
        return {day: state.day, sent: state.sent, pending: state.pending.filter(item => typeof item === 'string')};
      }
    } catch {
      // A missing or damaged counter starts over. Over-sending is limited by the server's own limit.
    }
    return {day: '', sent: 0, pending: []};
  };
  const write = (state: NotifyState) => {
    mkdirSync(options.stateDir, {recursive: true});
    writeFileSync(file + '.pending', JSON.stringify(state, null, 2) + '\n', {flush: true});
    renameSync(file + '.pending', file);
  };
  return {
    /** Messages waiting for a later notification (for the report). */
    pending(): string[] {
      return existsSync(file) ? read().pending : [];
    },
    async notify(messages: string[]): Promise<{sent: boolean; waiting: number}> {
      const today = japanDay(now());
      const state = read();
      if (state.day !== today) Object.assign(state, {day: today, sent: 0});
      state.pending.push(...messages);
      if (!state.pending.length || state.sent >= dailyLimit) {
        write(state);
        return {sent: false, waiting: state.pending.length};
      }
      const last = state.sent === dailyLimit - 1;
      const footer = last ? '（本日の通知はこれが最後です。以降の結果は翌日の最初の通知にまとめます。結果は Gitea の PR でも確認できます）' : '';
      // As many whole messages as fit; the rest waits. A single message longer than the limit is cut.
      const lines: string[] = [];
      let length = footer.length;
      while (state.pending.length) {
        const next = state.pending[0].slice(0, maxDigestChars - footer.length - 1);
        if (lines.length && length + next.length + 1 > maxDigestChars) break;
        lines.push(next);
        length += next.length + 1;
        state.pending.shift();
      }
      const content = [...lines, ...(footer ? [footer] : [])].join('\n');
      let status: number;
      try {
        ({status} = await transport({method: 'POST', url, body: digestBody(content),
          headers: {Authorization: 'Bearer ' + options.token, 'Content-Type': 'application/json', Accept: 'application/json'}}));
      } catch (error) {
        state.pending.unshift(...lines);
        write(state);
        throw error instanceof NotifyError ? error : new NotifyError('通知を送れませんでした。');
      }
      if (status < 200 || status > 299) {
        state.pending.unshift(...lines);
        write(state);
        throw new NotifyError(statusMessages[status] ?? '通知: HTTP ' + status);
      }
      state.sent += 1;
      write(state);
      return {sent: true, waiting: state.pending.length};
    },
  };
}
