import 'server-only';
import { cookies } from 'next/headers';
import {
  ACCESS_COOKIE,
  API_PREFIX,
  API_URL,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE,
  SECURE_COOKIES,
} from './config';
import { SingleFlight } from '../single-flight';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const refreshFlight = new SingleFlight<TokenPair | null>();

export const apiUrl = (path: string) => `${API_URL}${API_PREFIX}/${path.replace(/^\//, '')}`;

/** Rotates the refresh token once even when many parallel requests carry the same one. */
export function refreshTokens(refreshToken: string, ip?: string | null): Promise<TokenPair | null> {
  return refreshFlight.run(refreshToken, async () => {
    const res = await fetch(apiUrl('auth/refresh'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => null);
    if (!res || !res.ok) return null;
    return (await res.json()) as TokenPair;
  });
}

export async function setSessionCookies(pair: TokenPair) {
  const jar = await cookies();
  const base = { httpOnly: true, sameSite: 'strict' as const, secure: SECURE_COOKIES, path: '/' };
  jar.set(ACCESS_COOKIE, pair.accessToken, { ...base, maxAge: Math.max(60, pair.expiresIn) });
  jar.set(REFRESH_COOKIE, pair.refreshToken, { ...base, maxAge: REFRESH_COOKIE_MAX_AGE });
}

export async function clearSessionCookies() {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

export async function readSessionCookies() {
  const jar = await cookies();
  return { access: jar.get(ACCESS_COOKIE)?.value, refresh: jar.get(REFRESH_COOKIE)?.value };
}
