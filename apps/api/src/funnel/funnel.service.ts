import { HttpStatus, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { slaInfo, t } from '@tp/shared';
import type { Prisma, Ticket } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { DomainEvents } from '../events/domain-events';
import { AppError } from '../common/http';
import { folderKeyForTicket } from '../domain/folders';

export type StageKey = 'NEW' | 'WAITING' | 'OVERDUE' | 'CLOSED' | `USER:${string}`;
const SYSTEM_KINDS = ['NEW', 'WAITING', 'OVERDUE', 'CLOSED'] as const;
type SystemKind = (typeof SYSTEM_KINDS)[number];

export interface StageDto {
  id: string;
  kind: SystemKind;
  title: string;
  position: number;
  isActive: boolean;
}

export interface BoardCard {
  id: string;
  number: number;
  company: string;
  summary: string;
  urgency: string;
  status: string;
  systemType: string;
  assigneeId: string | null;
  assigneeName: string | null;
  openedAt: Date;
  slaDeadline: Date;
  overdue: boolean;
  needsReview: boolean;
}

export interface BoardColumn {
  key: StageKey;
  kind: SystemKind | 'STAFF';
  title: string;
  userId?: string;
  cards: BoardCard[];
}

export interface BoardFilter {
  assigneeId?: string;
  systemType?: string;
  clientGroupId?: string;
}

const CLOSED_COLUMN_DAYS = 2;
const CLOSED_COLUMN_MAX = 50;

/**
 * Which stage (= Kanban column = Telegram folder) a ticket belongs to. Exactly one, or null for closed tickets.
 * "Kechikkan" is virtual (computed from the SLA deadline, never stored). Disabled optional stages fall back to the
 * assignee's column / "Yangi", so the board and the Telegram folders always agree.
 */
export function stageKeyFor(
  tk: Pick<Ticket, 'status' | 'assigneeId' | 'slaDeadline'>,
  enabled: { WAITING: boolean; OVERDUE: boolean },
  now = Date.now(),
): StageKey | null {
  let key = folderKeyForTicket({
    status: tk.status,
    assigneeId: tk.assigneeId,
    overdue: slaInfo(tk, now).overdue,
  }) as StageKey | null;
  if (key === 'OVERDUE' && !enabled.OVERDUE)
    key =
      tk.status === 'WAITING_CLIENT' && enabled.WAITING
        ? 'WAITING'
        : tk.assigneeId
          ? `USER:${tk.assigneeId}`
          : 'NEW';
  if (key === 'WAITING' && !enabled.WAITING) key = tk.assigneeId ? `USER:${tk.assigneeId}` : 'NEW';
  return key;
}

@Injectable()
export class FunnelService implements OnModuleInit, OnModuleDestroy {
  private off?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly events: DomainEvents,
  ) {}

  /** A deactivated person's open tickets go back to "Yangi" (their folder disappears on the next folder sync). */
  onModuleInit() {
    this.off = this.events.on('user.deactivated', async ({ userId }) => {
      const open = await this.prisma.ticket.findMany({
        where: { assigneeId: userId, status: { not: 'CLOSED' } },
        select: { id: true },
      });
      for (const tk of open) await this.tickets.unassign(tk.id, null);
    });
  }
  onModuleDestroy() {
    this.off?.();
  }

  // ------------------------------------------------------------------ stage configuration

  /** The default funnel with its four system stages (created on first use). Per-staff stages are derived from active users. */
  async stages(): Promise<StageDto[]> {
    let funnel = await this.prisma.funnel.findFirst({ include: { stages: true } });
    if (!funnel) {
      funnel = await this.prisma.funnel.create({
        data: {
          name: 'default',
          stages: {
            create: SYSTEM_KINDS.map((kind, i) => ({
              kind,
              title: t(`stage.${kind}` as 'stage.NEW'),
              position: i === 0 ? 1 : i + 2,
              isActive: true,
            })),
          },
        },
        include: { stages: true },
      });
    }
    return funnel.stages
      .filter((s) => (SYSTEM_KINDS as readonly string[]).includes(s.kind))
      .map((s) => ({
        id: s.id,
        kind: s.kind as SystemKind,
        title: s.title,
        position: s.position,
        isActive: s.isActive,
      }))
      .sort((a, b) => a.position - b.position);
  }

  async updateStage(id: string, patch: { title?: string; position?: number; isActive?: boolean }) {
    const stage = (await this.stages()).find((s) => s.id === id);
    if (!stage) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Bosqich topilmadi');
    // "Yangi" and "Yopilgan" are structural: they cannot be switched off.
    if (patch.isActive === false && (stage.kind === 'NEW' || stage.kind === 'CLOSED')) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'REQUIRED_STAGE', "Bu bosqichni o'chirib bo'lmaydi");
    }
    await this.prisma.funnelStage.update({ where: { id }, data: patch });
    return (await this.stages()).find((s) => s.id === id)!;
  }

  async enabled(): Promise<{ WAITING: boolean; OVERDUE: boolean }> {
    const st = await this.stages();
    const on = (k: SystemKind) => st.find((s) => s.kind === k)?.isActive ?? true;
    return { WAITING: on('WAITING'), OVERDUE: on('OVERDUE') };
  }

  /**
   * People who get a Kanban column and a Telegram folder: every active STAFF member, plus an ADMIN only while they hold
   * open tickets (so a ticket is never left without a column).
   */
  async activeUsers() {
    const holders = await this.prisma.ticket.findMany({
      where: { status: { not: 'CLOSED' }, assigneeId: { not: null } },
      select: { assigneeId: true },
      distinct: ['assigneeId'],
    });
    const ids = holders.map((h) => h.assigneeId!);
    return this.prisma.user.findMany({
      where: { isActive: true, OR: [{ role: 'STAFF' }, { id: { in: ids } }] },
      orderBy: { displayName: 'asc' },
    });
  }

  // ------------------------------------------------------------------ Kanban board

  async board(filter: BoardFilter = {}, now = Date.now()): Promise<{ columns: BoardColumn[] }> {
    const [stages, users, enabled] = await Promise.all([this.stages(), this.activeUsers(), this.enabled()]);
    const where: Prisma.TicketWhereInput = {
      status: { not: 'CLOSED' },
      assigneeId: filter.assigneeId,
      clientGroupId: filter.clientGroupId,
      systemType: filter.systemType as never,
    };
    const [open, closed] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: { clientGroup: true, assignee: true },
        orderBy: [{ openedAt: 'asc' }],
      }),
      this.prisma.ticket.findMany({
        where: {
          ...where,
          status: 'CLOSED',
          closedAt: { gte: new Date(now - CLOSED_COLUMN_DAYS * 86_400_000) },
        },
        include: { clientGroup: true, assignee: true },
        orderBy: { closedAt: 'desc' },
        take: CLOSED_COLUMN_MAX,
      }),
    ]);

    const columns = new Map<StageKey, BoardColumn>();
    const add = (c: BoardColumn) => columns.set(c.key, c);
    const title = (k: SystemKind) =>
      stages.find((s) => s.kind === k)?.title ?? t(`stage.${k}` as 'stage.NEW');
    const isOn = (k: SystemKind) => stages.find((s) => s.kind === k)?.isActive ?? true;
    const order: BoardColumn[] = [];
    // Order: Yangi -> one column per staff member -> the remaining system stages by configured position.
    order.push({ key: 'NEW', kind: 'NEW', title: title('NEW'), cards: [] });
    for (const u of users)
      order.push({
        key: `USER:${u.id}`,
        kind: 'STAFF',
        title: `👤 ${u.displayName}`,
        userId: u.id,
        cards: [],
      });
    for (const s of stages.filter((x) => x.kind !== 'NEW'))
      if (isOn(s.kind)) order.push({ key: s.kind, kind: s.kind, title: s.title, cards: [] });
    order.forEach(add);

    const card = (tk: (typeof open)[number]): BoardCard => ({
      id: tk.id,
      number: tk.number,
      company: tk.clientGroup.companyName,
      summary: tk.summary,
      urgency: tk.urgency,
      status: tk.status,
      systemType: tk.systemType,
      assigneeId: tk.assigneeId,
      assigneeName: tk.assignee?.displayName ?? null,
      openedAt: tk.openedAt,
      slaDeadline: tk.slaDeadline,
      overdue: slaInfo(tk, now).overdue,
      needsReview: tk.needsReview,
    });
    for (const tk of open) {
      const key = stageKeyFor(tk, enabled, now);
      // a ticket assigned to an inactive person (should not happen: deactivation unassigns) is shown in "Yangi"
      const col = (key && columns.get(key)) ?? columns.get('NEW')!;
      col.cards.push(card(tk));
    }
    // urgent first inside a column, then oldest first
    const rank = { HIGH: 0, NORMAL: 1, LOW: 2 } as Record<string, number>;
    for (const c of columns.values())
      c.cards.sort(
        (a, b) =>
          (rank[a.urgency] ?? 1) - (rank[b.urgency] ?? 1) || a.openedAt.getTime() - b.openedAt.getTime(),
      );
    const closedCol = columns.get('CLOSED');
    if (closedCol) closedCol.cards = closed.map(card);
    return { columns: order.map((c) => columns.get(c.key)!) };
  }

  // ------------------------------------------------------------------ drag & drop

  /**
   * Dropping a card on a column assigns / changes status through the normal ticket operations (so every move is a
   * TicketEvent and triggers cards, DMs and folder sync). "Kechikkan" is virtual and cannot be a target; closed tickets stay closed.
   */
  async move(ticketId: string, to: string, actorId: string, opts: { solutionNote?: string } = {}) {
    const tk = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!tk) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', t('ticket.notFound'));
    if (tk.status === 'CLOSED') throw new AppError(HttpStatus.CONFLICT, 'CLOSED', t('ticket.closed'));

    if (to === 'OVERDUE')
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'VIRTUAL_STAGE',
        "«Kechikkan» avtomatik hisoblanadi, uni qo'lda tanlab bo'lmaydi",
      );
    if (to === 'NEW') {
      await this.tickets.unassign(ticketId, actorId);
    } else if (to === 'WAITING') {
      await this.tickets.setStatus(ticketId, 'WAITING_CLIENT', actorId);
    } else if (to === 'CLOSED') {
      await this.tickets.close(ticketId, actorId, opts.solutionNote);
    } else if (to.startsWith('USER:')) {
      const userId = to.slice(5);
      if (tk.assigneeId === userId) {
        if (tk.status === 'WAITING_CLIENT') await this.tickets.setStatus(ticketId, 'IN_PROGRESS', actorId);
      } else {
        if (tk.assigneeId) await this.tickets.assign(ticketId, userId, actorId);
        else await this.tickets.claim(ticketId, userId, actorId);
        if (
          (await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status ===
          'WAITING_CLIENT'
        ) {
          await this.tickets.setStatus(ticketId, 'IN_PROGRESS', actorId);
        }
      }
    } else {
      throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_STAGE', "Noto'g'ri bosqich");
    }
    const after = await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    return {
      ticketId,
      stage: stageKeyFor(after, await this.enabled()),
      status: after.status,
      assigneeId: after.assigneeId,
    };
  }
}
