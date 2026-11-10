'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASSIGNMENT_STRATEGIES, SYSTEM_TYPES } from '@tp/shared';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Switch,
  Table,
  Td,
  Th,
  Empty,
} from '@/components/ui';
import { useToast } from '@/components/providers';
import { systemLabel } from '@/components/ticket-bits';
import { api } from '@/lib/api';
import { t, type I18nKey } from '@/lib/i18n';

interface Group {
  id: string;
  telegramChatId: string;
  title: string;
  companyName: string;
  systemType: string;
  language: 'uz' | 'ru';
  defaultOwnerId: string | null;
  slaPolicyId: string | null;
  assignmentStrategy: string | null;
  isActive: boolean;
  isConfirmed: boolean;
}
interface UserLite {
  id: string;
  displayName: string;
  isActive: boolean;
}
interface Policy {
  id: string;
  name: string;
  isDefault: boolean;
}

const blank = {
  telegramChatId: '',
  title: '',
  companyName: '',
  systemType: 'OTHER',
  language: 'uz',
  defaultOwnerId: '',
  slaPolicyId: '',
  assignmentStrategy: '',
  isActive: true,
};
type Form = typeof blank;

function GroupModal({
  group,
  open,
  onClose,
  users,
  policies,
}: {
  group: Group | 'new' | null;
  open: boolean;
  onClose: () => void;
  users: UserLite[];
  policies: Policy[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = React.useState<Form>(blank);
  React.useEffect(() => {
    if (group && group !== 'new')
      setF({
        telegramChatId: group.telegramChatId,
        title: group.title,
        companyName: group.companyName,
        systemType: group.systemType,
        language: group.language,
        defaultOwnerId: group.defaultOwnerId ?? '',
        slaPolicyId: group.slaPolicyId ?? '',
        assignmentStrategy: group.assignmentStrategy ?? '',
        isActive: group.isActive,
      });
    else setF(blank);
  }, [group]);
  const isNew = group === 'new';
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...(isNew ? { telegramChatId: f.telegramChatId.trim() } : {}),
        title: f.title,
        companyName: f.companyName,
        systemType: f.systemType,
        language: f.language,
        defaultOwnerId: f.defaultOwnerId || null,
        slaPolicyId: f.slaPolicyId || null,
        assignmentStrategy: f.assignmentStrategy || null,
        isActive: f.isActive,
      };
      return isNew
        ? api.post('client-groups', body)
        : api.patch(`client-groups/${(group as Group).id}`, body);
    },
    onSuccess: () => {
      toast(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['groups'] });
      onClose();
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal open={open} onClose={onClose} title={isNew ? t('groups.new') : t('common.edit')}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {isNew && (
          <Field label={t('groups.chatId')} hint={t('groups.chatIdHint')} className="sm:col-span-2">
            <Input
              value={f.telegramChatId}
              onChange={(e) => set('telegramChatId', e.target.value)}
              required
            />
          </Field>
        )}
        <Field label={t('groups.company')}>
          <Input value={f.companyName} onChange={(e) => set('companyName', e.target.value)} required />
        </Field>
        <Field label={t('common.title')}>
          <Input value={f.title} onChange={(e) => set('title', e.target.value)} required />
        </Field>
        <Field label={t('common.system')}>
          <Select value={f.systemType} onChange={(e) => set('systemType', e.target.value)}>
            {SYSTEM_TYPES.map((s) => (
              <option key={s} value={s}>
                {systemLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.language')}>
          <Select value={f.language} onChange={(e) => set('language', e.target.value)}>
            <option value="uz">O‘zbekcha</option>
            <option value="ru">Русский</option>
          </Select>
        </Field>
        <Field label={t('groups.owner')}>
          <Select value={f.defaultOwnerId} onChange={(e) => set('defaultOwnerId', e.target.value)}>
            <option value="">—</option>
            {users
              .filter((u) => u.isActive)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t('groups.sla')}>
          <Select value={f.slaPolicyId} onChange={(e) => set('slaPolicyId', e.target.value)}>
            <option value="">{t('groups.default')}</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('groups.strategy')}>
          <Select value={f.assignmentStrategy} onChange={(e) => set('assignmentStrategy', e.target.value)}>
            <option value="">{t('groups.default')}</option>
            {ASSIGNMENT_STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {t(`strategy.${s}` as I18nKey)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <Switch checked={f.isActive} onChange={(v) => set('isActive', v)} label={t('common.active')} />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function GroupsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = React.useState<Group | 'new' | null>(null);
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<Group[]>('client-groups') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserLite[]>('users') });
  const policies = useQuery({ queryKey: ['sla-policies'], queryFn: () => api.get<Policy[]>('sla-policies') });
  const discover = useMutation({
    mutationFn: () => api.post('telegram/userbot/discover'),
    onSuccess: () => {
      toast(t('groups.discoverStarted'));
      setTimeout(() => qc.invalidateQueries({ queryKey: ['groups'] }), 4000);
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const activate = useMutation({
    mutationFn: (id: string) => api.patch(`client-groups/${id}`, { isActive: true }),
    onSuccess: () => {
      toast(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const ownerName = (id: string | null) => (users.data ?? []).find((u) => u.id === id)?.displayName ?? '—';
  const pending = (groups.data ?? []).filter((g) => !g.isConfirmed);
  const confirmed = (groups.data ?? []).filter((g) => g.isConfirmed);

  const table = (rows: Group[], isPending: boolean) => (
    <Table>
      <thead>
        <tr>
          <Th>{t('groups.company')}</Th>
          <Th>{t('common.system')}</Th>
          <Th>{t('groups.owner')}</Th>
          <Th>{t('groups.chatId')}</Th>
          <Th>{t('common.status')}</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {rows.map((g) => (
          <tr key={g.id}>
            <Td>
              <div className="font-medium">{g.companyName}</div>
              <div className="text-xs text-muted-foreground">{g.title}</div>
            </Td>
            <Td>{systemLabel(g.systemType)}</Td>
            <Td>{ownerName(g.defaultOwnerId)}</Td>
            <Td className="font-mono text-xs">{g.telegramChatId}</Td>
            <Td>
              <Badge tone={g.isActive ? 'success' : 'muted'}>
                {g.isActive ? t('common.active') : t('common.inactive')}
              </Badge>
            </Td>
            <Td className="whitespace-nowrap text-right">
              {isPending && (
                <Button size="sm" className="mr-2" onClick={() => activate.mutate(g.id)}>
                  {t('groups.activate')}
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => setEditing(g)}>
                {t('common.edit')}
              </Button>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );

  return (
    <>
      <PageHeader
        title={t('groups.title')}
        actions={
          <>
            <Button variant="secondary" onClick={() => discover.mutate()} disabled={discover.isPending}>
              {t('groups.discover')}
            </Button>
            <Button onClick={() => setEditing('new')}>{t('groups.new')}</Button>
          </>
        }
      />
      <ErrorBox error={groups.error} />
      {groups.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          {pending.length > 0 && (
            <Card>
              <div className="border-b px-4 py-3 text-sm font-semibold">
                {t('groups.pending')} <Badge tone="warning">{pending.length}</Badge>
              </div>
              {table(pending, true)}
            </Card>
          )}
          <Card>{confirmed.length ? table(confirmed, false) : <Empty />}</Card>
        </div>
      )}
      <GroupModal
        group={editing}
        open={!!editing}
        onClose={() => setEditing(null)}
        users={users.data ?? []}
        policies={policies.data ?? []}
      />
    </>
  );
}
