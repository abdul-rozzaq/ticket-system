import { describe, expect, it } from 'vitest';
import { ApiClient } from '../src/api-client';
import { ChatRateLimiter } from '../src/util';

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
    logger: { info() {}, warn() {}, error() {} },
    retries,
  });

describe('ApiClient (bot)', () => {
  it('uses /internal/bot/* with the service token and maps arguments', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const api = make(async (url, init) => {
      seen.push({ url, init });
      return json(200, { answer: 'ok', alert: false, edit: null });
    });
    await api.callback('1001', 'k:5');
    expect(seen[0].url).toBe('http://api.test/api/v1/internal/bot/callbacks');
    expect(JSON.parse(seen[0].init.body as string)).toEqual({ telegramUserId: '1001', data: 'k:5' });
    expect((seen[0].init.headers as Record<string, string>)['x-service-token']).toBe('tok-1234567890123456');
  });

  it('retries 5xx and network errors, never 4xx', async () => {
    let n = 0;
    const api = make(async () => {
      n++;
      if (n === 1) return json(502);
      if (n === 2) throw new TypeError('fetch failed');
      return json(200, []);
    });
    expect(await api.outbox(5)).toEqual([]);
    expect(n).toBe(3);
    let m = 0;
    await expect(make(async () => (m++, json(401))).config()).rejects.toMatchObject({ status: 401 });
    expect(m).toBe(1);
  });

  it('long-polls the outbox and posts results', async () => {
    const urls: string[] = [];
    const api = make(
      async (url) => (
        urls.push(url),
        url.includes('/outbox?') ? json(200, [{ id: 'x', kind: 'SEND_TEXT', payload: {} }]) : json(204)
      ),
    );
    expect((await api.outbox(20))[0].id).toBe('x');
    expect(urls[0]).toContain('/outbox?wait=20');
    await expect(api.outboxResult('x', { ok: true, result: { messageId: '1' } })).resolves.toBeUndefined();
  });
});

describe('ChatRateLimiter', () => {
  it('uses the group gap for negative chat ids and the private gap for users', async () => {
    const sleeps: number[] = [];
    const lim = new ChatRateLimiter(
      { global: 0, group: 3000, private: 1000 },
      async (ms) => void sleeps.push(ms),
    );
    await lim.run('-100500', async () => 1);
    await lim.run('-100500', async () => 2);
    await lim.run('42', async () => 3);
    await lim.run('42', async () => 4);
    expect(sleeps.some((s) => s > 1000 && s <= 3000)).toBe(true); // group gap applied
    expect(sleeps.some((s) => s > 0 && s <= 1000)).toBe(true); // private gap applied
  });
});
