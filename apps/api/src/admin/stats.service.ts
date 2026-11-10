import { Injectable } from '@nestjs/common';
import { slaInfo } from '@tp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { KbService } from '../kb/kb.service';
import { localParts, startOfLocalDay } from '../bot/local-time';

const TZ = 'Asia/Tashkent';
const minutes = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;
const avg = (xs: number[]) =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};

/** Spreadsheet formula injection: cells starting with = + - @ are prefixed with an apostrophe. */
export const csvCell = (v: unknown): string => {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly kb: KbService,
  ) {}

  /** Numbers for the dashboard: today + the live funnel. `userId` adds "mine". */
  async dashboard(userId?: string, now = new Date()) {
    const dayStart = startOfLocalDay(now, TZ);
    const [openedToday, closedToday, open, myClosedToday] = await Promise.all([
      this.prisma.ticket.count({ where: { openedAt: { gte: dayStart } } }),
      this.prisma.ticket.count({ where: { closedAt: { gte: dayStart } } }),
      this.prisma.ticket.findMany({
        where: { status: { not: 'CLOSED' } },
        select: { status: true, assigneeId: true, slaDeadline: true, urgency: true },
      }),
      userId ? this.prisma.ticket.count({ where: { closedAt: { gte: dayStart }, closedById: userId } }) : 0,
    ]);
    const overdue = open.filter((t) => slaInfo(t, now.getTime()).overdue).length;
    const mine = userId ? open.filter((t) => t.assigneeId === userId) : [];
    return {
      today: { opened: openedToday, closed: closedToday },
      open: {
        total: open.length,
        unassigned: open.filter((t) => !t.assigneeId).length,
        waiting: open.filter((t) => t.status === 'WAITING_CLIENT').length,
        overdue,
        urgent: open.filter((t) => t.urgency === 'HIGH').length,
      },
      mine: userId
        ? {
            open: mine.length,
            overdue: mine.filter((t) => slaInfo(t, now.getTime()).overdue).length,
            closedToday: myClosedToday,
          }
        : null,
    };
  }

  async overview(days = 30, now = new Date()) {
    const from = new Date(now.getTime() - days * 86_400_000);
    const rows = await this.prisma.ticket.findMany({
      where: { OR: [{ openedAt: { gte: from } }, { closedAt: { gte: from } }] },
      include: {
        clientGroup: { select: { companyName: true, id: true } },
        assignee: { select: { id: true, displayName: true } },
      },
    });
    const opened = rows.filter((t) => t.openedAt >= from);
    const closed = rows.filter((t) => t.closedAt && t.closedAt >= from);

    // SLA compliance: first response within the group's first-response SLA (tickets still inside their window are not counted)
    const slaCache = new Map<string, number>();
    let ok = 0;
    let measured = 0;
    for (const t of opened) {
      if (!slaCache.has(t.clientGroupId))
        slaCache.set(t.clientGroupId, (await this.tickets.slaFor(t.clientGroupId)).firstResponseMinutes);
      const limit = new Date(t.openedAt.getTime() + slaCache.get(t.clientGroupId)! * 60_000);
      if (t.firstResponseAt) {
        measured++;
        if (t.firstResponseAt <= limit) ok++;
      } else if (now > limit && t.status !== 'CLOSED')
        measured++; // overdue and still unanswered
      else if (t.status === 'CLOSED') measured++; // closed without ever recording a reply counts as a miss
    }

    const firstResp = opened
      .filter((t) => t.firstResponseAt)
      .map((t) => minutes(t.openedAt, t.firstResponseAt!));
    const resolution = closed.filter((t) => t.closedAt).map((t) => minutes(t.openedAt, t.closedAt!));

    const staffMap = new Map<
      string,
      { userId: string; name: string; assigned: number; closed: number; res: number[] }
    >();
    const bump = (id: string, name: string) => {
      if (!staffMap.has(id)) staffMap.set(id, { userId: id, name, assigned: 0, closed: 0, res: [] });
      return staffMap.get(id)!;
    };
    for (const t of opened) if (t.assignee) bump(t.assignee.id, t.assignee.displayName).assigned++;
    for (const t of closed)
      if (t.assigneeId && t.assignee) {
        const s = bump(t.assignee.id, t.assignee.displayName);
        s.closed++;
        s.res.push(minutes(t.openedAt, t.closedAt!));
      }

    const clientMap = new Map<
      string,
      { clientGroupId: string; company: string; tickets: number; fr: number[] }
    >();
    for (const t of opened) {
      const c = clientMap.get(t.clientGroupId) ?? {
        clientGroupId: t.clientGroupId,
        company: t.clientGroup.companyName,
        tickets: 0,
        fr: [],
      };
      c.tickets++;
      if (t.firstResponseAt) c.fr.push(minutes(t.openedAt, t.firstResponseAt));
      clientMap.set(t.clientGroupId, c);
    }

    const bySystem: Record<string, number> = {};
    for (const t of opened) bySystem[t.systemType] = (bySystem[t.systemType] ?? 0) + 1;
    const byHour = Array.from({ length: 24 }, () => 0);
    for (const t of opened) byHour[localParts(t.openedAt, TZ).hour]++;
    const daily = new Map<string, { date: string; opened: number; closed: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = localParts(new Date(now.getTime() - i * 86_400_000), TZ).date;
      daily.set(d, { date: d, opened: 0, closed: 0 });
    }
    for (const t of opened) {
      const d = daily.get(localParts(t.openedAt, TZ).date);
      if (d) d.opened++;
    }
    for (const t of closed) {
      const d = daily.get(localParts(t.closedAt!, TZ).date);
      if (d) d.closed++;
    }

    // AI intake quality: messages the AI called "not a request" that a human then turned into a ticket are false negatives
    const [filtered, falseNeg, needsReview] = await Promise.all([
      this.prisma.filteredMessage.count({ where: { reason: 'AI_NOT_REQUEST', createdAt: { gte: from } } }),
      this.prisma.filteredMessage.count({
        where: { reason: 'AI_NOT_REQUEST', createdAt: { gte: from }, createdTicketId: { not: null } },
      }),
      this.prisma.ticket.count({ where: { openedAt: { gte: from }, needsReview: true } }),
    ]);

    const kb = await this.kb.stats();
    const open = await this.prisma.ticket.findMany({
      where: { status: { not: 'CLOSED' } },
      select: { status: true, slaDeadline: true },
    });
    return {
      window: { from, to: now, days },
      totals: {
        opened: opened.length,
        closed: closed.length,
        open: open.length,
        overdue: open.filter((t) => slaInfo(t, now.getTime()).overdue).length,
      },
      firstResponse: { avgMin: avg(firstResp), medianMin: median(firstResp), answered: firstResp.length },
      resolution: { avgMin: avg(resolution), medianMin: median(resolution) },
      sla: { measured, met: ok, compliancePct: measured ? Math.round((ok / measured) * 1000) / 10 : null },
      byStaff: [...staffMap.values()]
        .map((s) => ({
          userId: s.userId,
          name: s.name,
          assigned: s.assigned,
          closed: s.closed,
          avgResolutionMin: avg(s.res),
        }))
        .sort((a, b) => b.closed - a.closed),
      byClient: [...clientMap.values()]
        .map((c) => ({
          clientGroupId: c.clientGroupId,
          company: c.company,
          tickets: c.tickets,
          avgFirstResponseMin: avg(c.fr),
        }))
        .sort((a, b) => b.tickets - a.tickets)
        .slice(0, 20),
      bySystem: Object.entries(bySystem)
        .map(([systemType, count]) => ({ systemType, count }))
        .sort((a, b) => b.count - a.count),
      byHour,
      daily: [...daily.values()],
      ai: {
        filteredByAi: filtered,
        falseNegatives: falseNeg,
        falseNegativeRate: filtered ? Math.round((falseNeg / filtered) * 1000) / 10 : null,
        needsReview,
        needsReviewRate: opened.length ? Math.round((needsReview / opened.length) * 1000) / 10 : null,
      },
      kb: { hitRate: kb.drafts.hitRate, drafts: kb.drafts.total, unchangedRate: kb.drafts.unchangedRate },
    };
  }

  /** Tickets of the window as CSV (for spreadsheets). */
  async csv(days = 30, now = new Date()): Promise<string> {
    const from = new Date(now.getTime() - days * 86_400_000);
    const rows = await this.prisma.ticket.findMany({
      where: { openedAt: { gte: from } },
      include: {
        clientGroup: { select: { companyName: true } },
        assignee: { select: { displayName: true } },
      },
      orderBy: { openedAt: 'asc' },
      take: 20_000,
    });
    const head = [
      'number',
      'company',
      'system',
      'category',
      'urgency',
      'status',
      'assignee',
      'opened_at',
      'first_response_at',
      'closed_at',
      'first_response_min',
      'resolution_min',
      'summary',
    ];
    const lines = [head.join(',')];
    for (const t of rows) {
      lines.push(
        [
          t.number,
          t.clientGroup.companyName,
          t.systemType,
          t.category,
          t.urgency,
          t.status,
          t.assignee?.displayName,
          t.openedAt,
          t.firstResponseAt,
          t.closedAt,
          t.firstResponseAt ? Math.round(minutes(t.openedAt, t.firstResponseAt)) : '',
          t.closedAt ? Math.round(minutes(t.openedAt, t.closedAt)) : '',
          t.summary,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return `﻿${lines.join('\r\n')}\r\n`; // BOM so Excel reads UTF-8 (uzbek letters) correctly
  }
}
