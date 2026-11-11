import { Injectable } from '@nestjs/common';
import type { User } from '../../common/prisma-client';
import { parseCallback, slaInfo, t, userShortId } from '@tp/shared';
import { PrismaService } from '../../common/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { UsersService } from '../users/users.service';
import { AppError } from '../../common/http';
import { escapeHtml, formatTime, type Keyboard } from './card';
import { CardService } from './bot-core.service';
import { startOfLocalDay } from './local-time';
import { workingHoursSchema } from '@tp/shared';

export interface CallbackInput {
  /** Telegram user id of the person who pressed the button. */
  telegramUserId: string;
  data: string;
}
export interface CallbackResult {
  /** Toast / alert shown to the presser. */
  answer: string;
  alert: boolean;
  /** New card content for the message the button was on (the bot edits it). */
  edit: { text: string; keyboard: Keyboard } | null;
}

export interface CommandInput {
  telegramUserId: string;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  text: string;
}
export interface BotReply {
  text: string;
  keyboard?: Keyboard;
}

const SNOOZE_MINUTES = 10;

/** Staff-facing behaviour of the internal bot: button presses and commands. All rules live here; the bot app is a thin adapter. */
@Injectable()
export class BotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly users: UsersService,
    private readonly cards: CardService,
  ) {}

  /** Only linked, active staff are ever served; everybody else is ignored. */
  staffByTelegram(telegramUserId: string): Promise<User | null> {
    if (!/^\d+$/.test(telegramUserId)) return Promise.resolve(null);
    return this.prisma.user.findFirst({ where: { telegramUserId: BigInt(telegramUserId), isActive: true } });
  }

  // ------------------------------------------------------------------ inline buttons

  async handleCallback(input: CallbackInput): Promise<CallbackResult> {
    const user = await this.staffByTelegram(input.telegramUserId);
    if (!user) return { answer: t('bot.notStaff'), alert: true, edit: null };
    const cb = parseCallback(input.data);
    if (!cb) return { answer: t('error.validation'), alert: true, edit: null };
    const ticket = await this.prisma.ticket.findUnique({ where: { number: cb.ticketNumber } });
    if (!ticket) return { answer: t('ticket.notFound'), alert: true, edit: null };

    const refresh = async (answer: string, alert = false, reassignMenu = false): Promise<CallbackResult> => {
      const card = await this.cards.render(ticket.id, { reassignMenu });
      return { answer, alert, edit: card };
    };

    if (ticket.status === 'CLOSED' && cb.action !== 'back') return refresh(t('ticket.closed'), true);

    try {
      switch (cb.action) {
        case 'take': {
          await this.tickets.take(ticket.id, user.id);
          return refresh(t('ticket.taken', { name: user.displayName }));
        }
        case 'assign': {
          const target = await this.findUserByShort(cb.userShort!);
          if (!target) return refresh(t('error.validation'), true);
          // Unassigned ticket: first valid press wins. Already assigned: this is an explicit reassignment.
          if (!ticket.assigneeId) await this.tickets.claim(ticket.id, target.id, user.id);
          else await this.tickets.assign(ticket.id, target.id, user.id);
          return refresh(t('ticket.taken', { name: target.displayName }));
        }
        case 'snooze': {
          const dueAt = new Date(Date.now() + SNOOZE_MINUTES * 60_000);
          await this.prisma.reminder.create({
            data: { kind: 'SNOOZE', ticketId: ticket.id, userId: user.id, dueAt },
          });
          return { answer: t('bot.snoozed'), alert: false, edit: null };
        }
        case 'reassign':
          return refresh('', false, true);
        case 'back':
          return refresh('');
        case 'done':
          await this.tickets.close(ticket.id, user.id);
          return refresh(t('ticket.closed'));
        case 'wait':
          await this.tickets.setStatus(ticket.id, 'WAITING_CLIENT', user.id);
          return refresh(t('status.WAITING_CLIENT'));
      }
    } catch (e) {
      if (e instanceof AppError) {
        // e.g. ALREADY_TAKEN: tell the loser who has it, and refresh the card so it shows the truth.
        return refresh(e.message, true);
      }
      throw e;
    }
  }

  private async findUserByShort(short: string): Promise<User | null> {
    const users = await this.prisma.user.findMany({ where: { isActive: true } });
    return users.find((u) => userShortId(u.id) === short) ?? null;
  }

  // ------------------------------------------------------------------ commands

  /** Returns null when the sender must be ignored. */
  async handleCommand(input: CommandInput): Promise<BotReply[] | null> {
    const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(input.text.trim());
    if (!m) return null;
    const cmd = m[1].toLowerCase();
    const arg = (m[2] ?? '').trim();

    if (cmd === 'start') {
      // Linking only happens in a private chat so the code never sits in a group.
      if (input.chatType !== 'private') return null;
      if (arg) {
        const linked = await this.users.linkTelegram(arg, BigInt(input.telegramUserId));
        return [{ text: linked ? t('bot.linked', { name: linked.displayName }) : t('bot.badCode') }];
      }
      return [
        { text: (await this.staffByTelegram(input.telegramUserId)) ? t('bot.help') : t('bot.notStaff') },
      ];
    }

    const user = await this.staffByTelegram(input.telegramUserId);
    if (!user) return null;

    switch (cmd) {
      case 'help':
        return [{ text: t('bot.help') }];
      case 'free':
      case 'busy': {
        await this.prisma.user.update({ where: { id: user.id }, data: { available: cmd === 'free' } });
        return [{ text: t(cmd === 'free' ? 'bot.free' : 'bot.busy') }];
      }
      case 'my':
        return this.myTickets(user);
      case 'stats':
        return [{ text: await this.stats(user) }];
      default:
        return null;
    }
  }

  async myTickets(user: User): Promise<BotReply[]> {
    const tickets = await this.prisma.ticket.findMany({
      where: { assigneeId: user.id, status: { not: 'CLOSED' } },
      include: { clientGroup: true },
      orderBy: { openedAt: 'asc' },
      take: 20,
    });
    if (!tickets.length) return [{ text: t('bot.myEmpty') }];
    const tz = workingHoursSchema.safeParse(user.workingHours ?? {}).data?.tz;
    const lines = tickets.map((tk) => {
      const sla = slaInfo(tk);
      const flag = sla.overdue ? '🔴' : tk.urgency === 'HIGH' ? '🟠' : '🟢';
      return `${flag} <b>#${tk.number}</b> ${escapeHtml(tk.clientGroup.companyName)} · ${t(`status.${tk.status}` as 'status.NEW')} · ${formatTime(tk.openedAt, tz)}\n<i>${escapeHtml(tk.summary.slice(0, 100))}</i>`;
    });
    const keyboard: Keyboard = tickets.map((tk) => [
      { text: `✅ #${tk.number}`, callback: `d:${tk.number}` },
      { text: `⏳ #${tk.number}`, callback: `w:${tk.number}` },
    ]);
    return [{ text: lines.join('\n\n'), keyboard }];
  }

  async stats(user: User): Promise<string> {
    const tz = workingHoursSchema.safeParse(user.workingHours ?? {}).data?.tz ?? 'Asia/Tashkent';
    const dayStart = startOfLocalDay(new Date(), tz);
    const [opened, closed, myClosed, open] = await Promise.all([
      this.prisma.ticket.count({ where: { openedAt: { gte: dayStart } } }),
      this.prisma.ticket.count({ where: { closedAt: { gte: dayStart } } }),
      this.prisma.ticket.count({ where: { closedAt: { gte: dayStart }, closedById: user.id } }),
      this.prisma.ticket.findMany({
        where: { status: { not: 'CLOSED' } },
        select: { status: true, slaDeadline: true },
      }),
    ]);
    const overdue = open.filter((o) => slaInfo(o).overdue).length;
    return t('bot.stats', { opened, closed, myClosed, open: open.length, overdue });
  }

  /** Used by reminders: how many open / overdue tickets does this person have? */
  async workload(userId: string) {
    const open = await this.prisma.ticket.findMany({
      where: { assigneeId: userId, status: { not: 'CLOSED' } },
      select: { status: true, slaDeadline: true },
    });
    return { open: open.length, overdue: open.filter((o) => slaInfo(o).overdue).length };
  }
}
