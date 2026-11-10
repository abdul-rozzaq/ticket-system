'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Empty,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  Tabs,
  Td,
  Th,
} from '@/components/ui';
import { useToast } from '@/components/providers';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/utils';

type Tab = 'userbot' | 'bot' | 'folders';

// ------------------------------------------------------------------ userbot
interface UbStatus {
  status: string;
  phone: string | null;
  info: Record<string, unknown> | null;
  hasSession: boolean;
  lastActivityAt: string | null;
  alive: boolean;
  pendingCommands: number;
}

function UserbotTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const st = useQuery({
    queryKey: ['userbot-status'],
    queryFn: () => api.get<UbStatus>('telegram/userbot/status'),
    refetchInterval: 4000,
  });
  const [phone, setPhone] = React.useState('');
  const [code, setCode] = React.useState('');
  const [pw, setPw] = React.useState('');
  const call = (path: string, body?: unknown, after?: () => void) =>
    api
      .post(path, body)
      .then(() => {
        qc.invalidateQueries({ queryKey: ['userbot-status'] });
        after?.();
      })
      .catch((e: Error) => toast(e.message, 'err'));
  const s = st.data;
  const connected = s?.status === 'CONNECTED' && s.hasSession;
  const err = s?.info && typeof s.info.error === 'string' ? s.info.error : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title={t('tg.userbot')} />
        <CardBody className="space-y-2 text-sm">
          {!s ? (
            <Spinner />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Badge tone={s.alive ? 'success' : 'danger'}>
                  {s.alive ? t('tg.alive') : t('tg.notAlive')}
                </Badge>
                <Badge tone={connected ? 'success' : 'warning'}>{s.status}</Badge>
              </div>
              {s.phone && <div className="text-muted-foreground">{s.phone}</div>}
              <div className="text-muted-foreground">
                {t('tg.lastActivity')}: {fmtDateTime(s.lastActivityAt)}
              </div>
              {err && <ErrorBox error={err} />}
              {connected && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => confirm(t('tg.logout') + '?') && call('telegram/userbot/logout')}
                >
                  {t('tg.logout')}
                </Button>
              )}
            </>
          )}
        </CardBody>
      </Card>
      {!connected && (
        <Card>
          <CardHeader title={t('tg.loginHint')} />
          <CardBody className="space-y-4">
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                call('telegram/userbot/login/phone', { phone: phone.trim() }, () => setPhone(''));
              }}
            >
              <Field label={t('tg.phone')} className="flex-1">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+998901234567"
                  pattern="\+?\d{7,15}"
                  required
                  autoComplete="off"
                />
              </Field>
              <Button type="submit">{t('tg.sendCode')}</Button>
            </form>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                call('telegram/userbot/login/code', { code: code.trim() }, () => setCode(''));
              }}
            >
              <Field label={t('tg.code')} className="flex-1">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  minLength={3}
                  maxLength={10}
                  required
                  autoComplete="off"
                />
              </Field>
              <Button type="submit">{t('tg.submitCode')}</Button>
            </form>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                call('telegram/userbot/login/password', { password: pw }, () => setPw(''));
              }}
            >
              <Field label={t('tg.password')} className="flex-1">
                <Input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  required
                  autoComplete="off"
                />
              </Field>
              <Button type="submit">{t('tg.submitPassword')}</Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ bot
