import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  constructor(private readonly prisma: PrismaService) {}

  /** Audit writes must never break the request they describe. */
  async log(e: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: e.actorId ?? null,
          action: e.action,
          entity: e.entity,
          entityId: e.entityId,
          meta: (e.meta ?? {}) as Prisma.InputJsonValue,
          ip: e.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`audit write failed for ${e.action}: ${String(err)}`);
    }
  }
}
