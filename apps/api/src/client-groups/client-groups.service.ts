import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { clientGroupSchema, normalizePeerId, parseStoredPeer, type PeerRef } from '@tp/shared';
import type { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/http';

type GroupInput = z.infer<typeof clientGroupSchema>;

/** Keys under which the same Telegram chat may be stored (a WebK "ambiguous" id can be a chat or a channel). */
export function candidateKeys(ref: PeerRef): string[] {
  switch (ref.kind) {
    case 'channel':
      return [`c:${ref.id}`, `x:${ref.id}`];
    case 'chat':
      return [`g:${ref.id}`, `x:${ref.id}`];
    case 'ambiguous':
      return [`x:${ref.id}`, `c:${ref.id}`, `g:${ref.id}`];
    default:
      return [ref.key];
  }
}

@Injectable()
export class ClientGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(filter: { confirmed?: boolean; active?: boolean } = {}) {
    return this.prisma.clientGroup.findMany({
      where: { isConfirmed: filter.confirmed, isActive: filter.active },
      orderBy: { companyName: 'asc' },
    });
  }

  /** Resolve a chat id as seen in Telegram Web (any format) or MTProto to a known group. */
  async findByChatId(raw: string) {
    const ref = normalizePeerId(raw) ?? null;
    if (!ref) return null;
    return this.prisma.clientGroup.findFirst({ where: { telegramChatId: { in: candidateKeys(ref) } } });
  }

  /** Resolve either a canonical stored key ("c:123", sent by the userbot) or a Web-style id. */
  async findByAnyId(raw: string) {
    const ref = parseStoredPeer(raw) ?? normalizePeerId(raw);
    if (!ref) return null;
    return this.prisma.clientGroup.findFirst({ where: { telegramChatId: { in: candidateKeys(ref) } } });
  }

  async create(input: GroupInput, actorId: string | null) {
    const ref = normalizePeerId(input.telegramChatId);
    if (!ref) throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_CHAT_ID', "Telegram chat ID noto'g'ri");
    try {
      const g = await this.prisma.clientGroup.create({
        data: { ...input, telegramChatId: ref.key, defaultOwnerId: input.defaultOwnerId ?? undefined, isConfirmed: true },
      });
      await this.audit.log({ actorId, action: 'client_group.create', entity: 'ClientGroup', entityId: g.id });
      return g;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError(HttpStatus.CONFLICT, 'GROUP_EXISTS', 'Bu guruh allaqachon qo\'shilgan');
      }
      throw e;
    }
  }

  async update(id: string, input: Partial<GroupInput>, actorId: string) {
    const data: Prisma.ClientGroupUncheckedUpdateInput = { ...input };
    if (input.telegramChatId) {
      const ref = normalizePeerId(input.telegramChatId);
      if (!ref) throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_CHAT_ID', "Telegram chat ID noto'g'ri");
      data.telegramChatId = ref.key;
    }
    try {
      const g = await this.prisma.clientGroup.update({ where: { id }, data });
      await this.audit.log({ actorId, action: 'client_group.update', entity: 'ClientGroup', entityId: id, meta: { fields: Object.keys(input) } });
      return g;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Guruh topilmadi');
      }
      throw e;
    }
  }

  /** Called by the userbot's discovery: upserts unconfirmed groups; an admin later confirms them. */
  async importDiscovered(items: Array<{ telegramChatId: string; title: string }>) {
    let created = 0;
    for (const it of items) {
      const ref = parseStoredPeer(it.telegramChatId) ?? normalizePeerId(it.telegramChatId);
      if (!ref) continue;
      const exists = await this.prisma.clientGroup.findFirst({ where: { telegramChatId: { in: candidateKeys(ref) } } });
      if (exists) continue;
      await this.prisma.clientGroup.create({
        data: { telegramChatId: ref.key, title: it.title, companyName: it.title, isActive: false, isConfirmed: false },
      });
      created++;
    }
    return { created };
  }
}
