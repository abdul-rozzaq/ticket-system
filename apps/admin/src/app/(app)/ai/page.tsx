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
  Switch,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui';
import { useToast } from '@/components/providers';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/utils';

interface AiSettings {
  provider: {
    type: 'ANTHROPIC' | 'OPENAI_COMPATIBLE';
    name: string;
    baseUrl: string | null;
    hasKey: boolean;
    keyHint: string | null;
  } | null;
  models: { classify: string | null; draft: string | null; embedding: string | null; summary: string | null };
  temperature: number;
  maxTokens: number;
  monthlyBudgetUsd: number | null;
  hardStop: boolean;
  maskPolicy: 'ALWAYS' | 'ASK';
  prompts: Record<string, string>;
  defaultPrompts: Record<string, string>;
  monthSpendUsd: number;
}
interface Usage {
  items: {
    id: string;
    task: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    latencyMs: number | null;
    ok: boolean;
    createdAt: string;
  }[];
  byTask: {
    task: string;
    _count: number;
    _sum: { costUsd: number | null; inputTokens: number | null; outputTokens: number | null };
  }[];
  monthSpendUsd: number;
}

function ProviderCard({ s }: { s: AiSettings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = React.useState({ type: 'OPENAI_COMPATIBLE', name: 'default', baseUrl: '', apiKey: '' });
  React.useEffect(() => {
    if (s.provider)
      setF({ type: s.provider.type, name: s.provider.name, baseUrl: s.provider.baseUrl ?? '', apiKey: '' });
  }, [s.provider]);
  const save = useMutation({
    mutationFn: () =>
      api.put('ai/provider', {
        type: f.type,
        name: f.name,
        baseUrl: f.baseUrl.trim() || null,
        ...(f.apiKey ? { apiKey: f.apiKey } : {}),
      }),
    onSuccess: () => {
      toast(t('common.saved'));
      setF((x) => ({ ...x, apiKey: '' }));
      qc.invalidateQueries({ queryKey: ['ai-settings'] });
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; ms: number; error?: string }>('ai/test'),
    onSuccess: (r) =>
      r.ok ? toast(`${t('ai.ok')} · ${r.ms} ms`) : toast(r.error ?? t('common.error'), 'err'),
    onError: (e: Error) => toast(e.message, 'err'),
  });
  return (
    <Card>
      <CardHeader title={t('ai.provider')} />
      <CardBody>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label={t('ai.type')}>
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="OPENAI_COMPATIBLE">OpenAI-compatible</option>
              <option value="ANTHROPIC">Anthropic</option>
            </Select>
          </Field>
          <Field label={t('common.name')}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </Field>
          <Field label={t('ai.baseUrl')} className="sm:col-span-2">
            <Input
              value={f.baseUrl}
              onChange={(e) => setF({ ...f, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              type="url"
            />
          </Field>
          <Field
            label={t('ai.apiKey')}
            hint={s.provider?.hasKey ? `${s.provider.keyHint ?? ''} · ${t('ai.keyHint')}` : t('ai.keyHint')}
            className="sm:col-span-2"
          >
            <Input
              type="password"
              value={f.apiKey}
              onChange={(e) => setF({ ...f, apiKey: e.target.value })}
              autoComplete="off"
              minLength={8}
            />
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button
              variant="secondary"
              onClick={() => test.mutate()}
              disabled={test.isPending || !s.provider}
            >
              {t('ai.testConnection')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function ModelsCard({ s }: { s: AiSettings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = React.useState({
    classifyModel: '',
    draftModel: '',
    summaryModel: '',
    embeddingModel: '',
    temperature: 0.2,
    maxTokens: 1024,
    monthlyBudgetUsd: 0,
    hardStop: false,
    maskPolicy: 'ALWAYS',
  });
  React.useEffect(() => {
    setF({
      classifyModel: s.models.classify ?? '',
      draftModel: s.models.draft ?? '',
      summaryModel: s.models.summary ?? '',
      embeddingModel: s.models.embedding ?? '',
      temperature: s.temperature,
      maxTokens: s.maxTokens,
      monthlyBudgetUsd: s.monthlyBudgetUsd ?? 0,
      hardStop: s.hardStop,
      maskPolicy: s.maskPolicy,
    });
  }, [s]);
  const save = useMutation({
    mutationFn: () => api.put('ai/settings', f),
    onSuccess: () => {
      toast(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['ai-settings'] });
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const anthropic = s.provider?.type === 'ANTHROPIC';
  return (
    <Card>
      <CardHeader title={t('ai.models')} />
      <CardBody>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label={t('ai.classifyModel')}>
            <Input value={f.classifyModel} onChange={(e) => setF({ ...f, classifyModel: e.target.value })} />
          </Field>
          <Field label={t('ai.draftModel')}>
            <Input value={f.draftModel} onChange={(e) => setF({ ...f, draftModel: e.target.value })} />
          </Field>
          <Field label={t('ai.summaryModel')}>
            <Input value={f.summaryModel} onChange={(e) => setF({ ...f, summaryModel: e.target.value })} />
          </Field>
          <Field label={t('ai.embeddingModel')} hint={t('ai.embeddingHint')}>
            <Input
              value={f.embeddingModel}
              onChange={(e) => setF({ ...f, embeddingModel: e.target.value })}
            />
          </Field>
          <Field label={t('ai.temperature')} hint={anthropic ? t('ai.temperatureNote') : undefined}>
            <Input
              type="number"
              step="0.1"
              min={0}
              max={2}
              value={f.temperature}
              onChange={(e) => setF({ ...f, temperature: Number(e.target.value) })}
            />
          </Field>
          <Field label={t('ai.maxTokens')}>
            <Input
              type="number"
              min={64}
              max={8192}
              value={f.maxTokens}
              onChange={(e) => setF({ ...f, maxTokens: Number(e.target.value) })}
            />
          </Field>
          <Field label={t('ai.budget')}>
            <Input
              type="number"
              step="0.5"
              min={0}
              value={f.monthlyBudgetUsd}
              onChange={(e) => setF({ ...f, monthlyBudgetUsd: Number(e.target.value) })}
            />
          </Field>
          <Field label={t('ai.maskPolicy')}>
            <Select value={f.maskPolicy} onChange={(e) => setF({ ...f, maskPolicy: e.target.value })}>
              <option value="ALWAYS">ALWAYS</option>
              <option value="ASK">ASK</option>
            </Select>
          </Field>
          <div className="flex items-center sm:col-span-2">
            <Switch
              checked={f.hardStop}
              onChange={(v) => setF({ ...f, hardStop: v })}
              label={t('ai.hardStop')}
            />
          </div>
          <div className="flex items-center justify-between sm:col-span-2">
            <span className="text-sm text-muted-foreground">
              {t('ai.spend')}: <b>${s.monthSpendUsd.toFixed(4)}</b>
            </span>
            <Button type="submit" disabled={save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function PromptsCard({ s }: { s: AiSettings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  React.useEffect(() => setDraft({}), [s.prompts]);
  const save = useMutation({
    mutationFn: (task: string) => api.put('ai/settings', { prompts: { [task]: draft[task] } }),
    onSuccess: () => {
      toast(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['ai-settings'] });
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const reset = useMutation({
    mutationFn: (task: string) => api.post(`ai/settings/reset-prompt/${task}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-settings'] }),
    onError: (e: Error) => toast(e.message, 'err'),
  });
  return (
    <Card>
      <CardHeader title={t('ai.prompts')} />
      <CardBody className="space-y-4">
        {Object.keys(s.defaultPrompts).map((task) => {
          const value = draft[task] ?? s.prompts[task] ?? '';
          const custom = s.prompts[task] !== s.defaultPrompts[task];
          return (
            <div key={task} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {task} {custom && <Badge tone="primary">custom</Badge>}
                </span>
                <span className="flex gap-2">
                  <Button size="sm" variant="ghost" disabled={!custom} onClick={() => reset.mutate(task)}>
                    {t('ai.resetPrompt')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={draft[task] === undefined || save.isPending}
                    onClick={() => save.mutate(task)}
                  >
                    {t('common.save')}
                  </Button>
                </span>
              </div>
              <Textarea
                className="min-h-40 font-mono text-xs"
                value={value}
                maxLength={8000}
                onChange={(e) => setDraft({ ...draft, [task]: e.target.value })}
              />
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

function UsageCard() {
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: () => api.get<Usage>('ai/usage?days=30') });
  return (
    <Card>
      <CardHeader title={t('ai.usage')} />
      {!usage.data ? (
        <Spinner />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {usage.data.byTask.map((b) => (
              <Badge key={b.task} tone="primary">
                {b.task}: {b._count} · ${Number(b._sum.costUsd ?? 0).toFixed(4)} ·{' '}
                {(b._sum.inputTokens ?? 0) + (b._sum.outputTokens ?? 0)} tok
              </Badge>
            ))}
          </div>
          {!usage.data.items.length ? (
            <Empty />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('ai.task')}</Th>
                  <Th>{t('ai.model')}</Th>
                  <Th>{t('ai.tokens')}</Th>
                  <Th>{t('ai.latency')}</Th>
                  <Th>{t('ai.cost')}</Th>
                  <Th>{t('common.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {usage.data.items.slice(0, 50).map((u) => (
                  <tr key={u.id}>
                    <Td className="whitespace-nowrap text-muted-foreground">{fmtDateTime(u.createdAt)}</Td>
                    <Td>{u.task}</Td>
                    <Td className="font-mono text-xs">{u.model}</Td>
                    <Td className="tabular-nums">{u.inputTokens + u.outputTokens}</Td>
                    <Td className="tabular-nums">{u.latencyMs ?? '—'} ms</Td>
                    <Td className="tabular-nums">
                      {u.costUsd != null ? `$${Number(u.costUsd).toFixed(5)}` : '—'}
                    </Td>
                    <Td>{u.ok ? <Badge tone="success">OK</Badge> : <Badge tone="danger">ERR</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </Card>
  );
}

export default function AiPage() {
  const q = useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get<AiSettings>('ai/settings') });
  return (
    <>
      <PageHeader title={t('ai.title')} />
      <ErrorBox error={q.error} />
      {!q.data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <ProviderCard s={q.data} />
          <ModelsCard s={q.data} />
          <PromptsCard s={q.data} />
          <UsageCard />
        </div>
      )}
    </>
  );
}
