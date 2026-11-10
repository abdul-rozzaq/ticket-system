'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASSIGNMENT_STRATEGIES, DEFAULT_SETTINGS } from '@tp/shared';
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
  Switch,
  Table,
  Tabs,
  Td,
  Th,
} from '@/components/ui';
import { useToast } from '@/components/providers';
import { api } from '@/lib/api';
import { t, type I18nKey } from '@/lib/i18n';

type Settings = Record<string, string | number | boolean>;
type Group = 'intake' | 'assignment' | 'reminders' | 'commands' | 'funnel' | 'sla' | 'kb';

const PREFIXES: Record<Group, string[]> = {
  intake: ['intake.'],
  assignment: ['assignment.'],
  reminders: ['reminders.'],
  commands: ['commands.', 'reactions.', 'activity.'],
  funnel: ['funnel.'],
  sla: ['sla.'],
  kb: ['kb.'],
};
const GROUP_LABEL: Record<Group, I18nKey> = {
  intake: 'settings.intake',
  assignment: 'settings.assignment',
  reminders: 'settings.reminders',
  commands: 'settings.commands',
  funnel: 'settings.folders',
  sla: 'settings.sla',
  kb: 'settings.kb',
};
const label = (k: string) => {
  const key = `setting.${k}` as I18nKey;
  const v = t(key);
  return v === key ? k : v;
};

