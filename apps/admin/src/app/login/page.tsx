'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardBody, ErrorBox, Field, Input } from '@/components/ui';
import { CSRF_HEADER_NAME } from '@/lib/csrf';
import { t } from '@/lib/i18n';

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CSRF_HEADER_NAME]: '1' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [next, setNext] = React.useState('');
  const [mustChange, setMustChange] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mustChange) {
        const r = await post('/api/auth/change-password', { currentPassword: password, newPassword: next });
        if (!r.ok) return setError(r.data.message ?? t('common.error'));
        router.replace('/dashboard');
        return;
      }
      const r = await post('/api/auth/login', { username, password });
      if (!r.ok) {
        return setError(r.status === 429 ? t('login.locked') : (r.data.message ?? t('login.failed')));
      }
      if (r.data.user?.mustChangePassword) {
        setMustChange(true);
        return;
      }
      router.replace('/dashboard');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardBody>
          <h1 className="mb-1 text-lg font-semibold">{t('app.name')}</h1>
          <p className="mb-4 text-sm text-muted-foreground">
            {mustChange ? t('login.mustChange') : t('login.title')}
          </p>
          <form onSubmit={submit} className="space-y-3">
            {!mustChange && (
              <Field label={t('login.username')}>
                <Input
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </Field>
            )}
            {!mustChange && (
              <Field label={t('login.password')}>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
            )}
            {mustChange && (
              <Field label={t('login.newPassword')}>
                <Input
                  autoFocus
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  required
                />
              </Field>
            )}
            {error && <ErrorBox error={error} />}
            <Button type="submit" className="w-full" disabled={busy}>
              {mustChange ? t('login.change') : t('login.submit')}
            </Button>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}
