'use client';
import { Badge, Empty, Table, Td, Th } from '@/components/ui';
import {
  SlaCell,
  StatusBadge,
  systemLabel,
  TicketLink,
  UrgencyBadge,
  type TicketRow,
} from '@/components/ticket-bits';
import { t } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/utils';

export function TicketsTable({ items }: { items: TicketRow[] }) {
  if (!items.length) return <Empty />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>{t('tickets.number')}</Th>
          <Th>{t('tickets.company')}</Th>
          <Th>{t('tickets.summary')}</Th>
          <Th>{t('common.status')}</Th>
          <Th>{t('tickets.assignee')}</Th>
          <Th>{t('tickets.sla')}</Th>
          <Th>{t('tickets.opened')}</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.id} className="hover:bg-muted/50">
            <Td>
              <TicketLink ticket={r} />
            </Td>
            <Td>
              <div className="font-medium">{r.clientGroup.companyName}</div>
              <div className="text-xs text-muted-foreground">{systemLabel(r.systemType)}</div>
            </Td>
            <Td className="max-w-md">
              <div className="line-clamp-2">{r.summary || '—'}</div>
              <div className="mt-1 flex gap-1">
                <UrgencyBadge urgency={r.urgency} />
                {r.needsReview && <Badge tone="warning">{t('tickets.needsReview')}</Badge>}
              </div>
            </Td>
            <Td>
              <StatusBadge status={r.status} />
            </Td>
            <Td>{r.assignee?.displayName ?? '—'}</Td>
            <Td>
              <SlaCell ticket={r} />
            </Td>
            <Td className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.openedAt)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
