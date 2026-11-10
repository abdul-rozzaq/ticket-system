import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export interface TicketSnapshot {
  ticketId: string;
  number: number;
  clientGroupId: string;
  status: string;
  assigneeId: string | null;
  urgency: string;
  summary: string;
}

/** Everything other parts of the system (realtime gateway, bot, folder reconcile, KB growth) may react to. */
export interface DomainEventMap {
  'ticket.created': TicketSnapshot & { needsReview: boolean };
  'ticket.updated': TicketSnapshot & { change: string; actorId: string | null };
  'ticket.assigned': TicketSnapshot & { previousAssigneeId: string | null; actorId: string | null; handoverNote?: string };
  'ticket.closed': TicketSnapshot & { solutionNote: string | null; actorId: string | null };
  'ai.requested': { ticketId: string; chatId: string; actorId: string | null; messageId: string | null };
  'ticket.message': { ticketId: string; direction: 'IN' | 'OUT'; isFirstResponse: boolean };
}

/**
 * In-process typed event bus. Listener failures are isolated: a broken subscriber must never fail the
 * request that produced the event. (Cross-process fan-out to the bot/userbot goes through BullMQ in later phases.)
 */
@Injectable()
export class DomainEvents {
  private readonly logger = new Logger('DomainEvents');
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit<K extends keyof DomainEventMap>(event: K, payload: DomainEventMap[K]): void {
    for (const l of this.emitter.listeners(event) as Array<(p: DomainEventMap[K]) => unknown>) {
      try {
        const r = l(payload);
        if (r instanceof Promise) r.catch((e) => this.logger.warn(`listener for ${event} failed: ${String(e)}`));
      } catch (e) {
        this.logger.warn(`listener for ${event} failed: ${String(e)}`);
      }
    }
  }

  on<K extends keyof DomainEventMap>(event: K, listener: (p: DomainEventMap[K]) => unknown): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }
}

@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class EventsModule {}
