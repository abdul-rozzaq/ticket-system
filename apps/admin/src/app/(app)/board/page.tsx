'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SYSTEM_TYPES } from '@tp/shared';
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { useToast } from '@/components/providers';
import { SlaCell, systemLabel, UrgencyBadge } from '@/components/ticket-bits';
import { api, qs } from '@/lib/api';
import { t, type I18nKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface Card {
  id: string;
  number: number;
  company: string;
  summary: string;
  urgency: 'LOW' | 'NORMAL' | 'HIGH';
  status: 'NEW' | 'IN_PROGRESS' | 'WAITING_CLIENT' | 'CLOSED';
  systemType: string;
  assigneeName: string | null;
  slaDeadline: string;
  overdue: boolean;
  needsReview: boolean;
}
interface Column {
  key: string;
  kind: string;
  title: string;
  cards: Card[];
}
interface UserLite {
  id: string;
  displayName: string;
}

export default function BoardPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [assigneeId, setAssigneeId] = React.useState('');
  const [systemType, setSystemType] = React.useState('');
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const [pendingClose, setPendingClose] = React.useState<{ ticketId: string } | null>(null);
  const [note, setNote] = React.useState('');

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserLite[]>('users') });
  const board = useQuery({
    queryKey: ['board', assigneeId, systemType],
    queryFn: () => api.get<{ columns: Column[] }>(`funnel/board${qs({ assigneeId, systemType })}`),
    refetchInterval: 15_000,
  });
  const move = useMutation({
    mutationFn: (v: { ticketId: string; to: string; solutionNote?: string }) => api.post('funnel/move', v),
    onSuccess: () => {
      toast(t('board.moved'));
      qc.invalidateQueries({ queryKey: ['board'] });
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });

  function drop(col: Column, payload: string) {
    const ticketId = payload || dragging;
    setDragging(null);
    setOver(null);
    if (!ticketId) return;
    if (col.key === 'OVERDUE') return toast(t('board.virtual'), 'err');
    if (col.cards.some((c) => c.id === ticketId)) return;
    if (col.key === 'CLOSED') return setPendingClose({ ticketId });
    move.mutate({ ticketId, to: col.key });
  }

  return (
    <>
      <PageHeader
        title={t('board.title')}
        description={t('board.hint')}
        actions={
          <>
            <Select
              className="w-44"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              aria-label={t('board.filterStaff')}
            >
              <option value="">
                {t('board.filterStaff')}: {t('common.all')}
              </option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </Select>
            <Select
              className="w-40"
              value={systemType}
              onChange={(e) => setSystemType(e.target.value)}
              aria-label={t('board.filterSystem')}
            >
              <option value="">
                {t('board.filterSystem')}: {t('common.all')}
              </option>
              {SYSTEM_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t(`system.${s}` as I18nKey)}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <ErrorBox error={board.error} />
      {board.isLoading ? (
        <Spinner />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {(board.data?.columns ?? []).map((col) => (
            <section
              key={col.key}
              aria-label={col.title}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.key);
              }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                drop(col, e.dataTransfer.getData('text/plain'));
              }}
              className={cn(
                'w-72 shrink-0 rounded-lg border bg-muted/40 p-2',
                over === col.key && 'ring-2 ring-primary',
                col.key === 'OVERDUE' && 'border-destructive/40',
              )}
            >
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                <span className="truncate">{col.title}</span>
                <Badge tone={col.key === 'OVERDUE' && col.cards.length ? 'danger' : 'muted'}>
                  {col.cards.length}
                </Badge>
              </h2>
              <div className="space-y-2">
                {col.cards.map((c) => (
                  <article
                    key={c.id}
                    draggable
                    onDragStart={(e) => {
                      setDragging(c.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', c.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={cn(
                      'cursor-grab rounded-md border bg-card p-2.5 text-sm shadow-sm active:cursor-grabbing',
                      c.overdue && 'border-destructive/50',
                      dragging === c.id && 'opacity-50',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/tickets/${c.id}`} className="font-medium text-primary hover:underline">
                        #{c.number}
                      </Link>
                      <div className="flex gap-1">
                        <UrgencyBadge urgency={c.urgency} />
                        {c.needsReview && <Badge tone="warning">?</Badge>}
                      </div>
                    </div>
                    <div className="mt-0.5 font-medium">{c.company}</div>
                    <div className="line-clamp-2 text-muted-foreground">{c.summary || '—'}</div>
                    <div className="mt-1.5 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{systemLabel(c.systemType)}</span>
                      <SlaCell ticket={c} />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <Modal open={!!pendingClose} onClose={() => setPendingClose(null)} title={t('ticket.close')}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pendingClose)
              move.mutate({ ticketId: pendingClose.ticketId, to: 'CLOSED', solutionNote: note || undefined });
            setPendingClose(null);
            setNote('');
          }}
        >
          <Field label={t('board.closeNote')}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingClose(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('ticket.close')}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
