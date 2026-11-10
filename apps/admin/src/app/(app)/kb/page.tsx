'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SYSTEM_TYPES } from '@tp/shared';
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
  Modal,
  PageHeader,
  Pager,
  Select,
  Spinner,
  Stat,
  Tabs,
  Textarea,
} from '@/components/ui';
import { useToast } from '@/components/providers';
import { api, qs } from '@/lib/api';
import { t, type I18nKey } from '@/lib/i18n';
import type { Me, Paged } from '@/lib/types';
import { splitCsv } from '@/lib/utils';

interface Article {
  id: string;
  status: 'DRAFT' | 'APPROVED' | 'REJECTED';
  lang: string;
  systemType: string;
  category: string;
  problem: string;
  solution: string;
  tags: string[];
  sourceTicketId: string | null;
  createdById: string | null;
  sentUnchanged: number;
  sentEdited: number;
  useCount: number;
}
interface KbStats {
  articles: Record<string, number>;
  drafts: {
    total: number;
    hitRate: number | null;
    notFound: number;
    unchangedRate: number | null;
    sentUnchanged: number;
    sentEdited: number;
  };
  topArticles: { id: string; problem: string; useCount: number }[];
}
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const blank = { problem: '', solution: '', systemType: 'OTHER', lang: 'uz', category: 'other', tags: '' };

