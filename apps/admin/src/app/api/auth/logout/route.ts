import { NextResponse } from 'next/server';
import { apiUrl, clearSessionCookies, readSessionCookies } from '@/lib/server/session';
import { csrfOk } from '@/lib/server/proxy-rules';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!csrfOk('POST', req.headers)) return NextResponse.json({ code: 'CSRF' }, { status: 403 });
  const { refresh } = await readSessionCookies();
  if (refresh) {
    await fetch(apiUrl('auth/logout'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
      cache: 'no-store',
    }).catch(() => null);
  }
  await clearSessionCookies();
  return new NextResponse(null, { status: 204 });
}
