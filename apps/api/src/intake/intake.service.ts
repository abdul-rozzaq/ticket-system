import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, type ClientGroup, type Ticket } from '@prisma/client';
import { maskSensitive, normalizePeerId, parseStoredPeer, type AiClassification } from '@tp/shared';
import { APP_ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { TicketsService } from '../tickets/tickets.service';
import { ClientGroupsService } from '../client-groups/client-groups.service';
import { DomainEvents } from '../events/domain-events';
import { IntakeClassifier } from '../ai/ai.service';
import {
  hasUrgentKeyword,
  parseCommand,
  prefilter,
  DEFAULT_URGENT_KEYWORDS,
  type ParsedCommand,
} from '../domain/intake-rules';
import { AttributionService } from './attribution.service';
import { OutboxService } from './outbox.service';

export interface IncomingMessage {
  chatId: string;
  messageId: string;
  senderId: string | null;
  senderName: string | null;
  text: string;
  outgoing: boolean;
  replyToMessageId: string | null;
  date: string;
  hasMedia: boolean;
}

export interface ReactionEvent {
  chatId: string;
  messageId: string;
  emoji: string;
  byMe: boolean;
}

interface BufferItem {
  messageId: string | null;
  senderId: string | null;
  senderName: string | null;
  text: string;
  at: string;
}

export type MessageOutcome =
  | { action: 'ignored'; why: string }
  | { action: 'attached'; ticketId: string }
  | { action: 'filtered'; reason: string }
  | { action: 'buffered'; urgent: boolean }
  | { action: 'processed' }
  | { action: 'command'; command: string; ticketId: string | null }
  | { action: 'outgoing'; ticketId: string | null };

const splitList = (s: unknown): string[] =>
  String(s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * The intake pipeline (see PLAN.md §7). Order for a new incoming message in an active customer group:
 *   1. open ticket exists      -> attach (refreshes activity), no AI
 *   2. rules pre-filter        -> FilteredMessage (emoji, too short, thanks/ack ...)
 *   3. debounce buffer         -> one problem = one ticket even if the customer sends 5 messages
 *   4. AI classification       -> request / not a request; below threshold or ANY failure => fail-open (open the ticket)
 */
@Injectable()
export class IntakeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Intake');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly tickets: TicketsService,
    private readonly groups: ClientGroupsService,
    private readonly events: DomainEvents,
    private readonly classifier: IntakeClassifier,
    private readonly attribution: AttributionService,
    private readonly outbox: OutboxService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (this.env.INTAKE_POLL_MS > 0) {
      this.timer = setInterval(
        () => void this.processDue().catch((e) => this.logger.warn(`processDue failed: ${String(e)}`)),
        this.env.INTAKE_POLL_MS,
      );
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- entry points

  async handleMessage(ev: IncomingMessage): Promise<MessageOutcome> {
    const group = await this.groups.findByAnyId(ev.chatId);
    if (!group || !group.isActive)
      return { action: 'ignored', why: group ? 'group inactive' : 'unknown group' };
    return ev.outgoing ? this.handleOutgoing(group, ev) : this.handleIncoming(group, ev);
  }

  // ---------------------------------------------------------------- incoming

  private async handleIncoming(group: ClientGroup, ev: IncomingMessage): Promise<MessageOutcome> {
    const open = await this.prisma.ticket.findFirst({
      where: { clientGroupId: group.id, status: { not: 'CLOSED' } },
    });
    if (open) {
      await this.tickets.attachMessage(open.id, group.telegramChatId, {
        telegramMessageId: BigInt(ev.messageId),
        senderTelegramId: ev.senderId ? BigInt(ev.senderId) : null,
        senderName: ev.senderName,
        direction: 'IN',
        text: ev.text || (ev.hasMedia ? '[media]' : ''),
        sentAt: new Date(ev.date),
      });
      return { action: 'attached', ticketId: open.id };
    }

    const reason = prefilter(ev.text, {
      minChars: await this.settings.get('intake.minChars'),
      extraStopWords: splitList(await this.settings.get('intake.stopWords')),
    });
    if (reason) {
      await this.recordFiltered(group.id, ev, reason);
      return { action: 'filtered', reason };
    }

    const urgent = hasUrgentKeyword(ev.text, [
      ...DEFAULT_URGENT_KEYWORDS,
      ...splitList(await this.settings.get('intake.urgentKeywords')),
    ]);
    await this.appendToBuffer(group, ev, urgent);
    if (urgent) {
      // Urgent messages skip the debounce window.
      await this.processGroup(group.id);
      return { action: 'processed' };
    }
    return { action: 'buffered', urgent: false };
  }

  private async appendToBuffer(group: ClientGroup, ev: IncomingMessage, urgent: boolean) {
    const item: BufferItem = {
      messageId: ev.messageId,
      senderId: ev.senderId,
      senderName: ev.senderName,
      text: ev.text,
      at: ev.date,
    };
    // Atomic append: concurrent messages from the same group never overwrite each other.
    await this.prisma.$executeRaw`
      INSERT INTO "IntakeBuffer" ("id", "clientGroupId", "chatId", "items", "urgent", "firstAt", "lastAt")
      VALUES (gen_random_uuid(), ${group.id}::uuid, ${group.telegramChatId}, ${JSON.stringify([item])}::jsonb, ${urgent}, now(), now())
      ON CONFLICT ("clientGroupId") DO UPDATE SET
        "items" = "IntakeBuffer"."items" || EXCLUDED."items",
        "urgent" = "IntakeBuffer"."urgent" OR EXCLUDED."urgent",
        "lastAt" = now()`;
  }

  // ---------------------------------------------------------------- outgoing (the TP account itself)

  private async handleOutgoing(group: ClientGroup, ev: IncomingMessage): Promise<MessageOutcome> {
    const sentAt = new Date(ev.date);
    const cmd = parseCommand(ev.text);
    if (cmd) return this.runCommand(group, cmd, ev, sentAt);

    // If the customer's messages are still waiting in the debounce buffer, staff is already engaged: open the ticket now.
    if (!(await this.openTicket(group.id))) await this.processGroup(group.id);
    const ticket = await this.openTicket(group.id);
    if (!ticket) return { action: 'outgoing', ticketId: null };
    const who = await this.attribution.attribute(group.telegramChatId, sentAt);
    await this.tickets.attachMessage(ticket.id, group.telegramChatId, {
      telegramMessageId: BigInt(ev.messageId),
      senderName: ev.senderName,
      direction: 'OUT',
      text: ev.text || (ev.hasMedia ? '[media]' : ''),
      answeredById: who?.userId ?? null,
      answeredConfidence: who?.confidence ?? null,
      sentAt,
    });
    return { action: 'outgoing', ticketId: ticket.id };
  }

  private openTicket(clientGroupId: string): Promise<Ticket | null> {
    return this.prisma.ticket.findFirst({ where: { clientGroupId, status: { not: 'CLOSED' } } });
  }

  /** The ticket a message belongs to: the one it replies to, else the group's open ticket. */
  private async ticketFor(group: ClientGroup, replyToMessageId: string | null): Promise<Ticket | null> {
    if (replyToMessageId && /^\d+$/.test(replyToMessageId)) {
      const m = await this.prisma.ticketMessage.findFirst({
        where: { chatId: group.telegramChatId, telegramMessageId: BigInt(replyToMessageId) },
        include: { ticket: true },
      });
      if (m) return m.ticket;
    }
    return this.openTicket(group.id);
  }

  private async runCommand(
    group: ClientGroup,
    cmd: ParsedCommand,
    ev: IncomingMessage,
    sentAt: Date,
  ): Promise<MessageOutcome> {
    const ticket = await this.ticketFor(group, ev.replyToMessageId);
    const who = await this.attribution.attribute(group.telegramChatId, sentAt);
    const actorId = who?.userId ?? null;

    if (ticket) {
      switch (cmd.name) {
        case 'done':
          await this.tickets.close(ticket.id, actorId, cmd.arg || undefined);
          break;
        case 'wait':
          if (ticket.status !== 'CLOSED' && ticket.status !== 'WAITING_CLIENT')
            await this.tickets.setStatus(ticket.id, 'WAITING_CLIENT', actorId);
          break;
        case 'note':
          if (cmd.arg) await this.tickets.addNote(ticket.id, cmd.arg, actorId, group.telegramChatId);
          break;
        case 'ai':
          this.events.emit('ai.requested', {
            ticketId: ticket.id,
            chatId: group.telegramChatId,
            actorId,
            messageId: ev.replyToMessageId,
          });
          break;
      }
    }
    // Remove the staff's own command message from the customer chat (only our own outgoing message, setting-controlled).
    if (await this.settings.get('commands.deleteAfterUse')) {
      await this.outbox.enqueue('DELETE_MESSAGES', { chatId: ev.chatId, messageIds: [ev.messageId] });
    }
    return { action: 'command', command: cmd.name, ticketId: ticket?.id ?? null };
  }

  // ---------------------------------------------------------------- reactions (best effort)

  async handleReaction(ev: ReactionEvent): Promise<{ action: string }> {
    if (!ev.byMe || !(await this.settings.get('reactions.enabled'))) return { action: 'ignored' };
    const group = await this.groups.findByAnyId(ev.chatId);
    if (!group?.isActive) return { action: 'ignored' };
    const ticket = await this.ticketFor(group, ev.messageId);
    if (!ticket || ticket.status === 'CLOSED') return { action: 'ignored' };
    const who = await this.attribution.attribute(group.telegramChatId, new Date());
    if (ev.emoji === '✅') {
      await this.tickets.close(ticket.id, who?.userId ?? null);
      return { action: 'closed' };
    }
    if (ev.emoji === '👀') {
      return { action: (await this.tickets.markSeen(ticket.id, who?.userId ?? null)) ? 'seen' : 'ignored' };
    }
    return { action: 'ignored' };
  }

  // ---------------------------------------------------------------- debounce processing

  /** Process every buffer whose last message is older than the debounce window. Safe to call concurrently. */
  async processDue(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const debounce = await this.settings.get('intake.debounceSeconds');
      const cutoff = new Date(now.getTime() - debounce * 1000);
      const due = await this.prisma.intakeBuffer.findMany({
        where: { lastAt: { lte: cutoff } },
        select: { clientGroupId: true },
      });
      let n = 0;
      for (const d of due) if (await this.processGroup(d.clientGroupId)) n++;
      return n;
    } finally {
      this.running = false;
    }
  }

  /** Claims (deletes) the group's buffer atomically and turns it into a ticket / filtered messages. */
  async processGroup(clientGroupId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; items: BufferItem[]; urgent: boolean }>>`
      DELETE FROM "IntakeBuffer" WHERE "clientGroupId" = ${clientGroupId}::uuid RETURNING "id", "items", "urgent"`;
    if (!rows.length) return false;
    const group = await this.prisma.clientGroup.findUnique({ where: { id: clientGroupId } });
    if (!group) return false;
    // de-duplicate redelivered messages
    const seen = new Set<string>();
    const items = rows[0].items.filter(
      (i) => !i.messageId || (!seen.has(i.messageId) && seen.add(i.messageId)),
    );
    try {
      await this.classifyAndOpen(group, items, rows[0].urgent);
    } catch (e) {
      // DB trouble: put the messages back so nothing is lost, and let the next tick retry.
      this.logger.error(`intake processing failed for group ${group.id}: ${String(e)}`);
      for (const i of items) {
        await this.prisma.$executeRaw`
          INSERT INTO "IntakeBuffer" ("id", "clientGroupId", "chatId", "items", "urgent", "firstAt", "lastAt")
          VALUES (gen_random_uuid(), ${group.id}::uuid, ${group.telegramChatId}, ${JSON.stringify([i])}::jsonb, ${rows[0].urgent}, now(), now() - interval '1 hour')
          ON CONFLICT ("clientGroupId") DO UPDATE SET "items" = "IntakeBuffer"."items" || EXCLUDED."items"`;
      }
      return false;
    }
    return true;
  }

  private async classifyAndOpen(group: ClientGroup, items: BufferItem[], urgentKeyword: boolean) {
    const threshold = await this.settings.get('intake.confidenceThreshold');
    const text = items.map((i) => i.text).join('\n');
    const masked = maskSensitive(text).text; // secrets never reach the AI provider
    const context = await this.recentContext(group, await this.settings.get('intake.contextMessages'));

    let verdict: AiClassification | null = null;
    let failure: string | null = null;
    try {
      verdict = await this.classifier.classify(masked, context);
    } catch (e) {
      failure = String(e).slice(0, 200); // fail-open: any AI problem (not configured, budget, timeout, bad JSON) opens the ticket
      this.logger.warn(
        `AI classification failed for group ${group.id}, opening ticket (fail-open): ${failure}`,
      );
    }

    if (verdict && !verdict.isRequest && verdict.confidence >= threshold) {
      for (const i of items) await this.recordFilteredItem(group.id, i, 'AI_NOT_REQUEST', verdict);
      return;
    }
    const confident = !!verdict && verdict.isRequest && verdict.confidence >= threshold;
    const first = items[0];
    const { ticket } = await this.tickets.createTicket({
      clientGroupId: group.id,
      text: first.text,
      senderName: first.senderName,
      senderTelegramId: first.senderId ? BigInt(first.senderId) : null,
      telegramMessageId: first.messageId ? BigInt(first.messageId) : null,
      urgency: urgentKeyword ? 'HIGH' : (verdict?.urgency ?? 'NORMAL'),
      category: verdict?.category,
      systemType: verdict && verdict.systemType !== 'OTHER' ? verdict.systemType : undefined,
      summary: verdict?.summary || undefined,
      aiConfidence: verdict?.confidence ?? null,
      needsReview: !confident,
    });
    for (const i of items.slice(1)) {
      await this.tickets.attachMessage(ticket.id, group.telegramChatId, {
        telegramMessageId: i.messageId ? BigInt(i.messageId) : null,
        senderTelegramId: i.senderId ? BigInt(i.senderId) : null,
        senderName: i.senderName,
        direction: 'IN',
        text: i.text,
        sentAt: new Date(i.at),
      });
    }
    await this.prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'AI_CLASSIFIED',
        payload: { verdict, failure, confident } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Last few messages of this chat (masked), so "yes, that one" style follow-ups can be judged. */
  private async recentContext(group: ClientGroup, limit: number): Promise<string[]> {
    if (limit <= 0) return [];
    const rows = await this.prisma.ticketMessage.findMany({
      where: { chatId: group.telegramChatId, isInternalNote: false },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
    return rows
      .reverse()
      .map(
        (m) => `${m.direction === 'OUT' ? 'staff' : 'customer'}: ${maskSensitive(m.text).text.slice(0, 300)}`,
      );
  }

  // ---------------------------------------------------------------- filtered messages

  private recordFiltered(clientGroupId: string, ev: IncomingMessage, reason: string) {
    return this.recordFilteredItem(
      clientGroupId,
      {
        messageId: ev.messageId,
        senderId: ev.senderId,
        senderName: ev.senderName,
        text: ev.text,
        at: ev.date,
      },
      reason,
    );
  }

  private async recordFilteredItem(
    clientGroupId: string,
    i: BufferItem,
    reason: string,
    verdict?: AiClassification,
  ) {
    try {
      await this.prisma.filteredMessage.create({
        data: {
          clientGroupId,
          telegramMessageId: i.messageId ? BigInt(i.messageId) : null,
          senderName: i.senderName,
          text: i.text,
          reason,
          aiVerdict: verdict ? (verdict as unknown as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch (e) {
      if (!isUnique(e)) throw e; // redelivery of the same message
    }
  }

  /** "Create ticket from this" button in the admin panel. */
  async createTicketFromFiltered(filteredId: string, actorId: string) {
    const f = await this.prisma.filteredMessage.findUniqueOrThrow({ where: { id: filteredId } });
    const r = await this.tickets.createTicket({
      clientGroupId: f.clientGroupId,
      text: f.text,
      senderName: f.senderName,
      telegramMessageId: f.telegramMessageId,
      createdFromFilteredId: f.id,
      actorId,
    });
    await this.prisma.filteredMessage.update({ where: { id: f.id }, data: { createdTicketId: r.ticket.id } });
    return r;
  }

  /** Utility for tests/tools: parse either key format. */
  static normaliseChat(raw: string) {
    return parseStoredPeer(raw) ?? normalizePeerId(raw);
  }
}
