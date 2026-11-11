import { describe, expect, it } from 'vitest';
import { createPingThrottle, normalizeBaseUrl, ServerClient, type Deps, type ServerSession } from '../src/server/session';

const user = { id: 'u1', username: 'ali', displayName: 'Ali', role: 'STAFF' as const, mustChangePassword: false };
const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status });

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>, session: ServerSession | null = null) {
  let stored = session;
  let clock = 1_000_000;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const deps: Deps = {
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }) as typeof fetch,
    load: async () => stored,
    save: async (s) => {
      stored = s;
    },
    now: () => clock,
  };
  return { client: new ServerClient(deps), calls, get stored() { return stored; }, tick: (ms: number) => (clock += ms) };
}

const sess = (over: Partial<ServerSession> = {}): ServerSession => ({
  baseUrl: 'https://tp.test',
  accessToken: 'a1',
  refreshToken: 'r1',
  accessExpiresAt: 2_000_000,
  user,
  ...over,
});

describe('normalizeBaseUrl', () => {
  it('accepts http(s), strips trailing slashes, rejects the rest', () => {
    expect(normalizeBaseUrl(' https://tp.example.com/ ')).toBe('https://tp.example.com');
    expect(normalizeBaseUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeBaseUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeBaseUrl('ftp://x')).toBeNull();
    expect(normalizeBaseUrl('not a url')).toBeNull();
  });
});

describe('ServerClient.login', () => {
  it('stores the session and exposes only public status', async () => {
    const t = setup(() => json(200, { user, accessToken: 'A', refreshToken: 'R', expiresIn: 900 }));
    const r = await t.client.login('https://tp.test/', 'ali', 'pw');
    expect(r.ok).toBe(true);
    expect(t.calls[0].url).toBe('https://tp.test/api/v1/auth/login');
    expect(t.stored?.refreshToken).toBe('R');
    const st = await t.client.status();
    expect(st).toEqual({ connected: true, baseUrl: 'https://tp.test', user });
    expect(JSON.stringify(st)).not.toContain('R"');
  });

  it('does not keep a session when the password must be changed first', async () => {
    const t = setup(() => json(200, { user: { ...user, mustChangePassword: true }, accessToken: 'A', refreshToken: 'R', expiresIn: 900 }));
    const r = await t.client.login('https://tp.test', 'ali', 'pw');
    expect(r).toMatchObject({ ok: false, code: 'MUST_CHANGE_PASSWORD' });
    expect(t.stored).toBeNull();
  });

  it('reports wrong credentials, bad urls and network failures', async () => {
    expect(await setup(() => json(401, { code: 'INVALID_CREDENTIALS', message: 'xato' })).client.login('https://tp.test', 'a', 'b')).toMatchObject({ ok: false, code: 'INVALID_CREDENTIALS' });
    expect(await setup(() => json(200, {})).client.login('nope', 'a', 'b')).toMatchObject({ code: 'BAD_URL' });
    expect(
      await setup(() => {
        throw new Error('offline');
      }).client.login('https://tp.test', 'a', 'b'),
    ).toMatchObject({ code: 'NETWORK' });
  });
});

