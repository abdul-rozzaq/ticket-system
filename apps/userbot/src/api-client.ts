import type { ApiCommand, ApiPort, Logger, TgDialog, TgMe, TgMessage, TgReaction } from './ports';
import { backoffMs, realSleep, type Sleep } from './rate-limit';

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
  fetchImpl?: typeof fetch;
  sleep?: Sleep;
  logger: Logger;
  retries?: number;
}

/** HTTP client for the TP API (service-token auth) with timeouts and retry/backoff on transient failures. */
export class ApiClient implements ApiPort {
  private readonly f: typeof fetch;
  private readonly sleep: Sleep;
  private readonly retries: number;

  constructor(private readonly o: ApiClientOptions) {
    this.f = o.fetchImpl ?? fetch;
    this.sleep = o.sleep ?? realSleep;
    this.retries = o.retries ?? 3;
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.f(`${this.o.baseUrl.replace(/\/+$/, '')}/api/v1/internal/userbot${path}`, {
          method,
          headers: { 'content-type': 'application/json', 'x-service-token': this.o.serviceToken },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
        const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
        const err = new ApiError(`${method} ${path} -> ${res.status}`, res.status, retryable);
        if (!retryable) throw err; // 4xx (bad payload, bad token): retrying cannot help
        lastErr = err;
      } catch (e) {
        if (e instanceof ApiError && !e.retryable) throw e;
        lastErr =
          e instanceof ApiError
            ? e
            : new ApiError(`${method} ${path} failed: ${(e as Error).name}`, undefined, true);
      }
      if (attempt < this.retries) await this.sleep(backoffMs(attempt));
    }
    this.o.logger.warn('api call failed after retries', { method, path });
    throw lastErr;
  }

  async getSession(): Promise<string | null> {
    return (await this.call<{ session: string | null }>('GET', '/session')).session;
  }
  async putSession(session: string, phone?: string): Promise<void> {
    await this.call('PUT', '/session', { session, phone });
  }
  async status(
    state: 'CONNECTED' | 'DISCONNECTED' | 'LOGGED_OUT' | 'ERROR',
    detail?: string,
    me?: TgMe,
  ): Promise<void> {
    await this.call('POST', '/status', { state, detail, me });
  }
  async message(m: TgMessage): Promise<void> {
    await this.call('POST', '/messages', m);
  }
  async reaction(r: TgReaction): Promise<void> {
    await this.call('POST', '/reactions', r);
  }
  async dialogs(items: TgDialog[]): Promise<void> {
    await this.call('POST', '/dialogs', { items });
  }
  /** Long poll: the server holds the request for up to `waitSeconds` (max 25). */
  commands(waitSeconds: number): Promise<ApiCommand[]> {
    return this.call<ApiCommand[]>(
      'GET',
      `/commands?wait=${waitSeconds}`,
      undefined,
      (waitSeconds + 10) * 1000,
    );
  }
  async result(
    id: string,
    r: { ok: boolean; result?: Record<string, unknown>; error?: string },
  ): Promise<void> {
    await this.call('POST', `/commands/${id}/result`, { ok: r.ok, result: r.result ?? {}, error: r.error });
  }
}
