import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Ticket, type TicketStatus, type Urgency, type SystemType } from '@prisma/client';
import { maskSensitive, t, ticketFilterSchema } from '@tp/shared';
import type { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEvents, TicketSnapshot } from '../events/domain-events';
import { SettingsService } from '../settings/settings.service';
import { AppError } from '../common/http';

type Tx = Prisma.TransactionClient;

export interface CreateTicketInput {
  clientGroupId: string;
  text: string;
  senderName?: string | null;
  senderTelegramId?: bigint | null;
  telegramMessageId?: bigint | null;
  urgency?: Urgency;
  category?: string;
  systemType?: SystemType;
  summary?: string;
  aiConfidence?: number | null;
  needsReview?: boolean;
  createdFromFilteredId?: string | null;
  actorId?: string | null;
}

export interface MessageInput {
  telegramMessageId?: bigint | null;
  senderTelegramId?: bigint | null;
  senderName?: string | null;
  direction: 'IN' | 'OUT';
  text: string;
  isInternalNote?: boolean;
  answeredById?: string | null;
  answeredConfidence?: number | null;
  mediaMeta?: Prisma.InputJsonValue;
  sentAt?: Date;
}

const ALLOWED_STATUS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ['IN_PROGRESS', 'WAITING_CLIENT', 'CLOSED'],
  IN_PROGRESS: ['WAITING_CLIENT', 'CLOSED'],
  WAITING_CLIENT: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [], // a customer who writes again gets a NEW ticket (previousTicketId); closed tickets are never reopened
};