describe('ServerClient.request', () => {
  it('sends the bearer token and parses json / 204', async () => {
    const t = setup((url) => (url.endsWith('/x') ? json(200, { n: 1 }) : json(204, null)), sess());
    expect(await t.client.request('x')).toEqual({ ok: true, status: 200, data: { n: 1 } });
    expect((t.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer a1');
    expect(await t.client.request('y', { method: 'POST', body: { a: 1 } })).toMatchObject({ ok: true, status: 204 });
    expect(t.calls[1].init.body).toBe('{"a":1}');
  });

  it('refuses when not connected', async () => {
    expect(await setup(() => json(200, {})).client.request('x')).toMatchObject({ ok: false, code: 'NOT_CONNECTED' });
  });

  it('surfaces API errors with their code', async () => {
    const t = setup(() => json(409, { code: 'ALREADY_TAKEN', message: 'Boshqa xodim oldi' }), sess());
    expect(await t.client.request('tickets/1/take', { method: 'POST' })).toEqual({ ok: false, status: 409, code: 'ALREADY_TAKEN', error: 'Boshqa xodim oldi' });
  });

  it('rotates the refresh token ONCE for concurrent requests after expiry', async () => {
    let refreshCalls = 0;
    const t = setup((url) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls++;
        return json(200, { accessToken: 'a2', refreshToken: 'r2', expiresIn: 900 });
      }
      return json(200, { ok: 1 });
    }, sess({ accessExpiresAt: 1_500_000 }));
    t.tick(600_000); // now 1_600_000 > expiry
    const rs = await Promise.all([t.client.request('a'), t.client.request('b'), t.client.request('c')]);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(refreshCalls).toBe(1);
    expect(t.stored?.refreshToken).toBe('r2');
    const used = t.calls.filter((c) => !c.url.endsWith('/auth/refresh')).map((c) => (c.init.headers as Record<string, string>).authorization);
    expect(used).toEqual(['Bearer a2', 'Bearer a2', 'Bearer a2']);
  });

  it('retries once after a 401 with a fresh token', async () => {
    let n = 0;
    const t = setup((url) => {
      if (url.endsWith('/auth/refresh')) return json(200, { accessToken: 'a2', refreshToken: 'r2', expiresIn: 900 });
      return ++n === 1 ? json(401, { code: 'UNAUTHORIZED' }) : json(200, { ok: 1 });
    }, sess());
    expect(await t.client.request('x')).toMatchObject({ ok: true });
    expect(t.stored?.accessToken).toBe('a2');
  });

  it('drops the session when the refresh token is rejected', async () => {
    const t = setup((url) => (url.endsWith('/auth/refresh') ? json(401, { code: 'UNAUTHORIZED' }) : json(401, {})), sess());
    expect(await t.client.request('x')).toMatchObject({ ok: false, code: 'SESSION_EXPIRED' });
    expect(t.stored).toBeNull();
  });

  it('keeps the session when the server is merely unreachable', async () => {
    const t = setup(() => {
      throw new Error('offline');
    }, sess());
    expect(await t.client.request('x')).toMatchObject({ ok: false, code: 'NETWORK' });
    expect(t.stored).not.toBeNull();
  });
});

describe('ServerClient.logout', () => {
  it('clears local state even when the server is unreachable', async () => {
    const t = setup(() => {
      throw new Error('offline');
    }, sess());
    await t.client.logout();
    expect(t.stored).toBeNull();
  });
});

describe('ping throttle', () => {
  it('allows one ping per chat per window', () => {
    let now = 0;
    const ok = createPingThrottle(5000, () => now);
    expect(ok('c1')).toBe(true);
    expect(ok('c1')).toBe(false);
    expect(ok('c2')).toBe(true);
    now = 5001;
    expect(ok('c1')).toBe(true);
  });
});

describe('small helpers', () => {
  it('bareMessageId extracts the numeric Telegram id', async () => {
    const { bareMessageId } = await import('../src/server/util');
    expect(bareMessageId('message12345')).toBe('12345');
    expect(bareMessageId('987')).toBe('987');
    expect(bareMessageId(null)).toBeUndefined();
    expect(bareMessageId('abc')).toBeUndefined();
  });

  it('isSendKey: plain Enter only', async () => {
    const { isSendKey } = await import('../src/content/activity');
    expect(isSendKey({ key: 'Enter', shiftKey: false })).toBe(true);
    expect(isSendKey({ key: 'Enter', shiftKey: true })).toBe(false);
    expect(isSendKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
    expect(isSendKey({ key: 'a', shiftKey: false })).toBe(false);
  });

  it('toLocalTemplate picks the Russian body only for Russian groups that have one', async () => {
    const { toLocalTemplate } = await import('../src/ui/tabs/ServerTemplatesTab');
    const t = { id: '1', category: 'x', title: 'T', bodyUz: 'uz', bodyRu: 'ru', keywords: [], usageCount: 0 };
    expect(toLocalTemplate(t, 'uz').body).toBe('uz');
    expect(toLocalTemplate(t, 'ru').body).toBe('ru');
    expect(toLocalTemplate({ ...t, bodyRu: null }, 'ru').body).toBe('uz');
  });
});
