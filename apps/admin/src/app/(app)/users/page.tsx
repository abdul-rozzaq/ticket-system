'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
} from '@/components/ui';
import { useToast } from '@/components/providers';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { Me } from '@/lib/types';
import { fmtDateTime } from '@/lib/utils';

type UserRow = Me;
interface Hours {
  tz: string;
  days: number[];
  from: string;
  to: string;
}
const DAYS = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'];
const defaultHours: Hours = { tz: 'Asia/Tashkent', days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' };

function CreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = React.useState({ username: '', displayName: '', role: 'STAFF', password: '' });
  const create = useMutation({
    mutationFn: () => api.post('users', f),
    onSuccess: () => {
      toast(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['users'] });
      setF({ username: '', displayName: '', role: 'STAFF', password: '' });
      onClose();
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('users.new')}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label={t('users.username')}>
          <Input
            value={f.username}
            onChange={(e) => setF({ ...f, username: e.target.value })}
            required
            minLength={3}
            autoComplete="off"
          />
        </Field>
        <Field label={t('users.displayName')}>
          <Input
            value={f.displayName}
            onChange={(e) => setF({ ...f, displayName: e.target.value })}
            required
          />
        </Field>
        <Field label={t('users.role')}>
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="STAFF">{t('role.STAFF')}</option>
            <option value="ADMIN">{t('role.ADMIN')}</option>
          </Select>
        </Field>
        <Field label={t('users.password')}>
          <Input
            type="password"
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
            required
            minLength={10}
            autoComplete="new-password"
          />
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

function EditModal({
  user,
  onClose,
  selfId,
}: {
  user: UserRow | null;
  onClose: () => void;
  selfId?: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = React.useState({
    displayName: '',
    role: 'STAFF',
    isActive: true,
    onDuty: false,
    available: true,
  });
  const [hours, setHours] = React.useState<Hours | null>(null);
  const [newPassword, setNewPassword] = React.useState('');
  const [code, setCode] = React.useState<{ code: string; expiresAt: string } | null>(null);
  React.useEffect(() => {
    if (!user) return;
    setF({
      displayName: user.displayName,
      role: user.role,
      isActive: user.isActive,
      onDuty: user.onDuty,
      available: user.available,
    });
    setHours((user.workingHours as Hours | null) ?? null);
    setNewPassword('');
    setCode(null);
  }, [user]);
  const save = useMutation({
    mutationFn: () => api.patch(`users/${user!.id}`, { ...f, ...(hours ? { workingHours: hours } : {}) }),
    onSuccess: () => {
      toast(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const reset = useMutation({
    mutationFn: () => api.post(`users/${user!.id}/reset-password`, { newPassword }),
    onSuccess: () => {
      toast(t('common.saved'));
      setNewPassword('');
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const link = useMutation({
    mutationFn: () => api.post<{ code: string; expiresAt: string }>(`users/${user!.id}/telegram-code`),
    onSuccess: setCode,
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const self = user?.id === selfId;
  return (
    <Modal open={!!user} onClose={onClose} title={user?.username ?? ''} wide>
      {user && (
        <div className="space-y-5">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Field label={t('users.displayName')}>
              <Input
                value={f.displayName}
                onChange={(e) => setF({ ...f, displayName: e.target.value })}
                required
              />
            </Field>
            <Field label={t('users.role')}>
              <Select value={f.role} disabled={self} onChange={(e) => setF({ ...f, role: e.target.value })}>
                <option value="STAFF">{t('role.STAFF')}</option>
                <option value="ADMIN">{t('role.ADMIN')}</option>
              </Select>
            </Field>
            <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
              <Switch
                checked={f.isActive}
                onChange={(v) => !self && setF({ ...f, isActive: v })}
                label={t('common.active')}
              />
              <Switch
                checked={f.onDuty}
                onChange={(v) => setF({ ...f, onDuty: v })}
                label={t('users.onDuty')}
              />
              <Switch
                checked={f.available}
                onChange={(v) => setF({ ...f, available: v })}
                label={t('users.available')}
              />
            </div>
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-xs font-medium text-muted-foreground">{t('users.hours')}</legend>
              <Switch
                checked={!!hours}
                onChange={(v) => setHours(v ? defaultHours : null)}
                label={t('common.active')}
              />
              {hours && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex gap-1" role="group" aria-label={t('users.days')}>
                    {DAYS.map((d, i) => (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={hours.days.includes(i)}
                        onClick={() =>
                          setHours({
                            ...hours,
                            days: hours.days.includes(i)
                              ? hours.days.filter((x) => x !== i)
                              : [...hours.days, i].sort(),
                          })
                        }
                        className={`rounded-md border px-2 py-1 text-xs ${hours.days.includes(i) ? 'bg-primary text-primary-foreground' : 'bg-card'}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <Field label={t('users.from')}>
                    <Input
                      type="time"
                      value={hours.from}
                      onChange={(e) => setHours({ ...hours, from: e.target.value })}
                    />
                  </Field>
                  <Field label={t('users.to')}>
                    <Input
                      type="time"
                      value={hours.to}
                      onChange={(e) => setHours({ ...hours, to: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </fieldset>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="submit" disabled={save.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>

          <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                reset.mutate();
              }}
            >
              <Field label={t('users.resetPassword')}>
                <Input
                  type="password"
                  minLength={10}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </Field>
              <Button type="submit" size="sm" variant="secondary" disabled={reset.isPending}>
                {t('users.resetPassword')}
              </Button>
            </form>
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">{t('users.telegram')}</div>
              <div className="text-sm">{user.telegramLinked ? t('users.linked') : t('users.notLinked')}</div>
              <Button size="sm" variant="secondary" onClick={() => link.mutate()} disabled={link.isPending}>
                {t('users.linkCode')}
              </Button>
              {code && (
                <div className="rounded-md border bg-muted p-2 text-sm">
                  <div className="font-mono text-lg font-semibold tracking-widest">{code.code}</div>
                  <div className="text-xs text-muted-foreground">{t('users.linkCodeHint')}</div>
                  <div className="text-xs text-muted-foreground">→ {fmtDateTime(code.expiresAt)}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function UsersPage() {
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<UserRow | null>(null);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('auth/me') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('users') });
  return (
    <>
      <PageHeader
        title={t('users.title')}
        actions={<Button onClick={() => setCreating(true)}>{t('users.new')}</Button>}
      />
      <ErrorBox error={users.error} />
      <Card>
        {users.isLoading ? (
          <Spinner />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('users.displayName')}</Th>
                <Th>{t('users.username')}</Th>
                <Th>{t('users.role')}</Th>
                <Th>{t('common.status')}</Th>
                <Th>{t('users.telegram')}</Th>
                <Th>{t('users.lastLogin')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(users.data ?? []).map((u) => (
                <tr key={u.id}>
                  <Td className="font-medium">{u.displayName}</Td>
                  <Td className="text-muted-foreground">{u.username}</Td>
                  <Td>{t(`role.${u.role}`)}</Td>
                  <Td className="space-x-1">
                    <Badge tone={u.isActive ? 'success' : 'muted'}>
                      {u.isActive ? t('common.active') : t('common.inactive')}
                    </Badge>
                    {u.onDuty && <Badge tone="primary">{t('users.onDuty')}</Badge>}
                  </Td>
                  <Td>{u.telegramLinked ? t('users.linked') : t('users.notLinked')}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{fmtDateTime(u.lastLoginAt)}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(u)}>
                      {t('common.edit')}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <CreateModal open={creating} onClose={() => setCreating(false)} />
      <EditModal user={editing} onClose={() => setEditing(null)} selfId={me.data?.id} />
    </>
  );
}
