'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, ErrorBox, PageHeader, Spinner, Switch } from '@/components/ui';
import { TicketsTable } from '@/components/tickets-table';
import type { TicketRow } from '@/components/ticket-bits';
import { api, qs } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { Me, Paged } from '@/lib/types';

export default function MyTicketsPage() {
  const [closed, setClosed] = React.useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('auth/me') });
  const list = useQuery({
    queryKey: ['my-tickets', me.data?.id],
    enabled: !!me.data,
    queryFn: () => api.get<Paged<TicketRow>>(`tickets${qs({ assigneeId: me.data!.id, pageSize: 100 })}`),
    refetchInterval: 30_000,
  });
  const items = (list.data?.items ?? []).filter((x) => closed || x.status !== 'CLOSED');
  return (
    <>
      <PageHeader
        title={t('tickets.mine')}
        actions={<Switch checked={closed} onChange={setClosed} label={t('status.CLOSED')} />}
      />
      <ErrorBox error={list.error} />
      <Card>{list.isLoading ? <Spinner /> : <TicketsTable items={items} />}</Card>
    </>
  );
}
