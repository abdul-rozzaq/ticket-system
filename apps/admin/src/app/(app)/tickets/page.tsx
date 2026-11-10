'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SYSTEM_TYPES, TICKET_STATUSES } from '@tp/shared';
import {
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Modal,
  PageHeader,
  Pager,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { useToast } from '@/components/providers';
import { TicketsTable } from '@/components/tickets-table';
import type { TicketRow } from '@/components/ticket-bits';
import { api, qs } from '@/lib/api';
import { t, type I18nKey } from '@/lib/i18n';
import type { Paged } from '@/lib/types';
import { useRouter } from 'next/navigation';

interface Group {
  id: string;
  companyName: string;
  isActive: boolean;
}
interface UserLite {
  id: string;
  displayName: string;
}

function NewTicketModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const groups = useQuery({
    queryKey: ['groups-all'],
    queryFn: () => api.get<Group[]>('client-groups'),
    enabled: open,
  });
  const [groupId, setGroupId] = React.useState('');
  const [text, setText] = React.useState('');
  const create = useMutation({
    mutationFn: () => api.post<{ ticket: { id: string } }>('tickets', { clientGroupId: groupId, text }),
    onSuccess: (r) => {
      toast(t('common.saved'));
      onClose();
      router.push(`/tickets/${r.ticket.id}`);
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('tickets.new')}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label={t('tickets.group')}>
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
            <option value="">—</option>
            {(groups.data ?? [])
              .filter((g) => g.isActive)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.companyName}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t('tickets.createText')}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} required maxLength={4000} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {t('common.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function TicketsPage() {
  const qc = useQueryClient();
  const [f, setF] = React.useState({ status: '', assigneeId: '', systemType: '', q: '', page: 1 });
  const [modal, setModal] = React.useState(false);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserLite[]>('users') });
  const list = useQuery({
    queryKey: ['tickets', f],
    queryFn: () => api.get<Paged<TicketRow>>(`tickets${qs({ ...f, pageSize: 25 })}`),
    placeholderData: (p) => p,
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, page: 1, ...patch }));
  return (
    <>
      <PageHeader
        title={t('tickets.title')}
        actions={<Button onClick={() => setModal(true)}>{t('tickets.new')}</Button>}
      />
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input placeholder={t('tickets.search')} value={f.q} onChange={(e) => set({ q: e.target.value })} />
        <Select value={f.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">
            {t('tickets.filterStatus')}: {t('common.all')}
          </option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}` as I18nKey)}
            </option>
          ))}
        </Select>
        <Select value={f.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })}>
          <option value="">
            {t('tickets.filterAssignee')}: {t('common.all')}
          </option>
          {(users.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </Select>
        <Select value={f.systemType} onChange={(e) => set({ systemType: e.target.value })}>
          <option value="">
            {t('common.system')}: {t('common.all')}
          </option>
          {SYSTEM_TYPES.map((s) => (
            <option key={s} value={s}>
              {t(`system.${s}` as I18nKey)}
            </option>
          ))}
        </Select>
      </div>
      <ErrorBox error={list.error} />
      <Card>
        {list.isLoading ? (
          <Spinner />
        ) : (
          <>
            <TicketsTable items={list.data?.items ?? []} />
            <Pager
              page={f.page}
              pageSize={25}
              total={list.data?.total ?? 0}
              onPage={(page) => setF((s) => ({ ...s, page }))}
            />
          </>
        )}
      </Card>
      <NewTicketModal
        open={modal}
        onClose={() => {
          setModal(false);
          qc.invalidateQueries({ queryKey: ['tickets'] });
        }}
      />
    </>
  );
}
