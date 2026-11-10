import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { workingHoursSchema } from '@tp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AppError } from '../common/http';
import { renderCard, type Keyboard, type RenderedCard } from './card';
import { AutoAssignService } from '../intake/auto-assign.service';

/** Bot settings stored as one JSON row in `Setting` (the token is AES-256-GCM encrypted). */
export interface BotConfig {
  tokenEnc?: string | null;
  /** Telegram chat id of the internal group (e.g. -1001234567890). */
  internalChatId?: string | null;
  /** Staff user id mentioned when a ticket stays unassigned. */
  escalationUserId?: string | null;
}

@Injectable()
export class BotConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async get(): Promise<BotConfig> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'bot.config' } });
    return (row?.value ?? {}) as BotConfig;
  }

  async patch(p: { token?: string; internalChatId?: string | null; escalationUserId?: string | null }) {
    const cur = await this.get();
    const next: BotConfig = {
      ...cur,
      ...(p.token ? { tokenEnc: this.crypto.encrypt(p.token) } : {}),
      ...(p.internalChatId !== undefined ? { internalChatId: p.internalChatId } : {}),
      ...(p.escalationUserId !== undefined ? { escalationUserId: p.escalationUserId } : {}),
    };
    await this.prisma.setting.upsert({
      where: { key: 'bot.config' },
      create: { key: 'bot.config', value: next as Prisma.InputJsonValue },
      update: { value: next as Prisma.InputJsonValue },
    });
  }

  async token(): Promise<string | null> {
    const c = await this.get();
    if (!c.tokenEnc) return null;
    try {
      return this.crypto.decrypt(c.tokenEnc);
    } catch {
      return null;
    }
  }

  async setStatus(state: string, detail?: string) {
    const v = { at: new Date().toISOString(), state, detail: detail ?? null };
    await this.prisma.setting.upsert({
      where: { key: 'bot.status' },
      create: { key: 'bot.status', value: v },
      update: { value: v },
    });
  }
  async status() {
    const row = await this.prisma.setting.findUnique({ where: { key: 'bot.status' } });
    const v = row?.value as { at: string; state: string; detail: string | null } | undefined;
    return {
      ...(v ?? { at: null, state: 'UNKNOWN', detail: null }),
      alive: !!v && Date.now() - new Date(v.at).getTime() < 120_000,
    };
  }
}

export type BotOutboxKind = 'SEND_CARD' | 'EDIT_CARD' | 'SEND_TEXT';
const MAX_ATTEMPTS = 3;

/** Messages the bot process must send/edit. Same long-poll contract as the userbot outbox. */
@Injectable()
export class BotOutboxService {
  constructor(private readonly prisma: PrismaService) {}

  enqueue(kind: BotOutboxKind, payload: Record<string, unknown>) {
    return this.prisma.botOutbox.create({ data: { kind, payload: payload as Prisma.InputJsonValue } });
  }

  /** Claims pending items; items claimed by a bot that died (> 2 min ago) are handed out again. */
  async claim(waitSeconds: number, limit = 20) {
    const deadline = Date.now() + Math.min(Math.max(waitSeconds, 0), 25) * 1000;
    for (;;) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string; kind: string; payload: unknown }>>`
        UPDATE "BotOutbox" SET "status" = 'CLAIMED', "claimedAt" = now(), "attempts" = "attempts" + 1
        WHERE "id" IN (
          SELECT "id" FROM "BotOutbox"
          WHERE "status" = 'PENDING' OR ("status" = 'CLAIMED' AND "claimedAt" < now() - interval '2 minutes')
          ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
        ) RETURNING "id", "kind", "payload"`;
      if (rows.length || Date.now() >= deadline) return rows;
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  /** Failed sends are retried up to MAX_ATTEMPTS times, then marked FAILED. */
  async complete(id: string, ok: boolean, result: Record<string, unknown> = {}, error?: string) {
    const row = await this.prisma.botOutbox.findUnique({ where: { id } });
    if (!row) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'outbox item not found');
    const retry = !ok && row.attempts < MAX_ATTEMPTS;
    await this.prisma.botOutbox.update({
      where: { id },
      data: {
        status: ok ? 'DONE' : retry ? 'PENDING' : 'FAILED',
        result: { ...result, ...(error ? { error: error.slice(0, 300) } : {}) } as Prisma.InputJsonValue,
        doneAt: ok || !retry ? new Date() : null,
      },
    });
    return row;
  }
}

/** Loads everything needed to render a card for a ticket and renders it. */
@Injectable()
export class CardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autoAssign: AutoAssignService,
  ) {}

  async staffForCard() {
    const [users, open] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true, available: true },
        orderBy: { displayName: 'asc' },
      }),
      this.prisma.ticket.groupBy({
        by: ['assigneeId'],
        where: { status: { not: 'CLOSED' }, assigneeId: { not: null } },
        _count: true,
      }),
    ]);
    const count = new Map(open.map((o) => [o.assigneeId, o._count]));
    return users.map((u) => ({ id: u.id, name: u.displayName, openCount: count.get(u.id) ?? 0 }));
  }

  async render(ticketId: string, opts: { reassignMenu?: boolean } = {}): Promise<RenderedCard | null> {
    const t = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        clientGroup: true,
        assignee: true,
        messages: { where: { direction: 'IN', isInternalNote: false }, orderBy: { sentAt: 'asc' }, take: 1 },
      },
    });
    if (!t) return null;
    const wh = workingHoursSchema.safeParse(t.assignee?.workingHours ?? {}).data;
    return renderCard({
      ticket: {
        number: t.number,
        status: t.status,
        urgency: t.urgency,
        summary: t.summary,
        systemType: t.systemType,
        category: t.category,
        openedAt: t.openedAt,
        needsReview: t.needsReview,
        solutionNote: t.solutionNote,
        assigneeName: t.assignee?.displayName ?? null,
      },
      company: t.clientGroup.companyName,
      firstText: t.messages[0]?.text ?? t.summary,
      chatKey: t.clientGroup.telegramChatId,
      staff: await this.staffForCard(),
      suggestedId: t.assigneeId ? null : await this.autoAssign.suggestFor(t.clientGroupId),
      reassignMenu: opts.reassignMenu,
      tz: wh?.tz,
    });
  }
}

export type { Keyboard };
