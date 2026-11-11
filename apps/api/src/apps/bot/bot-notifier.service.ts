import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { t } from '@tp/shared';
import { PrismaService } from '../../common/prisma.service';
import { DomainEvents } from '../../common/domain-events';
import { escapeHtml } from './card';
import { BotConfigService, BotOutboxService, CardService } from './bot-core.service';

/** Turns domain events into bot messages: the card for new tickets, card edits, and DMs to the assignee. */
@Injectable()
export class BotNotifier implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('BotNotifier');
  private offs: Array<() => void> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly cfg: BotConfigService,
    private readonly outbox: BotOutboxService,
    private readonly cards: CardService,
  ) {}

  onModuleInit() {
    const safe =
      <A>(fn: (p: A) => Promise<void>) =>
      (p: A) =>
        fn(p).catch((e) => this.logger.warn(`bot notification failed: ${String(e)}`));
    this.offs = [
      this.events.on(
        'ticket.created',
        safe((p) => this.sendCard(p.ticketId)),
      ),
      this.events.on(
        'ticket.updated',
        safe((p) => this.editCard(p.ticketId)),
      ),
      this.events.on(
        'ticket.closed',
        safe((p) => this.editCard(p.ticketId)),
      ),
      this.events.on(
        'ticket.assigned',
        safe(async (p) => {
          await this.editCard(p.ticketId);
          if (p.assigneeId && p.assigneeId !== p.actorId)
            await this.dmAssignee(p.ticketId, p.assigneeId, p.handoverNote);
        }),
      ),
    ];
  }
  onModuleDestroy() {
    this.offs.forEach((o) => o());
  }

  async sendCard(ticketId: string): Promise<void> {
    const chatId = (await this.cfg.get()).internalChatId;
    if (!chatId) {
      this.logger.warn('internal group is not configured: new ticket card not posted');
      return;
    }
    const card = await this.cards.render(ticketId);
    if (card)
      await this.outbox.enqueue('SEND_CARD', { ticketId, chatId, text: card.text, keyboard: card.keyboard });
  }

  /** Re-renders the card from the CURRENT database state and enqueues an edit (no-op while the card is not sent yet). */
  async editCard(ticketId: string): Promise<void> {
    const tk = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { cardChatId: true, cardMessageId: true },
    });
    if (!tk?.cardChatId || !tk.cardMessageId) return;
    const card = await this.cards.render(ticketId);
    if (card) {
      await this.outbox.enqueue('EDIT_CARD', {
        ticketId,
        chatId: tk.cardChatId,
        messageId: tk.cardMessageId.toString(),
        text: card.text,
        keyboard: card.keyboard,
      });
    }
  }

  /** A new card may be assigned/closed before the bot managed to post it: once it has a message id, bring it up to date. */
  async afterCardSent(ticketId: string, postedText: string): Promise<void> {
    const card = await this.cards.render(ticketId);
    if (card && card.text !== postedText) await this.editCard(ticketId);
  }

  private async dmAssignee(ticketId: string, assigneeId: string, handoverNote?: string): Promise<void> {
    const [user, tk] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: assigneeId } }),
      this.prisma.ticket.findUnique({ where: { id: ticketId }, include: { clientGroup: true } }),
    ]);
    if (!user?.telegramUserId || !tk) return;
    let text = t('bot.assignedDm', { number: tk.number, company: escapeHtml(tk.clientGroup.companyName) });
    if (handoverNote) text += `\n${t('bot.handover', { note: escapeHtml(handoverNote) })}`;
    await this.outbox.enqueue('SEND_TEXT', { chatId: user.telegramUserId.toString(), text });
  }
}
