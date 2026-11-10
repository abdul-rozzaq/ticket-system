'use client';
import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorBox,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { useToast } from '@/components/providers';
import { SlaCell, StatusBadge, systemLabel, UrgencyBadge, type TicketRow } from '@/components/ticket-bits';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { Me } from '@/lib/types';
import { fmtDateTime } from '@/lib/utils';

interface Msg {
  id: string;
  direction: 'IN' | 'OUT';
  senderName: string | null;
  text: string;
  isInternalNote: boolean;
  answeredById: string | null;
  answeredConfidence: number | null;
  sentAt: string;
}
interface Ev {
  id: string;
  type: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
interface Detail extends TicketRow {
  messages: Msg[];
  events: Ev[];
  solutionNote: string | null;
  previousTicketId: string | null;
  mergedIntoId: string | null;
  createdFromFilteredId: string | null;
  closedBy: { displayName: string } | null;
  firstResponseAt: string | null;
  closedAt: string | null;
  tags: string[];
}
interface UserLite {
  id: string;
  displayName: string;
  isActive: boolean;
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('auth/me') });
  const admin = me.data?.role === 'ADMIN';
  const q = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.get<Detail>(`tickets/${id}`),
    refetchInterval: 20_000,
  });
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<UserLite[]>('users'),
    enabled: admin,
  });
  const [note, setNote] = React.useState('');
  const [assignTo, setAssignTo] = React.useState('');
  const [handover, setHandover] = React.useState('');
  const [closeOpen, setCloseOpen] = React.useState(false);
  const [solution, setSolution] = React.useState('');
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [mergeNumber, setMergeNumber] = React.useState('');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ticket', id] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['my-tickets'] });
  };
  const run = <T,>(fn: () => Promise<T>, after?: () => void) =>
    fn()
      .then(() => {
        toast(t('common.saved'));
        refresh();
        after?.();
      })
      .catch((e: Error) => toast(e.message, 'err'));

  const merge = useMutation({
    mutationFn: async () => {
      const found = await api.get<{ items: { id: string; number: number }[] }>(
        `tickets?q=${encodeURIComponent(mergeNumber)}`,
      );
      const target = found.items.find((x) => String(x.number) === mergeNumber.replace('#', ''));
      if (!target) throw new Error('Tiket topilmadi');
      return api.post(`tickets/${id}/merge`, { targetId: target.id });
    },
    onSuccess: () => {
      toast(t('common.saved'));
      setMergeOpen(false);
      refresh();
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });

  const tk = q.data;
  if (q.isLoading) return <Spinner />;
  if (!tk) return <ErrorBox error={q.error} />;
  const closed = tk.status === 'CLOSED';
  const actorName = (aid: string | null) =>
    (users.data ?? []).find((u) => u.id === aid)?.displayName ?? aid?.slice(0, 8) ?? '—';

  return (
    <>
      <PageHeader
        title={`#${tk.number} · ${tk.clientGroup.companyName}`}
        description={`${systemLabel(tk.systemType)} · ${tk.category}`}
        actions={
          <>
            <StatusBadge status={tk.status} />
            <UrgencyBadge urgency={tk.urgency} />
            {tk.needsReview && <Badge tone="warning">{t('tickets.needsReview')}</Badge>}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t('ticket.conversation')} />
            <CardBody className="space-y-3">
              {tk.summary && tk.summary !== tk.messages[0]?.text && (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">{tk.summary}</p>
              )}
              {tk.messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.isInternalNote
                      ? 'border border-warning/50 bg-warning/10'
                      : m.direction === 'OUT'
                        ? 'ml-auto bg-primary/10'
                        : 'bg-secondary'
                  }`}
                >
                  <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {m.isInternalNote
                        ? t('ticket.internal')
                        : m.direction === 'OUT'
                          ? t('ticket.out')
                          : t('ticket.in')}
                      {m.senderName ? ` · ${m.senderName}` : ''}
                    </span>
                    <span>{fmtDateTime(m.sentAt)}</span>
                    {m.answeredById && (
                      <span>
                        {t('ticket.answeredBy')}: {actorName(m.answeredById)}
                        {m.answeredConfidence != null &&
                          ` (${t('ticket.confidence')} ${Math.round(m.answeredConfidence * 100)}%)`}
                      </span>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.text}</div>
                </div>
              ))}
              {!tk.messages.length && <p className="text-sm text-muted-foreground">{t('common.empty')}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('ticket.note')} />
            <CardBody>
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(
                    () => api.post(`tickets/${id}/note`, { text: note }),
                    () => setNote(''),
                  );
                }}
              >
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('ticket.noteHint')}
                  maxLength={2000}
                  required
                />
                <Button type="submit" size="sm">
                  {t('ticket.addNote')}
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('ticket.events')} />
            <CardBody>
              <ol className="space-y-1 text-xs text-muted-foreground">
                {tk.events.map((e) => (
                  <li key={e.id}>
                    <span className="tabular-nums">{fmtDateTime(e.createdAt)}</span> · <b>{e.type}</b>
                    {e.actorId ? ` · ${actorName(e.actorId)}` : ''}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardBody className="space-y-2 text-sm">
              <Row k={t('tickets.assignee')} v={tk.assignee?.displayName ?? '—'} />
              <Row k={t('tickets.sla')} v={<SlaCell ticket={tk} />} />
              <Row k={t('tickets.opened')} v={fmtDateTime(tk.openedAt)} />
              <Row k={t('stats.firstResponse')} v={fmtDateTime(tk.firstResponseAt)} />
              {closed && (
                <Row
                  k={t('status.CLOSED')}
                  v={`${fmtDateTime(tk.closedAt)} · ${tk.closedBy?.displayName ?? ''}`}
                />
              )}
              {tk.aiConfidence != null && <Row k="AI" v={`${Math.round(tk.aiConfidence * 100)}%`} />}
              {tk.previousTicketId && (
                <Row
                  k={t('ticket.previous')}
                  v={
                    <Link className="text-primary hover:underline" href={`/tickets/${tk.previousTicketId}`}>
                      →
                    </Link>
                  }
                />
              )}
              {tk.createdFromFilteredId && (
                <div className="text-xs text-muted-foreground">{t('ticket.fromFiltered')}</div>
              )}
              {tk.solutionNote && (
                <div className="rounded-md bg-muted p-2">
                  <div className="text-xs text-muted-foreground">{t('ticket.solution')}</div>
                  {tk.solutionNote}
                </div>
              )}
            </CardBody>
          </Card>

          {!closed && (
            <Card>
              <CardHeader title={t('ticket.actions')} />
              <CardBody className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {tk.assigneeId !== me.data?.id && (
                    <Button size="sm" onClick={() => run(() => api.post(`tickets/${id}/take`))}>
                      {t('ticket.take')}
                    </Button>
                  )}
                  {tk.status === 'WAITING_CLIENT' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => run(() => api.post(`tickets/${id}/status`, { status: 'IN_PROGRESS' }))}
                    >
                      {t('ticket.resume')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        run(() => api.post(`tickets/${id}/status`, { status: 'WAITING_CLIENT' }))
                      }
                    >
                      {t('ticket.wait')}
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => setCloseOpen(true)}>
                    {t('ticket.close')}
                  </Button>
                  {admin && (
                    <Button size="sm" variant="outline" onClick={() => setMergeOpen(true)}>
                      {t('ticket.merge')}
                    </Button>
                  )}
                </div>
                {admin && (
                  <form
                    className="space-y-2 border-t pt-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(
                        () =>
                          api.post(`tickets/${id}/assign`, {
                            assigneeId: assignTo,
                            handoverNote: handover || undefined,
                          }),
                        () => setHandover(''),
                      );
                    }}
                  >
                    <Select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} required>
                      <option value="">{t('ticket.assign')}…</option>
                      {(users.data ?? [])
                        .filter((u) => u.isActive)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.displayName}
                          </option>
                        ))}
                    </Select>
                    <Input
                      placeholder={t('ticket.handover')}
                      value={handover}
                      onChange={(e) => setHandover(e.target.value)}
                      maxLength={500}
                    />
                    <Button type="submit" size="sm" variant="secondary" disabled={!assignTo}>
                      {t('ticket.assign')}
                    </Button>
                  </form>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <Modal open={closeOpen} onClose={() => setCloseOpen(false)} title={t('ticket.close')}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => api.post(`tickets/${id}/close`, { solutionNote: solution || undefined }),
              () => {
                setCloseOpen(false);
                setSolution('');
              },
            );
          }}
        >
          <Field label={t('ticket.closeNote')}>
            <Textarea value={solution} onChange={(e) => setSolution(e.target.value)} maxLength={2000} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCloseOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('ticket.close')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={mergeOpen} onClose={() => setMergeOpen(false)} title={t('ticket.merge')}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            merge.mutate();
          }}
        >
          <Field label={t('ticket.mergeInto')}>
            <Input
              value={mergeNumber}
              onChange={(e) => setMergeNumber(e.target.value)}
              placeholder="#123"
              required
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMergeOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={merge.isPending}>
              {t('ticket.merge')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