function SettingsForm({ group, values }: { group: Group; values: Settings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const keys = Object.keys(DEFAULT_SETTINGS).filter((k) => PREFIXES[group].some((p) => k.startsWith(p)));
  const [draft, setDraft] = React.useState<Settings>({});
  React.useEffect(() => setDraft({}), [values]);
  const val = (k: string) => (k in draft ? draft[k] : values[k]);
  const save = useMutation({
    mutationFn: () => api.put('settings', draft),
    onSuccess: () => {
      toast(t('settings.saved'));
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const dirty = Object.keys(draft).length > 0;
  return (
    <Card>
      <CardBody>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {keys.map((k) => {
            const def = (DEFAULT_SETTINGS as Record<string, unknown>)[k];
            const v = val(k);
            if (typeof def === 'boolean')
              return (
                <div key={k} className="flex items-center sm:col-span-2">
                  <Switch checked={!!v} onChange={(x) => setDraft({ ...draft, [k]: x })} label={label(k)} />
                </div>
              );
            if (k === 'assignment.strategy')
              return (
                <Field key={k} label={label(k)}>
                  <Select value={String(v)} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}>
                    {ASSIGNMENT_STRATEGIES.map((s) => (
                      <option key={s} value={s}>
                        {t(`strategy.${s}` as I18nKey)}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            if (k === 'funnel.emptyFolders')
              return (
                <Field key={k} label={label(k)}>
                  <Select value={String(v)} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}>
                    <option value="placeholder">placeholder</option>
                    <option value="remove">remove</option>
                  </Select>
                </Field>
              );
            if (typeof def === 'number')
              return (
                <Field key={k} label={label(k)}>
                  <Input
                    type="number"
                    step="any"
                    value={String(v)}
                    onChange={(e) =>
                      e.target.value !== '' && setDraft({ ...draft, [k]: Number(e.target.value) })
                    }
                  />
                </Field>
              );
            return (
              <Field
                key={k}
                label={label(k)}
                className={k.endsWith('Keywords') || k.endsWith('stopWords') ? 'sm:col-span-2' : ''}
              >
                <Input
                  value={String(v ?? '')}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                />
              </Field>
            );
          })}
          {group === 'commands' && (
            <p className="text-xs text-muted-foreground sm:col-span-2">{t('settings.activityHint')}</p>
          )}
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={!dirty || save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

interface Stage {
  id: string;
  kind: string;
  title: string;
  position: number;
  isActive: boolean;
}
function StagesCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const stages = useQuery({ queryKey: ['stages'], queryFn: () => api.get<Stage[]>('funnel/stages') });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: Partial<Stage> }) => api.put(`funnel/stages/${v.id}`, v.body),
    onSuccess: () => {
      toast(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['stages'] });
      qc.invalidateQueries({ queryKey: ['board'] });
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  return (
    <Card className="mb-4">
      <CardHeader title={t('settings.funnel')} />
      <CardBody className="space-y-2">
        {(stages.data ?? []).map((s) => (
          <StageRow key={s.id} s={s} onSave={(body) => patch.mutate({ id: s.id, body })} />
        ))}
      </CardBody>
    </Card>
  );
}
function StageRow({ s, onSave }: { s: Stage; onSave: (b: Partial<Stage>) => void }) {
  const [title, setTitle] = React.useState(s.title);
  const structural = s.kind === 'NEW' || s.kind === 'CLOSED';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="muted" className="w-24 justify-center">
        {s.kind}
      </Badge>
      <Input
        className="max-w-xs"
        aria-label={t('settings.stageTitle')}
        value={title}
        maxLength={40}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={title === s.title || !title.trim()}
        onClick={() => onSave({ title })}
      >
        {t('common.save')}
      </Button>
      <Switch
        checked={s.isActive}
        onChange={(v) => !structural && onSave({ isActive: v })}
        label={t('common.active')}
      />
    </div>
  );
}

interface Policy {
  id: string;
  name: string;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  isDefault: boolean;
  _count?: { groups: number };
}
const blankPolicy = { name: '', firstResponseMinutes: 30, resolutionMinutes: 480, isDefault: false };
function PoliciesCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['sla-policies'], queryFn: () => api.get<Policy[]>('sla-policies') });
  const [editing, setEditing] = React.useState<Policy | 'new' | null>(null);
  const [f, setF] = React.useState(blankPolicy);
  React.useEffect(() => {
    if (editing && editing !== 'new')
      setF({
        name: editing.name,
        firstResponseMinutes: editing.firstResponseMinutes,
        resolutionMinutes: editing.resolutionMinutes,
        isDefault: editing.isDefault,
      });
    else setF(blankPolicy);
  }, [editing]);
  const save = useMutation({
    mutationFn: () =>
      editing === 'new' ? api.post('sla-policies', f) : api.put(`sla-policies/${(editing as Policy).id}`, f),
    onSuccess: () => {
      toast(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['sla-policies'] });
      setEditing(null);
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`sla-policies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sla-policies'] }),
    onError: (e: Error) => toast(e.message, 'err'),
  });
  return (
    <Card className="mt-4">
      <CardHeader
        title={t('settings.sla')}
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            {t('settings.newPolicy')}
          </Button>
        }
      />
      {!list.data ? (
        <Spinner />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('common.name')}</Th>
              <Th>{t('settings.firstResponse')}</Th>
              <Th>{t('settings.resolution')}</Th>
              <Th>{t('nav.groups')}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.data.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">
                  {p.name} {p.isDefault && <Badge tone="primary">{t('settings.default')}</Badge>}
                </Td>
                <Td className="tabular-nums">{p.firstResponseMinutes}</Td>
                <Td className="tabular-nums">{p.resolutionMinutes}</Td>
                <Td className="tabular-nums">{p._count?.groups ?? 0}</Td>
                <Td className="whitespace-nowrap text-right">
                  <Button size="sm" variant="secondary" className="mr-2" onClick={() => setEditing(p)}>
                    {t('common.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => confirm(t('common.confirmDelete')) && del.mutate(p.id)}
                  >
                    {t('common.delete')}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t('settings.newPolicy') : t('common.edit')}
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label={t('common.name')}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('settings.firstResponse')}>
              <Input
                type="number"
                min={1}
                max={10080}
                value={f.firstResponseMinutes}
                onChange={(e) => setF({ ...f, firstResponseMinutes: Number(e.target.value) })}
                required
              />
            </Field>
            <Field label={t('settings.resolution')}>
              <Input
                type="number"
                min={1}
                max={43200}
                value={f.resolutionMinutes}
                onChange={(e) => setF({ ...f, resolutionMinutes: Number(e.target.value) })}
                required
              />
            </Field>
          </div>
          <Switch
            checked={f.isDefault}
            onChange={(v) => setF({ ...f, isDefault: v })}
            label={t('settings.default')}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = React.useState<Group>('intake');
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('settings') });
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={(Object.keys(PREFIXES) as Group[]).map((g) => ({ value: g, label: t(GROUP_LABEL[g]) }))}
      />
      <ErrorBox error={settings.error} />
      {!settings.data ? (
        <Spinner />
      ) : (
        <>
          {tab === 'funnel' && <StagesCard />}
          <SettingsForm key={tab} group={tab} values={settings.data} />
          {tab === 'sla' && <PoliciesCard />}
        </>
      )}
    </>
  );
}
