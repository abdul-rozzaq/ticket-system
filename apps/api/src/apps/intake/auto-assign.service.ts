import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { AssignmentStrategy } from '@tp/shared';
import { PrismaService } from '../../common/prisma.service';
import { DomainEvents } from '../../common/domain-events';
import { SettingsService } from '../../common/settings.service';
import { TicketsService } from '../tickets/tickets.service';
import { pickAssignee, suggestAssignee, type Candidate } from '../../common/domain/assignment';
import { workingHoursSchema } from '@tp/shared';

/** Applies the configured assignment strategy (global default, overridable per client group) to every new ticket. */
@Injectable()
export class AutoAssignService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AutoAssign');
  private off?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly settings: SettingsService,
    private readonly tickets: TicketsService,
  ) {}

  onModuleInit() {
    this.off = this.events.on('ticket.created', (p) => this.onCreated(p.ticketId));
  }
  onModuleDestroy() {
    this.off?.();
  }

  async candidates(): Promise<Candidate[]> {
    const [users, open, last] = await Promise.all([
      this.prisma.user.findMany({ where: { isActive: true, role: { in: ['STAFF', 'ADMIN'] } } }),
      this.prisma.ticket.groupBy({
        by: ['assigneeId'],
        where: { status: { not: 'CLOSED' }, assigneeId: { not: null } },
        _count: true,
      }),
      this.prisma.ticket.groupBy({
        by: ['assigneeId'],
        where: { assigneeId: { not: null } },
        _max: { openedAt: true },
      }),
    ]);
    const count = new Map(open.map((o) => [o.assigneeId, o._count]));
    const lastAt = new Map(last.map((l) => [l.assigneeId, l._max.openedAt]));
    return users.map((u) => ({
      id: u.id,
      isActive: u.isActive,
      available: u.available,
      onDuty: u.onDuty,
      openCount: count.get(u.id) ?? 0,
      lastAssignedAt: lastAt.get(u.id) ?? null,
      workingHours: u.workingHours ? (workingHoursSchema.safeParse(u.workingHours).data ?? null) : null,
    }));
  }

  /** Hint for manual cards (bot): previous handler of this client, else least loaded. */
  async suggestFor(clientGroupId: string): Promise<string | null> {
    const prev = await this.prisma.ticket.findFirst({
      where: { clientGroupId, assigneeId: { not: null } },
      orderBy: { openedAt: 'desc' },
    });
    return suggestAssignee(await this.candidates(), { lastHandlerId: prev?.assigneeId });
  }

  async onCreated(ticketId: string): Promise<void> {
    try {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { clientGroup: true },
      });
      if (!ticket || ticket.assigneeId) return;
      const strategy = (ticket.clientGroup.assignmentStrategy ??
        (await this.settings.get('assignment.strategy'))) as AssignmentStrategy;
      const pick = pickAssignee(strategy, await this.candidates(), {
        fixedOwnerId: ticket.clientGroup.defaultOwnerId,
      });
      if (pick) await this.tickets.assign(ticketId, pick, null);
    } catch (e) {
      this.logger.warn(`auto-assign failed for ${ticketId}: ${String(e)}`); // never block ticket creation
    }
  }
}