interface BotCfg {
  hasToken: boolean;
  internalChatId: string | null;
  escalationUserId: string | null;
  status: { state: string; detail: string | null; at: string | null; alive: boolean };
}
function BotTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const bot = useQuery({
    queryKey: ['bot'],
    queryFn: () => api.get<BotCfg>('telegram/bot'),
    refetchInterval: 15_000,
  });
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ id: string; displayName: string; isActive: boolean }[]>('users'),
  });
  const [token, setToken] = React.useState('');
  const [chat, setChat] = React.useState('');
  const [esc, setEsc] = React.useState('');
  React.useEffect(() => {
    if (bot.data) {
      setChat(bot.data.internalChatId ?? '');
      setEsc(bot.data.escalationUserId ?? '');
    }
  }, [bot.data]);
  const save = useMutation({
    mutationFn: () =>
      api.put('telegram/bot', {
        ...(token ? { token } : {}),
        internalChatId: chat.trim() || null,
        escalationUserId: esc || null,
      }),
    onSuccess: () => {
      toast(t('common.saved'));
      setToken('');
      qc.invalidateQueries({ queryKey: ['bot'] });
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string }>('telegram/bot/test'),
    onSuccess: (r) => (r.ok ? toast(t('tg.testSent')) : toast(r.error ?? t('common.error'), 'err')),
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const b = bot.data;
  return (
    <Card className="max-w-2xl">
      <CardHeader title={t('tg.bot')} />
      <CardBody>
        {!b ? (
          <Spinner />
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="flex items-center gap-2 text-sm">
              <Badge tone={b.status.state === 'CONNECTED' && b.status.alive ? 'success' : 'warning'}>
                {b.status.state}
              </Badge>
              {b.status.detail && <span className="text-muted-foreground">{b.status.detail}</span>}
            </div>
            <Field
              label={t('tg.token')}
              hint={b.hasToken ? `${t('tg.hasToken')}. ${t('tg.tokenHint')}` : t('tg.tokenHint')}
            >
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                placeholder={b.hasToken ? '••••••••' : '123456:ABC…'}
              />
            </Field>
            <Field label={t('tg.chatId')}>
              <Input
                value={chat}
                onChange={(e) => setChat(e.target.value)}
                placeholder="-1001234567890"
                pattern="-?\d{5,20}|"
              />
            </Field>
            <Field label={t('tg.escalation')}>
              <Select value={esc} onChange={(e) => setEsc(e.target.value)}>
                <option value="">—</option>
                {(users.data ?? [])
                  .filter((u) => u.isActive)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => test.mutate()}
                disabled={test.isPending || !b.internalChatId}
              >
                {t('tg.sendTest')}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

// ------------------------------------------------------------------ folders
interface FolderStatus {
  enabled: boolean;
  userbotOnline: boolean;
  folders: { key: string; telegramFilterId: number; title: string; chatCount: number }[];
  lastRun: {
    at: string;
    trigger: string;
    status: string;
    ops: { create: number; update: number; delete: number } | null;
    degraded: boolean;
    warnings: string[];
    error: string | null;
    ms: number;
  } | null;
}
interface Report {
  status: string;
  warnings: string[];
  error?: string;
  plan?: {
    ops: { op: string; key: string; title?: string; chatKeys?: string[] }[];
    warnings: string[];
    degraded: boolean;
  };
  limits?: { maxFolders: number; maxChatsPerFolder: number; premium: boolean; foreignFolders: number };
}
interface LogRow {
  id: string;
  runId: string;
  trigger: string;
  op: string;
  key: string;
  ok: boolean;
  error: string | null;
  createdAt: string;
}
function FoldersTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const st = useQuery({
    queryKey: ['folders-status'],
    queryFn: () => api.get<FolderStatus>('telegram/folders'),
  });
  const log = useQuery({
    queryKey: ['folders-log'],
    queryFn: () => api.get<LogRow[]>('telegram/folders/log?limit=50'),
  });
  const [report, setReport] = React.useState<Report | null>(null);
  const preview = useMutation({
    mutationFn: () => api.get<Report>('telegram/folders/preview'),
    onSuccess: setReport,
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const sync = useMutation({
    mutationFn: () => api.post<Report>('telegram/folders/sync'),
    onSuccess: (r) => {
      setReport(r);
      toast(r.status);
      qc.invalidateQueries({ queryKey: ['folders-status'] });
      qc.invalidateQueries({ queryKey: ['folders-log'] });
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const s = st.data;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t('tg.folders')}
          actions={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => preview.mutate()}
                disabled={preview.isPending}
              >
                {t('tg.preview')}
              </Button>
              <Button size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
                {t('tg.sync')}
              </Button>
            </div>
          }
        />
        <CardBody className="space-y-3 text-sm">
          {!s ? (
            <Spinner />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={s.enabled ? 'success' : 'muted'}>
                  {s.enabled ? t('common.active') : t('common.inactive')}
                </Badge>
                <Badge tone={s.userbotOnline ? 'success' : 'danger'}>
                  {t('tg.userbot')}: {s.userbotOnline ? t('tg.alive') : t('tg.notAlive')}
                </Badge>
                {s.lastRun && (
                  <span className="text-muted-foreground">
                    {fmtDateTime(s.lastRun.at)} · {s.lastRun.status} · {s.lastRun.trigger}
                    {s.lastRun.ops &&
                      ` · +${s.lastRun.ops.create} ~${s.lastRun.ops.update} −${s.lastRun.ops.delete}`}
                  </span>
                )}
              </div>
              {s.lastRun?.error && <ErrorBox error={s.lastRun.error} />}
              {s.folders.length ? (
                <div className="flex flex-wrap gap-2">
                  {s.folders.map((f) => (
                    <Badge key={f.key} tone="primary">
                      {f.title} · {f.chatCount} {t('tg.chats')}
                    </Badge>
                  ))}
                </div>
              ) : (
                <Empty />
              )}
            </>
          )}
        </CardBody>
      </Card>

      {report && (
        <Card>
          <CardHeader title={`${t('tg.plan')}: ${report.status}`} />
          <CardBody className="space-y-2 text-sm">
            {report.limits && (
              <div className="text-muted-foreground">
                {t('tg.limits')}: {report.limits.maxFolders} / {report.limits.maxChatsPerFolder} ·{' '}
                {t('tg.foreign')}: {report.limits.foreignFolders} · {t('tg.premium')}:{' '}
                {report.limits.premium ? t('common.yes') : t('common.no')}
                {!report.limits.premium && ` — ${t('tg.premiumHint')}`}
              </div>
            )}
            {report.error && <ErrorBox error={report.error} />}
            {(report.plan?.warnings ?? report.warnings).map((w, i) => (
              <div key={i} className="rounded-md bg-warning/15 px-2 py-1">
                {w}
              </div>
            ))}
            {report.plan && !report.plan.ops.length && (
              <div className="text-muted-foreground">{t('tg.noChanges')}</div>
            )}
            {report.plan?.ops.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <Badge tone={o.op === 'delete' ? 'danger' : o.op === 'create' ? 'success' : 'primary'}>
                  {o.op}
                </Badge>
                <span className="font-medium">{o.title ?? o.key}</span>
                {o.chatKeys && (
                  <span className="text-muted-foreground">
                    {o.chatKeys.length} {t('tg.chats')}
                  </span>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t('tg.log')} />
        {!log.data?.length ? (
          <Empty />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.date')}</Th>
                <Th>Op</Th>
                <Th>Key</Th>
                <Th>{t('common.status')}</Th>
              </tr>
            </thead>
            <tbody>
              {log.data.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.createdAt)}</Td>
                  <Td>{r.op}</Td>
                  <Td className="font-mono text-xs">{r.key}</Td>
                  <Td>
                    {r.ok ? (
                      <Badge tone="success">OK</Badge>
                    ) : (
                      <span className="text-destructive">{r.error ?? 'ERR'}</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

export default function TelegramPage() {
  const [tab, setTab] = React.useState<Tab>('userbot');
  return (
    <>
      <PageHeader title={t('tg.title')} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'userbot', label: t('tg.userbot') },
          { value: 'bot', label: t('tg.bot') },
          { value: 'folders', label: t('tg.folders') },
        ]}
      />
      {tab === 'userbot' && <UserbotTab />}
      {tab === 'bot' && <BotTab />}
      {tab === 'folders' && <FoldersTab />}
    </>
  );
}
