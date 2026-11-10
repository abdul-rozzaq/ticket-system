import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError } from '../src/api-client';
import type { Logger } from '../src/ports';

const logger: Logger = { info() {}, warn() {}, error() {} };
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const make = (f: (url: string, init: RequestInit) => Promise<Response>, retries = 2) =>
  new ApiClient({
    baseUrl: 'http://api.test/',
    serviceToken: 'tok-1234567890123456',
    fetchImpl: f as unknown as typeof fetch,
    sleep: async () => undefined,
    logger,
    retries,
  });

describe('ApiClient', () => {
  it('sends the service token and hits /api/v1/internal/userbot/*', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const api = make(async (url, init) => {
      seen = { url, init };
      return json(200, { action: 'buffered' });
    });
    await api.message({
      chatId: 'c:1',
      messageId: '5',
      senderId: null,
      senderName: null,
      text: 'x',
      outgoing: false,
      replyToMessageId: null,
      date: new Date().toISOString(),
      hasMedia: false,
    });
    expect(seen!.url).toBe('http://api.test/api/v1/internal/userbot/messages');
    expect((seen!.init.headers as Record<string, string>)['x-service-token']).toBe('tok-1234567890123456');
    expect(seen!.init.method).toBe('POST');
  });

  it('retries 5xx / 429 / network errors with backoff, then succeeds', async () => {
    let n = 0;
    const api = make(async () => {
      n++;
      if (n === 1) return json(503);
      if (n === 2) throw new TypeError('fetch failed');
      return json(200, { session: 'S' });
    });
    expect(await api.getSession()).toBe('S');
    expect(n).toBe(3);
  });

  it('does not retry 4xx (a bad payload or token cannot fix itself)', async () => {
    let n = 0;
    const api = make(async () => {
      n++;
      return json(400, { code: 'VALIDATION' });
    });
    await expect(
      api.reaction({ chatId: 'x', messageId: '1', emoji: '✅', byMe: true }),
    ).rejects.toMatchObject({ status: 400, retryable: false });
    expect(n).toBe(1);
  });

  it('gives up after the retry budget with a retryable error', async () => {
    let n = 0;
    const api = make(async () => {
      n++;
      return json(500);
    }, 2);
    await expect(api.status('CONNECTED')).rejects.toBeInstanceOf(ApiError);
    expect(n).toBe(3);
  });

  it('long-polls with a client timeout longer than the server wait, and handles 204', async () => {
    const urls: string[] = [];
    const api = make(async (url) => {
      urls.push(url);
      return url.includes('/commands?') ? json(200, [{ id: 'c1', type: 'LOGOUT', payload: {} }]) : json(204);
    });
    expect(await api.commands(20)).toEqual([{ id: 'c1', type: 'LOGOUT', payload: {} }]);
    expect(urls[0]).toContain('/commands?wait=20');
    await expect(api.result('c1', { ok: true })).resolves.toBeUndefined();
  });

  it('error messages never contain the token or request bodies', async () => {
    const api = make(async () => json(400), 0);
    const err = await api
      .message({
        chatId: 'c:1',
        messageId: '1',
        senderId: null,
        senderName: null,
        text: 'TOP SECRET BODY',
        outgoing: false,
        replyToMessageId: null,
        date: new Date().toISOString(),
        hasMedia: false,
      })
      .catch((e) => e as Error);
    expect(String((err as Error).message)).not.toContain('TOP SECRET');
    expect(String((err as Error).message)).not.toContain('tok-123');
  });
});
