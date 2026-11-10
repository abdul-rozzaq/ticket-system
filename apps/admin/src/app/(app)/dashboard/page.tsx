'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardBody, CardHeader, ErrorBox, PageHeader, Spinner, Stat, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { Me } from '@/lib/types';
import { fmtDateTime } from '@/lib/utils';

interface Dash {
  today: { opened: number; closed: number };
  open: { total: number; unassigned: number; waiting: number; overdue: number; urgent: number };
  mine: { open: number; overdue: number; closedToday: number } | null;
}

function AdminStatus() {
  const userbot = useQuery({
    queryKey: ['userbot-status'],
    queryFn: () =>
      api.get<{ status: string; alive: boolean; lastActivityAt: string | null; phone: string | null }>(
        'telegram/userbot/status',
      ),
    refetchInterval: 30_000,
  });
  const bot = useQuery({
    queryKey: ['bot'],
    queryFn: () => api.get<{ hasToken: boolean; status: unknown }>('telegram/bot'),
    refetchInterval: 30_000,
  });
  const folders = useQuery({
    queryKey: ['folders-status'],
    queryFn: () => api.get<Record<string, unknown>>('telegram/folders'),
  });
  const ai = useQuery({
    queryKey: ['ai-settings'],
    queryFn: () =>
      api.get<{ monthlyBudgetUsd: number | null; monthSpendUsd: number; provider: unknown }>('ai/settings'),
  });
  const ub = userbot.data;
  const botState = (bot.data?.status as { state?: string } | undefined)?.state;
  const lastRun = (folders.data as { lastRun?: { at?: string; status?: string } } | undefined)?.lastRun;
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardHeader title={t('dash.userbot')} />
        <CardBody className="space-y-1 text-sm">
          {ub ? (
            <>
              <Badge tone={ub.alive ? 'success' : 'danger'}>
                {ub.alive ? t('dash.alive') : t('dash.down')}
              </Badge>
              <div className="text-muted-foreground">{ub.status}</div>
              <div className="text-muted-foreground">
                {t('tg.lastActivity')}: {fmtDateTime(ub.lastActivityAt)}
              </div>
            </>
          ) : (
            <Spinner />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('dash.bot')} />
        <CardBody className="space-y-1 text-sm">
          {bot.data ? (
            <Badge tone={botState === 'CONNECTED' ? 'success' : bot.data.hasToken ? 'warning' : 'muted'}>
              {botState ?? (bot.data.hasToken ? 'token bor' : 'sozlanmagan')}
            </Badge>
          ) : (
            <Spinner />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('dash.folders')} />
        <CardBody className="space-y-1 text-sm">
          {folders.data ? (
            <>
              <Badge tone={lastRun?.status === 'OK' ? 'success' : lastRun?.status ? 'warning' : 'muted'}>
                {lastRun?.status ?? t('dash.never')}
              </Badge>
              <div className="text-muted-foreground">
                {t('dash.lastSync')}: {fmtDateTime(lastRun?.at)}
              </div>
            </>
          ) : (
            <Spinner />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('dash.aiBudget')} />
        <CardBody className="space-y-1 text-sm">
          {ai.data ? (
            <>
              <div className="text-lg font-semibold tabular-nums">
                ${ai.data.monthSpendUsd.toFixed(2)}
                {ai.data.monthlyBudgetUsd ? ` / $${ai.data.monthlyBudgetUsd}` : ''}
              </div>
              {!ai.data.provider && <Badge tone="warning">{t('ai.notConfigured')}</Badge>}
            </>
          ) : (
            <Spinner />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('auth/me') });
  const dash = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dash>('stats/dashboard'),
    refetchInterval: 30_000,
  });
  const d = dash.data;
  const admin = me.data?.role === 'ADMIN';
  return (
    <>
      <PageHeader title={t('dash.title')} />
      <ErrorBox error={dash.error} />
      {!d ? (
        <Spinner />
      ) : (
        <>
          {d.mine && (
            <div className="mb-4 grid gap-4 sm:grid-cols-3">
              <Link href="/my-tickets">
                <Stat label={t('dash.mine')} value={d.mine.open} />
              </Link>
              <Stat
                label={t('dash.mineOverdue')}
                value={d.mine.overdue}
                tone={d.mine.overdue ? 'danger' : undefined}
              />
              <Stat label={t('dash.mineClosed')} value={d.mine.closedToday} tone="success" />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <Stat label={t('dash.open')} value={d.open.total} />
            <Stat
              label={t('dash.unassigned')}
              value={d.open.unassigned}
              tone={d.open.unassigned ? 'warning' : undefined}
            />
            <Stat label={t('dash.waiting')} value={d.open.waiting} />
            <Stat
              label={t('dash.overdue')}
              value={d.open.overdue}
              tone={d.open.overdue ? 'danger' : undefined}
            />
            <Stat
              label={t('dash.urgent')}
              value={d.open.urgent}
              tone={d.open.urgent ? 'danger' : undefined}
            />
            <Stat label={t('dash.openedToday')} value={d.today.opened} />
            <Stat label={t('dash.closedToday')} value={d.today.closed} tone="success" />
          </div>
        </>
      )}
      {admin && <AdminStatus />}
    </>
  );
}
