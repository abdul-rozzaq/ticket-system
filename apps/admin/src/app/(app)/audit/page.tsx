'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Empty,
  ErrorBox,
  Input,
  PageHeader,
  Pager,
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { api, qs } from '@/lib/api';
import { t } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/utils';

interface Row {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
  actor: { username: string; displayName: string } | null;
}
interface UserLite {
  id: string;
  displayName: string;
}

export default function AuditPage() {
  const [f, setF] = React.useState({ action: '', actorId: '', q: '', from: '', to: '', page: 1 });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserLite[]>('users') });
  const list = useQuery({
    queryKey: ['audit', f],
    queryFn: () =>
      api.get<{ items: Row[]; total: number; actions: string[] }>(
        `audit${qs({ ...f, from: f.from ? new Date(f.from).toISOString() : '', to: f.to ? new Date(`${f.to}T23:59:59`).toISOString() : '', pageSize: 50 })}`,
      ),
    placeholderData: (p) => p,
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, page: 1, ...patch }));
  return (
    <>
      <PageHeader title={t('audit.title')} />
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          value={f.action}
          onChange={(e) => set({ action: e.target.value })}
          aria-label={t('audit.action')}
        >
          <option value="">
            {t('audit.action')}: {t('common.all')}
          </option>
          {(list.data?.actions ?? []).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Select
          value={f.actorId}
          onChange={(e) => set({ actorId: e.target.value })}
          aria-label={t('audit.actor')}
        >
          <option value="">
            {t('audit.actor')}: {t('common.all')}
          </option>
          {(users.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </Select>
        <Input placeholder={t('common.search')} value={f.q} onChange={(e) => set({ q: e.target.value })} />
        <Input
          type="date"
          value={f.from}
          onChange={(e) => set({ from: e.target.value })}
          aria-label={t('audit.from')}
        />
        <Input
          type="date"
          value={f.to}
          onChange={(e) => set({ to: e.target.value })}
          aria-label={t('audit.to')}
        />
      </div>
      <ErrorBox error={list.error} />
      <Card>
        {list.isLoading ? (
          <Spinner />
        ) : !list.data?.items.length ? (
          <Empty />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('audit.actor')}</Th>
                  <Th>{t('audit.action')}</Th>
                  <Th>{t('audit.entity')}</Th>
                  <Th>{t('audit.details')}</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.createdAt)}</Td>
                    <Td>{r.actor?.displayName ?? '—'}</Td>
                    <Td className="font-mono text-xs">{r.action}</Td>
                    <Td className="text-xs text-muted-foreground">
                      {r.entity}
                      {r.entityId ? ` ${r.entityId.slice(0, 8)}` : ''}
                    </Td>
                    <Td className="max-w-xs break-words font-mono text-xs text-muted-foreground">
                      {Object.keys(r.meta ?? {}).length ? JSON.stringify(r.meta) : ''}
                    </Td>
                    <Td className="text-xs text-muted-foreground">{r.ip}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager
              page={f.page}
              pageSize={50}
              total={list.data.total}
              onPage={(page) => setF((s) => ({ ...s, page }))}
            />
          </>
        )}
      </Card>
    </>
  );
}