export default function KbPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('auth/me') });
  const admin = me.data?.role === 'ADMIN';
  const [tab, setTab] = React.useState<'APPROVED' | 'DRAFT' | 'REJECTED'>('APPROVED');
  const [q, setQ] = React.useState('');
  const [system, setSystem] = React.useState('');
  const [page, setPage] = React.useState(1);
  const status = admin ? tab : 'APPROVED';
  const list = useQuery({
    queryKey: ['kb', status, q, system, page],
    enabled: !!me.data,
    queryFn: () => api.get<Paged<Article>>(`kb${qs({ status, q, systemType: system, page, pageSize: 25 })}`),
    placeholderData: (p) => p,
  });
  const stats = useQuery({
    queryKey: ['kb-stats'],
    queryFn: () => api.get<KbStats>('kb/stats'),
    enabled: admin,
  });
  const [editing, setEditing] = React.useState<Article | 'new' | null>(null);
  const [f, setF] = React.useState(blank);
  React.useEffect(() => {
    if (editing && editing !== 'new')
      setF({
        problem: editing.problem,
        solution: editing.solution,
        systemType: editing.systemType,
        lang: editing.lang,
        category: editing.category,
        tags: editing.tags.join(', '),
      });
    else setF(blank);
  }, [editing]);
  const inval = () => {
    qc.invalidateQueries({ queryKey: ['kb'] });
    qc.invalidateQueries({ queryKey: ['kb-stats'] });
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, tags: splitCsv(f.tags) };
      return editing === 'new' ? api.post('kb', body) : api.patch(`kb/${(editing as Article).id}`, body);
    },
    onSuccess: () => {
      toast(t('common.saved'));
      inval();
      setEditing(null);
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const act = useMutation({
    mutationFn: (v: { id: string; op: 'approve' | 'reject' | 'delete' }) =>
      v.op === 'delete' ? api.del(`kb/${v.id}`) : api.post(`kb/${v.id}/${v.op}`),
    onSuccess: inval,
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const reindex = useMutation({
    mutationFn: () => api.post('kb/reindex'),
    onSuccess: () => toast(t('kb.reindexed')),
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const drafts = stats.data?.articles.DRAFT ?? 0;

  return (
    <>
      <PageHeader
        title={t('kb.title')}
        actions={
          admin ? (
            <>
              <Button variant="secondary" onClick={() => reindex.mutate()} disabled={reindex.isPending}>
                {t('kb.reindex')}
              </Button>
              <Button onClick={() => setEditing('new')}>{t('kb.new')}</Button>
            </>
          ) : (
            <Badge>{t('common.readOnly')}</Badge>
          )
        }
      />
      {admin && stats.data && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label={t('kb.hitRate')}
            value={pct(stats.data.drafts.hitRate)}
            sub={`${t('kb.drafts.total')}: ${stats.data.drafts.total}`}
          />
          <Stat label={t('kb.notFound')} value={stats.data.drafts.notFound} />
          <Stat
            label={t('kb.unchangedRate')}
            value={pct(stats.data.drafts.unchangedRate)}
            sub={`${stats.data.drafts.sentUnchanged} / ${stats.data.drafts.sentEdited}`}
          />
          <Stat label={t('kb.drafts')} value={drafts} tone={drafts ? 'warning' : undefined} />
        </div>
      )}
      {admin && (
        <Tabs
          value={tab}
          onChange={(v) => {
            setTab(v);
            setPage(1);
          }}
          items={[
            { value: 'APPROVED', label: `${t('kb.approved')} (${stats.data?.articles.APPROVED ?? 0})` },
            { value: 'DRAFT', label: `${t('kb.drafts')} (${drafts})` },
            { value: 'REJECTED', label: `${t('kb.rejected')} (${stats.data?.articles.REJECTED ?? 0})` },
          ]}
        />
      )}
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Input
          placeholder={t('common.search')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <Select
          value={system}
          onChange={(e) => {
            setSystem(e.target.value);
            setPage(1);
          }}
        >
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
      {list.isLoading ? (
        <Spinner />
      ) : !list.data?.items.length ? (
        <Card>
          <Empty />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.data.items.map((a) => (
            <Card key={a.id}>
              <CardBody className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-medium">{a.problem}</h3>
                  <div className="flex flex-wrap gap-1">
                    <Badge>{t(`system.${a.systemType}` as I18nKey)}</Badge>
                    <Badge tone="muted">{a.lang}</Badge>
                    {a.useCount > 0 && (
                      <Badge tone="primary">
                        {t('kb.uses')}: {a.useCount}
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{a.solution}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="flex flex-wrap gap-1">
                    {a.tags.map((x) => (
                      <Badge key={x} tone="muted">
                        {x}
                      </Badge>
                    ))}
                    {a.sourceTicketId && (
                      <Link href={`/tickets/${a.sourceTicketId}`} className="text-primary hover:underline">
                        {t('kb.source')}
                      </Link>
                    )}
                  </span>
                  {admin && (
                    <span className="flex gap-2">
                      {a.status === 'DRAFT' && (
                        <>
                          <Button size="sm" onClick={() => act.mutate({ id: a.id, op: 'approve' })}>
                            {t('kb.approve')}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => act.mutate({ id: a.id, op: 'reject' })}
                          >
                            {t('kb.reject')}
                          </Button>
                        </>
                      )}
                      {a.status === 'REJECTED' && (
                        <Button size="sm" onClick={() => act.mutate({ id: a.id, op: 'approve' })}>
                          {t('kb.approve')}
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                        {t('common.edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          confirm(t('common.confirmDelete')) && act.mutate({ id: a.id, op: 'delete' })
                        }
                      >
                        {t('common.delete')}
                      </Button>
                    </span>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
          <Pager page={page} pageSize={25} total={list.data.total} onPage={setPage} />
        </div>
      )}
      {admin && stats.data && stats.data.topArticles.length > 0 && (
        <Card className="mt-6">
          <CardHeader title={t('kb.uses')} />
          <CardBody className="space-y-1 text-sm">
            {stats.data.topArticles.map((a) => (
              <div key={a.id} className="flex justify-between gap-3">
                <span className="truncate">{a.problem}</span>
                <span className="tabular-nums text-muted-foreground">{a.useCount}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t('kb.new') : t('common.edit')}
        wide
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label={t('kb.problem')}>
            <Textarea
              value={f.problem}
              onChange={(e) => setF({ ...f, problem: e.target.value })}
              required
              minLength={5}
              maxLength={500}
            />
          </Field>
          <Field label={t('kb.solution')}>
            <Textarea
              className="min-h-32"
              value={f.solution}
              onChange={(e) => setF({ ...f, solution: e.target.value })}
              required
              minLength={5}
              maxLength={4000}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('common.system')}>
              <Select value={f.systemType} onChange={(e) => setF({ ...f, systemType: e.target.value })}>
                {SYSTEM_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {t(`system.${s}` as I18nKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.language')}>
              <Select value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })}>
                <option value="uz">O‘zbekcha</option>
                <option value="ru">Русский</option>
              </Select>
            </Field>
            <Field label={t('kb.category')}>
              <Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} required />
            </Field>
          </div>
          <Field label={t('kb.tags')}>
            <Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
          </Field>
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
    </>
  );
}
