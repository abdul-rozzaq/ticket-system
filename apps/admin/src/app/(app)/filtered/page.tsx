'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  PageHeader,
  Pager,
  Select,
  Spinner,
  Table,
  Td,
  Th,
  Empty,
} from '@/components/ui';
import { useToast } from '@/components/providers';
import { api, qs } from '@/lib/api';
import { t, type I18nKey } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/utils';

interface Row {
  id: string;
  text: string;
  reason: string;
  senderName: string | null;
  createdAt: string;
  clientGroup: { companyName: string };
}
const REASONS = ['EMPTY', 'EMOJI_ONLY', 'TOO_SHORT', 'ACKNOWLEDGEMENT', 'STAFF_MESSAGE', 'AI_NOT_REQUEST'];

export default function FilteredPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = React.useState('');
  const [page, setPage] = React.useState(1);
  const list = useQuery({
    queryKey: ['filtered', reason, page],
    queryFn: () =>
      api.get<{ items: Row[]; total: number }>(`filtered-messages${qs({ reason, page, pageSize: 25 })}`),
    placeholderData: (p) => p,
  });
  const create = useMutation({
    mutationFn: (id: string) => api.post<{ ticketId: string }>(`filtered-messages/${id}/create-ticket`),
    onSuccess: () => {
      toast(t('filtered.created'));
      qc.invalidateQueries({ queryKey: ['filtered'] });
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  return (
    <>
      <PageHeader
        title={t('filtered.title')}
        description={t('filtered.hint')}
        actions={
          <Select
            className="w-52"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setPage(1);
            }}
          >
            <option value="">
              {t('filtered.reason')}: {t('common.all')}
            </option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`reason.${r}` as I18nKey)}
              </option>
            ))}
          </Select>
        }
      />
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
                  <Th>{t('tickets.company')}</Th>
                  <Th>{t('tickets.summary')}</Th>
                  <Th>{t('filtered.reason')}</Th>
                  <Th>{t('common.date')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap">
                      <div className="font-medium">{r.clientGroup.companyName}</div>
                      <div className="text-xs text-muted-foreground">{r.senderName}</div>
                    </Td>
                    <Td className="max-w-lg whitespace-pre-wrap break-words">{r.text}</Td>
                    <Td>
                      <Badge>{t(`reason.${r.reason}` as I18nKey)}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.createdAt)}</Td>
                    <Td>
                      <Button size="sm" disabled={create.isPending} onClick={() => create.mutate(r.id)}>
                        {t('filtered.createTicket')}
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        <Link href="/tickets" className="hover:underline">
          {t('nav.tickets')} →
        </Link>
      </p>
    </>
  );
}
