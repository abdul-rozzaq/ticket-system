'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorBox,
  PageHeader,
  Select,
  Spinner,
  Stat,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { useToast } from '@/components/providers';
import { api } from '@/lib/api';
import { t, type I18nKey } from '@/lib/i18n';
import { fmtMinutes } from '@/lib/utils';

interface Overview {
  totals: { opened: number; closed: number; open: number; overdue: number };
  firstResponse: { avgMin: number | null; medianMin: number | null; answered: number };
  resolution: { avgMin: number | null; medianMin: number | null };
  sla: { measured: number; met: number; compliancePct: number | null };
  byStaff: {
    userId: string;
    name: string;
    assigned: number;
    closed: number;
    avgResolutionMin: number | null;
  }[];
  byClient: { clientGroupId: string; company: string; tickets: number; avgFirstResponseMin: number | null }[];
  bySystem: { systemType: string; count: number }[];
  byHour: number[];
  daily: { date: string; opened: number; closed: number }[];
  ai: {
    filteredByAi: number;
    falseNegatives: number;
    falseNegativeRate: number | null;
    needsReview: number;
    needsReviewRate: number | null;
  };
}

/** Minimal dependency-free bar chart (SVG). `series` are drawn side by side per label. */
function Bars({
  labels,
  series,
  height = 140,
}: {
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  height?: number;
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const slot = 100 / labels.length;
  const bw = (slot * 0.8) / series.length;
  return (
    <div>
      <svg
        viewBox={`0 0 100 ${height / 4}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={series.map((s) => s.name).join(', ')}
      >
        {labels.map((_, i) =>
          series.map((s, j) => {
            const h = (s.values[i] / max) * (height / 4 - 2);
            return (
              <rect
                key={`${i}-${j}`}
                x={i * slot + slot * 0.1 + j * bw}
                y={height / 4 - h}
                width={bw}
                height={h}
                fill={s.color}
                rx={0.3}
              >
                <title>{`${labels[i]} · ${s.name}: ${s.values[i]}`}</title>
              </rect>
            );
          }),
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
      <div className="mt-1 flex gap-3 text-xs">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1">
            <i className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} /> {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function StatsPage() {
  const toast = useToast();
  const [days, setDays] = React.useState(30);
  const q = useQuery({
    queryKey: ['stats', days],
    queryFn: () => api.get<Overview>(`stats/overview?days=${days}`),
  });
  async function exportCsv() {
    try {
      const blob = await api.blob(`stats/export.csv?days=${days}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tickets-${days}d.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }
  const o = q.data;
  return (
    <>
      <PageHeader
        title={t('stats.title')}
        actions={
          <>
            <Select
              className="w-36"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              aria-label={t('stats.days')}
            >
              {[7, 14, 30, 90, 180].map((d) => (
                <option key={d} value={d}>
                  {d} kun
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={exportCsv}>
              {t('stats.export')}
            </Button>
          </>
        }
      />
      <ErrorBox error={q.error} />
      {!o ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t('stats.opened')} value={o.totals.opened} />
            <Stat label={t('stats.closed')} value={o.totals.closed} tone="success" />
            <Stat
              label={t('stats.firstResponse')}
              value={fmtMinutes(o.firstResponse.avgMin)}
              sub={`${t('stats.median')}: ${fmtMinutes(o.firstResponse.medianMin)}`}
            />
            <Stat
              label={t('stats.resolution')}
              value={fmtMinutes(o.resolution.avgMin)}
              sub={`${t('stats.median')}: ${fmtMinutes(o.resolution.medianMin)}`}
            />
            <Stat
              label={t('stats.slaCompliance')}
              value={o.sla.compliancePct == null ? '—' : `${o.sla.compliancePct}%`}
              sub={`${o.sla.met} / ${o.sla.measured}`}
              tone={o.sla.compliancePct != null && o.sla.compliancePct < 80 ? 'danger' : 'success'}
            />
            <Stat label={t('dash.open')} value={o.totals.open} />
            <Stat
              label={t('dash.overdue')}
              value={o.totals.overdue}
              tone={o.totals.overdue ? 'danger' : undefined}
            />
            <Stat
              label={t('stats.needsReview')}
              value={o.ai.needsReview}
              sub={o.ai.needsReviewRate == null ? undefined : `${o.ai.needsReviewRate}%`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t('stats.daily')} />
              <CardBody>
                <Bars
                  labels={o.daily.map((d) => d.date.slice(5))}
                  series={[
                    {
                      name: t('stats.opened'),
                      color: 'var(--primary)',
                      values: o.daily.map((d) => d.opened),
                    },
                    {
                      name: t('stats.closed'),
                      color: 'var(--success)',
                      values: o.daily.map((d) => d.closed),
                    },
                  ]}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('stats.byHour')} />
              <CardBody>
                <Bars
                  labels={o.byHour.map((_, h) => `${h}:00`)}
                  series={[{ name: t('stats.opened'), color: 'var(--primary)', values: o.byHour }]}
                />
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t('stats.byStaff')} />
              <Table>
                <thead>
                  <tr>
                    <Th>{t('tickets.assignee')}</Th>
                    <Th>{t('stats.assigned')}</Th>
                    <Th>{t('stats.closed')}</Th>
                    <Th>{t('stats.resolution')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {o.byStaff.map((s) => (
                    <tr key={s.userId}>
                      <Td className="font-medium">{s.name}</Td>
                      <Td className="tabular-nums">{s.assigned}</Td>
                      <Td className="tabular-nums">{s.closed}</Td>
                      <Td>{fmtMinutes(s.avgResolutionMin)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <Card>
              <CardHeader title={t('stats.byClient')} />
              <Table>
                <thead>
                  <tr>
                    <Th>{t('tickets.company')}</Th>
                    <Th>{t('nav.tickets')}</Th>
                    <Th>{t('stats.firstResponse')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {o.byClient.map((c) => (
                    <tr key={c.clientGroupId}>
                      <Td className="font-medium">{c.company}</Td>
                      <Td className="tabular-nums">{c.tickets}</Td>
                      <Td>{fmtMinutes(c.avgFirstResponseMin)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t('stats.bySystem')} />
              <CardBody className="space-y-1 text-sm">
                {o.bySystem.map((s) => (
                  <div key={s.systemType} className="flex justify-between">
                    <span>{t(`system.${s.systemType}` as I18nKey)}</span>
                    <span className="tabular-nums">{s.count}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('stats.aiQuality')} />
              <CardBody className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>{t('reason.AI_NOT_REQUEST')}</span>
                  <span className="tabular-nums">{o.ai.filteredByAi}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('stats.falseNegatives')}</span>
                  <span className="tabular-nums">
                    {o.ai.falseNegatives}
                    {o.ai.falseNegativeRate != null && ` (${o.ai.falseNegativeRate}%)`}
                  </span>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
