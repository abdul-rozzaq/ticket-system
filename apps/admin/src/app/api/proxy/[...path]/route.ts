import { NextResponse } from 'next/server';
import {
  apiUrl,
  clearSessionCookies,
  readSessionCookies,
  refreshTokens,
  setSessionCookies,
} from '@/lib/server/session';
import { csrfOk, safePath } from '@/lib/server/proxy-rules';

export const dynamic = 'force-dynamic';

const PASS_HEADERS = ['content-type', 'content-disposition', 'cache-control'];

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = safePath(path);
  if (!target) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  if (!csrfOk(req.method, req.headers)) return NextResponse.json({ code: 'CSRF' }, { status: 403 });

  let { access, refresh } = await readSessionCookies();
  const ip = req.headers.get('x-forwarded-for');
  let rotated = false;
  if (!access && refresh) {
    const pair = await refreshTokens(refresh, ip);
    if (!pair) {
      await clearSessionCookies();
      return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
    }
    access = pair.accessToken;
    refresh = pair.refreshToken;
    await setSessionCookies(pair);
    rotated = true;
  }
  if (!access) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });

  const url = new URL(req.url);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const body = hasBody ? await req.arrayBuffer() : undefined;
  const call = (token: string) =>
    fetch(`${apiUrl(target)}${url.search}`, {
      method: req.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(req.headers.get('content-type') ? { 'content-type': req.headers.get('content-type')! } : {}),
        ...(ip ? { 'x-forwarded-for': ip } : {}),
      },
      body,
      cache: 'no-store',
    });

  let upstream = await call(access).catch(() => null);
  if (!upstream) return NextResponse.json({ code: 'UPSTREAM_DOWN' }, { status: 502 });

  // access token expired earlier than its cookie (clock skew / revoked): rotate once and retry
  if (upstream.status === 401 && !rotated && refresh) {
    const pair = await refreshTokens(refresh, ip);
    if (!pair) {
      await clearSessionCookies();
      return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
    }
    await setSessionCookies(pair);
    upstream = await call(pair.accessToken).catch(() => null);
    if (!upstream) return NextResponse.json({ code: 'UPSTREAM_DOWN' }, { status: 502 });
  }

  const headers = new Headers();
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set('cache-control', 'no-store');
  return new NextResponse(upstream.status === 204 ? null : await upstream.arrayBuffer(), {
    status: upstream.status,
    headers,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
