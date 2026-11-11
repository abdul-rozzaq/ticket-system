'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardBody, ErrorBox, Field, Input } from '@/components/ui';
import { CSRF_HEADER_NAME } from '@/lib/csrf';
import { t } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CSRF_HEADER_NAME]: '1' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return setError(res.status === 429 ? t('login.locked') : (data.message ?? t('login.failed')));
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
          <p className="mb-4 text-sm text-muted-foreground">{t('login.title')}</p>
          <form onSubmit={submit} className="space-y-3">
            <Field label={t('login.username')}>
              <Input
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </Field>
            <Field label={t('login.password')}>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            {error && <ErrorBox error={error} />}
            <Button type="submit" className="w-full" disabled={busy}>
              {t('login.submit')}
            </Button>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}
