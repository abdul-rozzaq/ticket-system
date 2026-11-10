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
  Spinner,
  Switch,
  Table,
  Td,
  Textarea,
  Th,
  Empty,
} from '@/components/ui';
import { useToast } from '@/components/providers';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { Me } from '@/lib/types';
import { splitCsv } from '@/lib/utils';

interface Tpl {
  id: string;
  category: string;
  title: string;
  bodyUz: string;
  bodyRu: string | null;
  keywords: string[];
  usageCount: number;
  isActive: boolean;
}
const blank = { category: 'boshqa', title: '', bodyUz: '', bodyRu: '', keywords: '', isActive: true };

export default function TemplatesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('auth/me') });
  const admin = me.data?.role === 'ADMIN';
  const list = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<Tpl[]>(`templates${admin ? '?all=true' : ''}`),
    enabled: !!me.data,
  });
  const [editing, setEditing] = React.useState<Tpl | 'new' | null>(null);
  const [f, setF] = React.useState(blank);
  React.useEffect(() => {
    if (editing && editing !== 'new')
      setF({
        category: editing.category,
        title: editing.title,
        bodyUz: editing.bodyUz,
        bodyRu: editing.bodyRu ?? '',
        keywords: editing.keywords.join(', '),
        isActive: editing.isActive,
      });
    else setF(blank);
  }, [editing]);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        category: f.category,
        title: f.title,
        bodyUz: f.bodyUz,
        bodyRu: f.bodyRu || null,
        keywords: splitCsv(f.keywords),
        isActive: f.isActive,
      };
      return editing === 'new'
        ? api.post('templates', body)
        : api.patch(`templates/${(editing as Tpl).id}`, body);
    },
    onSuccess: () => {
      toast(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['templates'] });
      setEditing(null);
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
    onError: (e: Error) => toast(e.message, 'err'),
  });
  return (
    <>
      <PageHeader
        title={t('tpl.title')}
        actions={
          admin ? (
            <Button onClick={() => setEditing('new')}>{t('tpl.new')}</Button>
          ) : (
            <Badge>{t('common.readOnly')}</Badge>
          )
        }
      />
      <ErrorBox error={list.error} />
      <Card>
        {list.isLoading ? (
          <Spinner />
        ) : !list.data?.length ? (
          <Empty />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.title')}</Th>
                <Th>{t('tpl.category')}</Th>
                <Th>{t('tpl.body')}</Th>
                <Th>{t('tpl.usage')}</Th>
                {admin && <Th />}
              </tr>
            </thead>
            <tbody>
              {list.data.map((x) => (
                <tr key={x.id} className={x.isActive ? '' : 'opacity-60'}>
                  <Td className="font-medium">{x.title}</Td>
                  <Td>
                    <Badge>{x.category}</Badge>
                  </Td>
                  <Td className="max-w-xl whitespace-pre-wrap text-muted-foreground">{x.bodyUz}</Td>
                  <Td className="tabular-nums">{x.usageCount}</Td>
                  {admin && (
                    <Td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="secondary" className="mr-2" onClick={() => setEditing(x)}>
                        {t('common.edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => confirm(t('common.confirmDelete')) && del.mutate(x.id)}
                      >
                        {t('common.delete')}
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t('tpl.new') : t('common.edit')}
        wide
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('common.title')}>
              <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />
            </Field>
            <Field label={t('tpl.category')}>
              <Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} required />
            </Field>
          </div>
          <Field label={t('tpl.body')} hint={t('tpl.vars')}>
            <Textarea
              className="min-h-32"
              value={f.bodyUz}
              onChange={(e) => setF({ ...f, bodyUz: e.target.value })}
              required
            />
          </Field>
          <Field label={t('tpl.bodyRu')}>
            <Textarea value={f.bodyRu} onChange={(e) => setF({ ...f, bodyRu: e.target.value })} />
          </Field>
          <Field label={t('tpl.keywords')}>
            <Input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} />
          </Field>
          <Switch
            checked={f.isActive}
            onChange={(v) => setF({ ...f, isActive: v })}
            label={t('common.active')}
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
    </>
  );
}
