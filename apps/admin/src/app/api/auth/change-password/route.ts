import { NextResponse } from 'next/server';
import {
  apiUrl,
  clearSessionCookies,
  readSessionCookies,
  refreshTokens,
  setSessionCookies,
} from '@/lib/server/session';
import { csrfOk } from '@/lib/server/proxy-rules';

export const dynamic = 'force-dynamic';

/** Dedicated route: the API answers with a fresh token pair that must go into cookies, not to the browser JS. */
export async function POST(req: Request) {
  if (!csrfOk('POST', req.headers)) return NextResponse.json({ code: 'CSRF' }, { status: 403 });
  const session = await readSessionCookies();
  let access = session.access;
  const refresh = session.refresh;
  if (!access && refresh) {
    const pair = await refreshTokens(refresh);
    if (pair) {
      access = pair.accessToken;
      await setSessionCookies(pair);
    }
  }
  if (!access) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  const res = await fetch(apiUrl('auth/change-password'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
    body: await req.text(),
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return NextResponse.json({ code: 'UPSTREAM_DOWN' }, { status: 502 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data?.code !== 'INVALID_CREDENTIALS') await clearSessionCookies();
    return NextResponse.json(data, { status: res.status });
  }
  await setSessionCookies(data);
  return NextResponse.json({ ok: true });
}
