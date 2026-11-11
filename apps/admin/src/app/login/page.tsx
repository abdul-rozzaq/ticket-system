'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Headset } from 'lucide-react';
import { Button, ErrorBox, Field, Input } from '@/components/ui';
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
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_28rem]">
      <section className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-primary text-primary-foreground">
            <Headset size={18} />
          </span>
          <span className="text-base font-semibold tracking-tight text-white">{t('app.name')}</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight text-white">{t('login.tagline')}</h2>
          <p className="mt-3 text-sm leading-relaxed">{t('login.taglineSub')}</p>
        </div>
        <div className="text-xs text-sidebar-muted">© TP</div>
      </section>

      <section className="flex items-center justify-center bg-card p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-primary text-primary-foreground">
              <Headset size={18} />
            </span>
            <span className="text-base font-semibold">{t('app.name')}</span>
          </div>
          <h1 className="text-2xl font-semibold">{t('login.title')}</h1>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">{t('login.subtitle')}</p>
          <form onSubmit={submit} className="space-y-4">
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
        </div>
      </section>
    </main>
  );
}