const detailInclude = {
  clientGroup: true,
  assignee: { select: { id: true, displayName: true, username: true } },
  closedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.TicketInclude;

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export const snapshot = (tk: Ticket): TicketSnapshot => ({
  ticketId: tk.id,
  number: tk.number,
  clientGroupId: tk.clientGroupId,
  status: tk.status,
  assigneeId: tk.assigneeId,
  urgency: tk.urgency,
  summary: tk.summary,
});

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------------ creation

  /**
   * Opens a ticket for a client group. The partial unique index guarantees one open ticket per group even under
   * concurrent intake workers: the loser of the race attaches its message to the winner's ticket instead.
   */
  async createTicket(input: CreateTicketInput): Promise<{ ticket: Ticket; created: boolean }> {
    const group = await this.prisma.clientGroup.findUnique({
      where: { id: input.clientGroupId },
      include: { slaPolicy: true },
    });
    if (!group) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Guruh topilmadi');

    const firstResponseMin =
      group.slaPolicy?.firstResponseMinutes ?? (await this.settings.get('sla.firstResponseMinutes'));
    const now = new Date();
    const previous = await this.prisma.ticket.findFirst({
      where: { clientGroupId: group.id, status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
      select: { id: true },
    });

    try {
      const ticket = await this.prisma.$transaction(async (tx) => {
        const created = await tx.ticket.create({
          data: {
            clientGroupId: group.id,
            urgency: input.urgency ?? 'NORMAL',
            category: input.category ?? 'other',
            systemType: input.systemType ?? group.systemType,
            // default summary is a copy of the first message: never store a raw secret in it
            summary: input.summary ?? maskSensitive(input.text).text.slice(0, 120),
            aiConfidence: input.aiConfidence ?? null,
            needsReview: input.needsReview ?? false,
            openedAt: now,
            slaDeadline: new Date(now.getTime() + firstResponseMin * 60_000),
            previousTicketId: previous?.id,
            createdFromFilteredId: input.createdFromFilteredId ?? undefined,
          },
        });
        await tx.ticketMessage.create({
          data: {
            ticketId: created.id,
            chatId: group.telegramChatId,
            telegramMessageId: input.telegramMessageId ?? null,
            senderTelegramId: input.senderTelegramId ?? null,
            senderName: input.senderName ?? null,
            direction: 'IN',
            text: input.text,
          },
        });
        await this.ev(tx, created.id, 'CREATED', input.actorId ?? null, {
          previousTicketId: previous?.id ?? null,
          needsReview: input.needsReview ?? false,
          urgency: created.urgency,
        });
        return created;
      });
      this.events.emit('ticket.created', { ...snapshot(ticket), needsReview: ticket.needsReview });
      return { ticket, created: true };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const open = await this.prisma.ticket.findFirst({
        where: { clientGroupId: group.id, status: { not: 'CLOSED' } },
      });
      if (!open) throw e;
      await this.attachMessage(open.id, group.telegramChatId, {
        telegramMessageId: input.telegramMessageId,
        senderTelegramId: input.senderTelegramId,
        senderName: input.senderName,
        direction: 'IN',
        text: input.text,
      });
      return { ticket: open, created: false };
    }
  }

  // ------------------------------------------------------------------ messages

  /** Idempotent on (chatId, telegramMessageId). Handles first-response stamping and client follow-ups. */
  async attachMessage(
    ticketId: string,
    chatId: string,
    m: MessageInput,
  ): Promise<{ duplicate: boolean; firstResponse: boolean }> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', t('ticket.notFound'));
    try {
      await this.prisma.ticketMessage.create({
        data: {
          ticketId,
          chatId,
          telegramMessageId: m.telegramMessageId ?? null,
          senderTelegramId: m.senderTelegramId ?? null,
          senderName: m.senderName ?? null,
          direction: m.direction,
          text: m.text,
          isInternalNote: m.isInternalNote ?? false,
          answeredById: m.answeredById ?? null,
          answeredConfidence: m.answeredConfidence ?? null,
          mediaMeta: m.mediaMeta,
          sentAt: m.sentAt ?? new Date(),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) return { duplicate: true, firstResponse: false };
      throw e;
    }

    let firstResponse = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id: ticketId }, data: { lastActivityAt: new Date() } });
      if (ticket.status === 'CLOSED' || m.isInternalNote) return;

      if (m.direction === 'OUT' && !ticket.firstResponseAt) {
        firstResponse = await this.stampFirstResponse(tx, ticket, m.answeredById ?? null, {
          answeredConfidence: m.answeredConfidence ?? null,
        });
      }
      if (m.direction === 'IN' && ticket.status === 'WAITING_CLIENT') {
        const next: TicketStatus = ticket.assigneeId ? 'IN_PROGRESS' : 'NEW';
        await tx.ticket.update({ where: { id: ticketId }, data: { status: next } });
        await this.ev(tx, ticketId, 'STATUS_CHANGED', null, {
          from: 'WAITING_CLIENT',
          to: next,
          reason: 'client_replied',
        });
      }
    });
    this.events.emit('ticket.message', {
      ticketId,
      direction: m.direction,
      isFirstResponse: firstResponse,
      text: m.direction === 'OUT' ? m.text : undefined,
      answeredById: m.answeredById ?? null,
      sentAt: m.sentAt,
      isInternalNote: m.isInternalNote ?? false,
    });
    return { duplicate: false, firstResponse };
  }

  /**
   * Atomically stamps firstResponseAt (only one concurrent caller wins) and moves the SLA deadline from
   * "first response" to "resolution". Returns true for the winner.
   */
  private async stampFirstResponse(
    tx: Tx,
    ticket: Ticket,
    actorId: string | null,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const r = await tx.ticket.updateMany({
      where: { id: ticket.id, firstResponseAt: null },
      data: { firstResponseAt: new Date() },
    });
    if (r.count !== 1) return false;
    const resolutionMin = await this.settings.get('sla.resolutionMinutes');
    await tx.ticket.update({
      where: { id: ticket.id },
      data: { slaDeadline: new Date(ticket.openedAt.getTime() + resolutionMin * 60_000) },
    });
    await this.ev(tx, ticket.id, 'FIRST_RESPONSE', actorId, payload as Prisma.InputJsonValue);
    return true;
  }

  /** 👀 reaction by the TP account counts as "seen / first response" (best effort). */
  async markSeen(ticketId: string, actorId: string | null): Promise<boolean> {
    const ticket = await this.requireTicket(ticketId);
    if (ticket.status === 'CLOSED' || ticket.firstResponseAt) return false;
    return this.prisma.$transaction((tx) =>
      this.stampFirstResponse(tx, ticket, actorId, { via: 'reaction' }),
    );
  }

  // ------------------------------------------------------------------ assignment & status

  /**
   * "Men olaman": the first valid press wins. The UPDATE ... WHERE assigneeId IS NULL is the arbiter, so two staff
   * pressing at the same moment can never both succeed. Pressing again as the winner is an idempotent no-op.
   */
  /** "Men olaman": claim the ticket for yourself. */
  take(ticketId: string, userId: string): Promise<{ ticket: Ticket; won: boolean }> {
    return this.claim(ticketId, userId, userId);
  }

  async claim(
    ticketId: string,
    assigneeId: string,
    actorId: string | null,
  ): Promise<{ ticket: Ticket; won: boolean }> {
    await this.requireActiveUser(assigneeId);
    const r = await this.prisma.ticket.updateMany({
      where: { id: ticketId, assigneeId: null, status: { not: 'CLOSED' } },
      data: { assigneeId },
    });
    const ticket = await this.requireTicket(ticketId);
    if (r.count === 1) {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row =
          ticket.status === 'NEW'
            ? await tx.ticket.update({ where: { id: ticketId }, data: { status: 'IN_PROGRESS' } })
            : ticket;
        await this.ev(tx, ticketId, 'ASSIGNED', actorId, {
          assigneeId,
          via: actorId === assigneeId ? 'take' : 'assign',
        });
        if (ticket.status === 'NEW')
          await this.ev(tx, ticketId, 'STATUS_CHANGED', actorId, { from: 'NEW', to: 'IN_PROGRESS' });
        return row;
      });
      this.events.emit('ticket.assigned', {
        ...snapshot(updated),
        previousAssigneeId: null,
        actorId,
      });
      return { ticket: updated, won: true };
    }
    if (ticket.status === 'CLOSED') throw new AppError(HttpStatus.CONFLICT, 'CLOSED', t('ticket.closed'));
    if (ticket.assigneeId === assigneeId) return { ticket, won: true }; // idempotent
    const owner = ticket.assigneeId
      ? await this.prisma.user.findUnique({ where: { id: ticket.assigneeId } })
      : null;
    throw new AppError(
      HttpStatus.CONFLICT,
      'ALREADY_TAKEN',
      t('ticket.alreadyTaken', { name: owner?.displayName ?? '?' }),
      {
        assigneeId: ticket.assigneeId,
      },
    );
  }

  /** Explicit (re)assignment by anyone with access, optionally with a handover note for the new assignee. */
  async assign(
    ticketId: string,
    assigneeId: string,
    actorId: string | null,
    handoverNote?: string,
  ): Promise<Ticket> {
    await this.requireActiveUser(assigneeId);
    const before = await this.requireTicket(ticketId);
    if (before.status === 'CLOSED') throw new AppError(HttpStatus.CONFLICT, 'CLOSED', t('ticket.closed'));
    if (before.assigneeId === assigneeId) return before;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.ticket.update({
        where: { id: ticketId },
        data: { assigneeId, status: before.status === 'NEW' ? 'IN_PROGRESS' : undefined },
      });
      await this.ev(tx, ticketId, before.assigneeId ? 'REASSIGNED' : 'ASSIGNED', actorId, {
        from: before.assigneeId,
        to: assigneeId,
        handoverNote: handoverNote ?? null,
      });
      return row;
    });
    this.events.emit('ticket.assigned', {
      ...snapshot(updated),
      previousAssigneeId: before.assigneeId,
      actorId,
      handoverNote,
    });
    return updated;
  }

  /** Unassign (used when a staff member is deactivated): back to the "new" stage. */
  async unassign(ticketId: string, actorId: string | null): Promise<Ticket> {
    const before = await this.requireTicket(ticketId);
    if (before.status === 'CLOSED' || (!before.assigneeId && before.status === 'NEW')) return before;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.ticket.update({
        where: { id: ticketId },
        data: { assigneeId: null, status: 'NEW' },
      });
      await this.ev(tx, ticketId, 'REASSIGNED', actorId, { from: before.assigneeId, to: null });
      return row;
    });
    this.events.emit('ticket.updated', { ...snapshot(updated), change: 'unassigned', actorId });
    return updated;
  }

  async setStatus(ticketId: string, status: TicketStatus, actorId: string | null): Promise<Ticket> {
    if (status === 'CLOSED')
      throw new AppError(HttpStatus.BAD_REQUEST, 'USE_CLOSE', 'Yopish uchun close amalidan foydalaning');
    const before = await this.requireTicket(ticketId);
    if (before.status === status) return before;
    if (!ALLOWED_STATUS[before.status].includes(status)) {
      throw new AppError(HttpStatus.CONFLICT, 'BAD_TRANSITION', `${before.status} -> ${status} mumkin emas`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      // optimistic guard: only apply if nobody changed the status meanwhile
      const r = await tx.ticket.updateMany({
        where: { id: ticketId, status: before.status },
        data: { status },
      });
      if (r.count !== 1)
        throw new AppError(HttpStatus.CONFLICT, 'CONFLICT', "Tiket boshqa tomonidan o'zgartirildi");
      await this.ev(tx, ticketId, 'STATUS_CHANGED', actorId, { from: before.status, to: status });
      return tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    });
    this.events.emit('ticket.updated', { ...snapshot(updated), change: `status:${status}`, actorId });
    return updated;
  }

  async close(ticketId: string, actorId: string | null, solutionNote?: string): Promise<Ticket> {
    const before = await this.requireTicket(ticketId);
    if (before.status === 'CLOSED') return before; // idempotent
    const note = solutionNote?.trim() || null;
    let didClose = false;
    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.ticket.updateMany({
        where: { id: ticketId, status: { not: 'CLOSED' } },
        data: { status: 'CLOSED', closedAt: new Date(), closedById: actorId, solutionNote: note },
      });
      if (r.count === 1) {
        didClose = true; // only the call that actually flipped the row emits the event
        await this.ev(tx, ticketId, 'CLOSED', actorId, { solutionNote: note, from: before.status });
      }
      return tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    });
    if (didClose) this.events.emit('ticket.closed', { ...snapshot(updated), solutionNote: note, actorId });
    return updated;
  }

  async addNote(ticketId: string, text: string, actorId: string | null, chatId?: string): Promise<void> {
    const ticket = await this.requireTicket(ticketId);
    await this.prisma.$transaction(async (tx) => {
      const group = await tx.clientGroup.findUniqueOrThrow({ where: { id: ticket.clientGroupId } });
      await tx.ticketMessage.create({
        data: {
          ticketId,
          chatId: chatId ?? group.telegramChatId,
          direction: 'OUT',
          text,
          isInternalNote: true,
          answeredById: actorId,
        },
      });
      await this.ev(tx, ticketId, 'NOTE_ADDED', actorId, { length: text.length });
    });
  }

  /** Merge an open ticket into another open ticket (e.g. the same issue reported from two groups of one client). */
  async merge(sourceId: string, targetId: string, actorId: string): Promise<Ticket> {
    if (sourceId === targetId)
      throw new AppError(HttpStatus.BAD_REQUEST, 'SAME_TICKET', "Bir xil tiketni birlashtirib bo'lmaydi");
    const [source, target] = await Promise.all([this.requireTicket(sourceId), this.requireTicket(targetId)]);
    if (source.status === 'CLOSED' || target.status === 'CLOSED') {
      throw new AppError(HttpStatus.CONFLICT, 'CLOSED', "Yopilgan tiketni birlashtirib bo'lmaydi");
    }
    const merged = await this.prisma.$transaction(async (tx) => {
      await tx.ticketMessage.updateMany({ where: { ticketId: sourceId }, data: { ticketId: targetId } });
      await tx.ticket.update({
        where: { id: sourceId },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: actorId,
          mergedIntoId: targetId,
          solutionNote: `Birlashtirildi: #${target.number}`,
        },
      });
      await this.ev(tx, sourceId, 'MERGED', actorId, { into: targetId });
      await this.ev(tx, targetId, 'MERGED', actorId, { from: sourceId });
      return tx.ticket.update({ where: { id: targetId }, data: { lastActivityAt: new Date() } });
    });
    this.events.emit('ticket.closed', {
      ...snapshot(await this.requireTicket(sourceId)),
      solutionNote: null,
      actorId,
    });
    return merged;
  }

  // ------------------------------------------------------------------ queries

  async list(filter: z.infer<typeof ticketFilterSchema>) {
    const where: Prisma.TicketWhereInput = {
      status: filter.status,
      assigneeId: filter.assigneeId,
      clientGroupId: filter.clientGroupId,
      systemType: filter.systemType,
      urgency: filter.urgency,
    };
    if (filter.q) {
      const n = Number(filter.q.replace('#', ''));
      where.OR = [
        { summary: { contains: filter.q, mode: 'insensitive' } },
        { clientGroup: { companyName: { contains: filter.q, mode: 'insensitive' } } },
        ...(Number.isInteger(n) ? [{ number: n }] : []),
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: detailInclude,
        orderBy: { openedAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return { items, total, page: filter.page, pageSize: filter.pageSize };
  }

  async detail(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        ...detailInclude,
        messages: { orderBy: { sentAt: 'asc' }, take: 500 },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', t('ticket.notFound'));
    return {
      ...ticket,
      cardMessageId: ticket.cardMessageId?.toString() ?? null,
      messages: ticket.messages.map((m) => ({
        ...m,
        telegramMessageId: m.telegramMessageId?.toString() ?? null,
        senderTelegramId: m.senderTelegramId?.toString() ?? null,
      })),
    };
  }

  /** Current open ticket (and the latest closed one) for a client group: what the extension shows next to a chat. */
  async forGroup(clientGroupId: string) {
    const [current, last] = await Promise.all([
      this.prisma.ticket.findFirst({
        where: { clientGroupId, status: { not: 'CLOSED' } },
        include: detailInclude,
      }),
      this.prisma.ticket.findFirst({
        where: { clientGroupId, status: 'CLOSED' },
        orderBy: { closedAt: 'desc' },
        include: detailInclude,
      }),
    ]);
    return { current, lastClosed: last };
  }

  // ------------------------------------------------------------------ helpers

  private async requireTicket(id: string): Promise<Ticket> {
    const tk = await this.prisma.ticket.findUnique({ where: { id } });
    if (!tk) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', t('ticket.notFound'));
    return tk;
  }

  private async requireActiveUser(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u || !u.isActive)
      throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_ASSIGNEE', 'Xodim topilmadi yoki faol emas');
    return u;
  }

  private ev(tx: Tx, ticketId: string, type: string, actorId: string | null, payload: Prisma.InputJsonValue) {
    return tx.ticketEvent.create({ data: { ticketId, type, actorId, payload } });
  }
}
