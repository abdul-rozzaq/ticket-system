import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { slaInfo, t, workingHoursSchema, type WorkingHours } from '@tp/shared';
import { APP_ENV, Env } from '../../common/env';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { DomainEvents } from '../../common/domain-events';
import { snapshot } from '../tickets/tickets.service';
import { isWithinWorkingHours } from '../../common/domain/assignment';
import { escapeHtml } from './card';
import { BotConfigService, BotOutboxService } from './bot-core.service';
import { BotService } from './bot.service';
import { localParts } from './local-time';

const DIGEST_HOUR = 9; // local time of the morning digest
const DEFAULT_TZ = 'Asia/Tashkent';

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const whOf = (u: User): WorkingHours | null => {
  const r = workingHoursSchema.safeParse(u.workingHours ?? undefined);
  return u.workingHours && r.success ? r.data : null;
};

/**
 * Time-based nudges. Each tick looks at the CURRENT state and creates a `Reminder` row with a unique dedupe key
 * before sending, so a reminder is never sent twice (even across restarts or several API instances), and after downtime
 * only the current interval fires (no flood of catch-up messages).
 */
@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Reminders');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly outbox: BotOutboxService,
    private readonly cfg: BotConfigService,
    private readonly bot: BotService,
    private readonly events: DomainEvents,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (this.env.BOT_POLL_MS > 0) {
      this.timer = setInterval(
        () => void this.tick().catch((e) => this.logger.warn(`tick failed: ${String(e)}`)),
        this.env.BOT_POLL_MS,
      );
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs every reminder rule once. Safe to call concurrently (single-flight) and repeatedly (deduped by key). */
  async tick(now = new Date()): Promise<Record<string, number>> {
    if (this.running) return {};
    this.running = true;
    try {
      const sent = { unassigned: 0, stale: 0, waiting: 0, overdue: 0, digest: 0 };
      sent.overdue = await this.overdue(now);
      sent.unassigned = await this.unassigned(now);
      sent.stale = await this.assignedStale(now);
      sent.waiting = await this.waiting(now);
      sent.digest = await this.digests(now);
      return sent;
    } finally {
      this.running = false;
    }
  }

  /** Claims the dedupe key. Returns false if this reminder was already sent. */
  private async claimKey(
    key: string,
    kind: string,
    extra: { ticketId?: string; userId?: string } = {},
  ): Promise<boolean> {
    try {
      await this.prisma.reminder.create({
        data: { key, kind, dueAt: new Date(), sentAt: new Date(), ...extra },
      });
      return true;
    } catch (e) {
      if (isUnique(e)) return false;
      throw e;
    }
  }

  private async group(text: string, replyTo?: string | null) {
    const chatId = (await this.cfg.get()).internalChatId;
    if (!chatId) return;
    await this.outbox.enqueue('SEND_TEXT', {
      chatId,
      text,
      ...(replyTo ? { replyToMessageId: replyTo } : {}),
    });
  }

  /** DMs respect working hours / days off: outside them the reminder is simply retried on a later tick. */
  private canDm(user: User, now: Date): boolean {
    return !!user.telegramUserId && user.isActive && isWithinWorkingHours(whOf(user), now);
  }

  private dm(user: User, text: string) {
    return this.outbox.enqueue('SEND_TEXT', { chatId: user.telegramUserId!.toString(), text });
  }

  // ------------------------------------------------------------------ rules

  /** SLA breached: once per ticket, tell the group and let cards/clients know. */
  private async overdue(now: Date): Promise<number> {
    const open = await this.prisma.ticket.findMany({
      where: { status: { in: ['NEW', 'IN_PROGRESS'] }, slaDeadline: { lt: now } },
      include: { clientGroup: true },
    });
    let n = 0;
    for (const tk of open) {
      if (!slaInfo(tk, now.getTime()).overdue) continue;
      if (!(await this.claimKey(`OVERDUE:${tk.id}`, 'OVERDUE', { ticketId: tk.id }))) continue;
      await this.prisma.ticketEvent.create({ data: { ticketId: tk.id, type: 'SLA_BREACHED', payload: {} } });
      await this.group(
        t('bot.reminder.overdue', { number: tk.number, company: escapeHtml(tk.clientGroup.companyName) }),
        tk.cardMessageId?.toString(),
      );
      this.events.emit('ticket.updated', { ...snapshot(tk), change: 'overdue', actorId: null });
      n++;
    }
    return n;
  }

  /** Nobody took the ticket: remind the group every N minutes (not while snoozed); from the 2nd reminder mention the escalation person. */
  private async unassigned(now: Date): Promise<number> {
    const minutes = await this.settings.get('reminders.unassignedMinutes');
    const tickets = await this.prisma.ticket.findMany({
      where: { status: 'NEW', assigneeId: null },
      include: { clientGroup: true },
    });
    const escalation = await this.escalationMention();
    let n = 0;
    for (const tk of tickets) {
      const k = Math.floor((now.getTime() - tk.openedAt.getTime()) / (minutes * 60_000));
      if (k < 1) continue;
      const snoozed = await this.prisma.reminder.count({
        where: { ticketId: tk.id, kind: 'SNOOZE', dueAt: { gt: now } },
      });
      if (snoozed) continue;
      if (!(await this.claimKey(`UNASSIGNED:${tk.id}:${k}`, 'UNASSIGNED', { ticketId: tk.id }))) continue;
      let text = t('bot.reminder.unassigned', {
        number: tk.number,
        company: escapeHtml(tk.clientGroup.companyName),
        minutes: k * minutes,
      });
      if (k >= 2 && escalation) text += `\n${t('bot.reminder.escalate', { mention: escalation })}`;
      await this.group(text, tk.cardMessageId?.toString());
      n++;
    }
    return n;
  }

  private async escalationMention(): Promise<string | null> {
    const id = (await this.cfg.get()).escalationUserId;
    if (!id) return null;
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) return null;
    return u.telegramUserId
      ? `<a href="tg://user?id=${u.telegramUserId}">${escapeHtml(u.displayName)}</a>`
      : escapeHtml(u.displayName);
  }

  /** Assigned but not resolved for N hours: DM the assignee. */
  private async assignedStale(now: Date): Promise<number> {
    const hours = await this.settings.get('reminders.assignedHours');
    const tickets = await this.prisma.ticket.findMany({
      where: { status: 'IN_PROGRESS', assigneeId: { not: null } },
      include: { clientGroup: true, assignee: true },
    });
    let n = 0;
    for (const tk of tickets) {
      const since = await this.lastEventAt(tk.id, ['ASSIGNED', 'REASSIGNED', 'STATUS_CHANGED'], tk.openedAt);
      const k = Math.floor((now.getTime() - since.getTime()) / (hours * 3_600_000));
      if (k < 1 || !tk.assignee) continue;
      const key = `STALE:${tk.id}:${since.getTime()}:${k}`;
      if (await this.prisma.reminder.count({ where: { key } })) continue;
      if (!this.canDm(tk.assignee, now)) continue; // outside working hours: try again later
      // claim first, then send: a lost race must never produce a second message
      if (!(await this.claimKey(key, 'ASSIGNED_STALE', { ticketId: tk.id, userId: tk.assigneeId! })))
        continue;
      await this.dm(
        tk.assignee,
        t('bot.reminder.stale', {
          number: tk.number,
          company: escapeHtml(tk.clientGroup.companyName),
          hours: k * hours,
        }),
      );
      n++;
    }
    return n;
  }

  /** Waiting for the client for N hours: DM the assignee. */
  private async waiting(now: Date): Promise<number> {
    const hours = await this.settings.get('reminders.waitingHours');
    const tickets = await this.prisma.ticket.findMany({
      where: { status: 'WAITING_CLIENT', assigneeId: { not: null } },
      include: { clientGroup: true, assignee: true },
    });
    let n = 0;
    for (const tk of tickets) {
      const since = await this.lastEventAt(tk.id, ['STATUS_CHANGED'], tk.openedAt);
      const k = Math.floor((now.getTime() - since.getTime()) / (hours * 3_600_000));
      if (k < 1 || !tk.assignee) continue;
      const key = `WAITING:${tk.id}:${since.getTime()}:${k}`;
      if (await this.prisma.reminder.count({ where: { key } })) continue;
      if (!this.canDm(tk.assignee, now)) continue;
      if (!(await this.claimKey(key, 'WAITING', { ticketId: tk.id, userId: tk.assigneeId! }))) continue;
      await this.dm(
        tk.assignee,
        t('bot.reminder.waiting', {
          number: tk.number,
          company: escapeHtml(tk.clientGroup.companyName),
          hours: k * hours,
        }),
      );
      n++;
    }
    return n;
  }

  private async lastEventAt(ticketId: string, types: string[], fallback: Date): Promise<Date> {
    const e = await this.prisma.ticketEvent.findFirst({
      where: { ticketId, type: { in: types } },
      orderBy: { createdAt: 'desc' },
    });
    return e?.createdAt ?? fallback;
  }

  /** Morning digest: once per local day per staff member, on their working days, from 09:00 local time. */
  private async digests(now: Date): Promise<number> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, telegramUserId: { not: null } },
    });
    let n = 0;
    for (const u of users) {
      const wh = whOf(u);
      const p = localParts(now, wh?.tz ?? DEFAULT_TZ);
      if (p.hour < DIGEST_HOUR) continue;
      if (wh && !wh.days.includes(p.weekday)) continue; // day off
      const key = `DIGEST:${u.id}:${p.date}`;
      if (await this.prisma.reminder.count({ where: { key } })) continue;
      if (!(await this.claimKey(key, 'DIGEST', { userId: u.id }))) continue;
      const w = await this.bot.workload(u.id);
      await this.dm(u, t('bot.digest', { open: w.open, overdue: w.overdue }));
      n++;
    }
    return n;
  }
}
