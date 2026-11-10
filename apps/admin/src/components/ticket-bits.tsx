'use client';
import Link from 'next/link';
import { slaInfo } from '@tp/shared';
import { Badge } from '@/components/ui';
import { t, type I18nKey } from '@/lib/i18n';

export interface TicketRow {
  id: string;
  number: number;
  status: 'NEW' | 'IN_PROGRESS' | 'WAITING_CLIENT' | 'CLOSED';
  urgency: 'LOW' | 'NORMAL' | 'HIGH';
  systemType: string;
  category: string;
  summary: string;
  needsReview: boolean;
  aiConfidence: number | null;
  openedAt: string;
  slaDeadline: string;
  closedAt: string | null;
  assigneeId: string | null;
  assignee?: { id: string; displayName: string } | null;
  clientGroup: { id: string; companyName: string; title: string };
}

const statusTone = {
  NEW: 'primary',
  IN_PROGRESS: 'warning',
  WAITING_CLIENT: 'muted',
  CLOSED: 'success',
} as const;
export const StatusBadge = ({ status }: { status: TicketRow['status'] }) => (
  <Badge tone={statusTone[status]}>{t(`status.${status}` as I18nKey)}</Badge>
);

export const UrgencyBadge = ({ urgency }: { urgency: TicketRow['urgency'] }) =>
  urgency === 'NORMAL' ? null : (
    <Badge tone={urgency === 'HIGH' ? 'danger' : 'muted'}>{t(`urgency.${urgency}` as I18nKey)}</Badge>
  );

export function SlaCell({ ticket }: { ticket: Pick<TicketRow, 'status' | 'slaDeadline'> }) {
  const info = slaInfo(ticket);
  return (
    <span className={info.overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}>
      {info.label}
    </span>
  );
}

export const TicketLink = ({ ticket }: { ticket: Pick<TicketRow, 'id' | 'number'> }) => (
  <Link href={`/tickets/${ticket.id}`} className="font-medium text-primary hover:underline">
    #{ticket.number}
  </Link>
);

export const systemLabel = (s: string) => t(`system.${s}` as I18nKey);
