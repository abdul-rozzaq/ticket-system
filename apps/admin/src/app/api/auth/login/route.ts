import { NextResponse } from 'next/server';
import { apiUrl, setSessionCookies } from '@/lib/server/session';
import { csrfOk } from '@/lib/server/proxy-rules';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!csrfOk('POST', req.headers)) return NextResponse.json({ code: 'CSRF' }, { status: 403 });
  const body = await req.text();
  const res = await fetch(apiUrl('auth/login'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
    },
    body,
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return NextResponse.json({ code: 'UPSTREAM_DOWN' }, { status: 502 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  await setSessionCookies(data);
  // tokens never reach the browser JS; only the user object does
  return NextResponse.json({ user: data.user });
}
