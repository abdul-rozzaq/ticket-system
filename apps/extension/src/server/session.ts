// Connection to the TP ticket server. Runs in the background service worker only: panels and content scripts never
// call the API themselves, they ask the background (TP_API) so tokens stay in one place. Pure logic with injected
// dependencies (fetch, storage, clock) so it can be unit-tested without Chrome.

export interface ServerUser {
  id: string;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'STAFF';
  mustChangePassword: boolean;
}

export interface ServerSession {
  baseUrl: string;
  accessToken: string;
  refreshToken: string;
  /** epoch ms when the access token stops being valid (a minute of safety margin already subtracted) */
  accessExpiresAt: number;
  user: ServerUser;
}

export interface Deps {
  fetch: typeof fetch;
  load(): Promise<ServerSession | null>;
  save(s: ServerSession | null): Promise<void>;
  now(): number;
}

export type ApiResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string; error: string };

export type LoginResult = { ok: true; user: ServerUser } | { ok: false; code: string; error: string };

/** Public state for UIs: never contains tokens. */
export interface ServerStatus {
  connected: boolean;
  baseUrl: string | null;
  user: ServerUser | null;
}

/** chrome.storage.local key of the stored session (readable by extension contexts, never by page scripts). */
export const SERVER_KEY = 'tp_server';
export const API_PREFIX = '/api/v1';
const SAFETY_MS = 60_000;

/** "https://tp.example.com/" -> "https://tp.example.com"; null when it is not an http(s) URL. */
export function normalizeBaseUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export class ServerClient {
  private refreshing: Promise<ServerSession | null> | null = null;

  constructor(private readonly deps: Deps) {}

  async status(): Promise<ServerStatus> {
    const s = await this.deps.load();
    return s ? { connected: true, baseUrl: s.baseUrl, user: s.user } : { connected: false, baseUrl: null, user: null };
  }

  async login(baseUrlInput: string, username: string, password: string): Promise<LoginResult> {
    const baseUrl = normalizeBaseUrl(baseUrlInput);
    if (!baseUrl) return { ok: false, code: 'BAD_URL', error: "Server manzili noto'g'ri (https://… kerak)" };
    let res: Response;
    try {
      res = await this.deps.fetch(`${baseUrl}${API_PREFIX}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch {
      return { ok: false, code: 'NETWORK', error: 'Serverga ulanib bo‘lmadi' };
    }
    const data = (await res.json().catch(() => ({}))) as {
      user?: ServerUser;
      accessToken?: string;
      refreshToken?: string;
      expiresIn?: number;
      code?: string;
      message?: string;
    };
    if (!res.ok || !data.user || !data.accessToken || !data.refreshToken) {
      return { ok: false, code: data.code ?? `HTTP_${res.status}`, error: data.message ?? `Xato (${res.status})` };
    }
    if (data.user.mustChangePassword) {
      // The extension has no password-change screen; the API would reject every other call anyway.
      return { ok: false, code: 'MUST_CHANGE_PASSWORD', error: "Avval admin panelda parolni o'zgartiring, so'ng qayta kiring" };
    }
    await this.deps.save({
      baseUrl,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accessExpiresAt: this.deps.now() + (data.expiresIn ?? 900) * 1000 - SAFETY_MS,
      user: data.user,
    });
    return { ok: true, user: data.user };
  }

  /** A valid access token for the realtime handshake (refreshing when needed), or null when logged out / offline. */
  async accessForRealtime(): Promise<{ baseUrl: string; token: string } | null> {
    let s = await this.deps.load();
    if (!s) return null;
    if (this.deps.now() >= s.accessExpiresAt) {
      s = await this.refresh(s);
      if (!s || this.deps.now() >= s.accessExpiresAt) return null;
    }
    return { baseUrl: s.baseUrl, token: s.accessToken };
  }

  async logout(): Promise<void> {
    const s = await this.deps.load();
    await this.deps.save(null); // local state first: logging out must work offline
    if (!s) return;
    try {
      await this.deps.fetch(`${s.baseUrl}${API_PREFIX}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: s.refreshToken }),
      });
    } catch {
      /* best effort: the refresh token also expires on its own */
    }
  }

  /** Rotates the refresh token once even when several requests notice the expiry at the same time. */
  private refresh(old: ServerSession): Promise<ServerSession | null> {
    if (this.refreshing) return this.refreshing;
    const p = (async () => {
      try {
        const res = await this.deps.fetch(`${old.baseUrl}${API_PREFIX}/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: old.refreshToken }),
        });
        if (res.status === 401 || res.status === 403) {
          await this.deps.save(null); // revoked / deactivated / reuse detected: back to the login screen
          return null;
        }
        if (!res.ok) return old; // server trouble: keep the session, the caller will see the failure
        const t = (await res.json()) as { accessToken: string; refreshToken: string; expiresIn: number };
        const next: ServerSession = {
          ...old,
          accessToken: t.accessToken,
          refreshToken: t.refreshToken,
          accessExpiresAt: this.deps.now() + t.expiresIn * 1000 - SAFETY_MS,
        };
        await this.deps.save(next);
        return next;
      } catch {
        return old; // offline
      } finally {
        this.refreshing = null;
      }
    })();
    this.refreshing = p;
    return p;
  }

  async request<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
    let s = await this.deps.load();
    if (!s) return { ok: false, status: 401, code: 'NOT_CONNECTED', error: 'Serverga ulanmagan' };
    if (this.deps.now() >= s.accessExpiresAt) {
      s = await this.refresh(s);
      if (!s) return { ok: false, status: 401, code: 'SESSION_EXPIRED', error: 'Sessiya tugadi, qayta kiring' };
    }
    const call = async (token: string) => {
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (init.body !== undefined) headers['content-type'] = 'application/json';
      return this.deps.fetch(`${s!.baseUrl}${API_PREFIX}/${path.replace(/^\//, '')}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    };
    let res: Response;
    try {
      res = await call(s.accessToken);
      if (res.status === 401) {
        // the server rejected a token we believed valid (revoked, clock skew): rotate once and retry
        const again = await this.refresh(s);
        if (!again) return { ok: false, status: 401, code: 'SESSION_EXPIRED', error: 'Sessiya tugadi, qayta kiring' };
        s = again;
        res = await call(s.accessToken);
      }
    } catch {
      return { ok: false, status: 0, code: 'NETWORK', error: 'Serverga ulanib bo‘lmadi' };
    }
    if (res.status === 204) return { ok: true, status: 204, data: undefined as T };
    const data = (await res.json().catch(() => ({}))) as T & { code?: string; message?: string };
    if (!res.ok) {
      const d = data as { code?: string; message?: string };
      return { ok: false, status: res.status, code: d.code ?? `HTTP_${res.status}`, error: d.message ?? `Xato (${res.status})` };
    }
    return { ok: true, status: res.status, data };
  }
}

/** Throttle for the "I am sending in this chat" ping: at most one per chat every `ms`. */
export function createPingThrottle(ms = 5000, now: () => number = Date.now) {
  const last = new Map<string, number>();
  return (chatId: string): boolean => {
    const t = now();
    const prev = last.get(chatId);
    if (prev !== undefined && t - prev < ms) return false;
    last.set(chatId, t);
    if (last.size > 200) for (const [k, v] of last) if (t - v > ms) last.delete(k);
    return true;
  };
}
