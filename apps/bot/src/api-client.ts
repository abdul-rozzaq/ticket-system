import type { BotApiPort, CallbackResult, IncomingCommand, Logger, OutboxItem, Keyboard } from './ports';
import { backoffMs, realSleep, type Sleep } from './util';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  serviceToken: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  sleep?: Sleep;
  retries?: number;
}

/** HTTP client for /api/v1/internal/bot/* (service-token auth) with timeouts and retry/backoff on transient failures. */
export class ApiClient implements BotApiPort {
  private readonly f: typeof fetch;
  private readonly sleep: Sleep;
  private readonly retries: number;

  constructor(private readonly o: ApiClientOptions) {
    this.f = o.fetchImpl ?? fetch;
    this.sleep = o.sleep ?? realSleep;
    this.retries = o.retries ?? 3;
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.f(`${this.o.baseUrl.replace(/\/+$/, '')}/api/v1/internal/bot${path}`, {
          method,
          headers: { 'content-type': 'application/json', 'x-service-token': this.o.serviceToken },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
        const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
        const err = new ApiError(`${method} ${path} -> ${res.status}`, res.status, retryable);
        if (!retryable) throw err;
        last = err;
      } catch (e) {
        if (e instanceof ApiError && !e.retryable) throw e;
        last =
          e instanceof ApiError
            ? e
            : new ApiError(`${method} ${path} failed: ${(e as Error).name}`, undefined, true);
      }
      if (attempt < this.retries) await this.sleep(backoffMs(attempt));
    }
    this.o.logger.warn('api call failed after retries', { method, path });
    throw last;
  }

  config() {
    return this.call<{ token: string | null; internalChatId: string | null }>('GET', '/config');
  }
  /** Long poll: the server holds the request for up to `waitSeconds` (max 25). */
  outbox(waitSeconds: number) {
    return this.call<OutboxItem[]>(
      'GET',
      `/outbox?wait=${waitSeconds}`,
      undefined,
      (waitSeconds + 10) * 1000,
    );
  }
  async outboxResult(id: string, r: { ok: boolean; result?: Record<string, unknown>; error?: string }) {
    await this.call('POST', `/outbox/${id}/result`, { ok: r.ok, result: r.result ?? {}, error: r.error });
  }
  callback(fromId: string, data: string) {
    return this.call<CallbackResult>('POST', '/callbacks', { telegramUserId: fromId, data });
  }
  command(c: IncomingCommand) {
    return this.call<{ replies: Array<{ text: string; keyboard?: Keyboard }> | null }>('POST', '/commands', {
      telegramUserId: c.fromId,
      chatType: c.chatType,
      text: c.text,
    });
  }
  async status(state: 'CONNECTED' | 'DISCONNECTED' | 'ERROR', detail?: string) {
    await this.call('POST', '/status', { state, detail });
  }
}
