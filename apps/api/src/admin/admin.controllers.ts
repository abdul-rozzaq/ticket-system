import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { slaPolicySchema } from '@tp/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/guards';
import { AppError, ZodPipe } from '../common/http';
import { StatsService } from './stats.service';

// ------------------------------------------------------------------ audit log

const auditQuery = z.object({
  action: z.string().max(60).optional(),
  actorId: z.string().uuid().optional(),
  q: z.string().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

@ApiTags('audit')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>) {
    const where = {
      action: q.q ? { contains: q.q, mode: 'insensitive' as const } : q.action,
      actorId: q.actorId,
      createdAt: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined },
    };
    const [items, total, actions] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { actor: { select: { username: true, displayName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
      }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, actions: actions.map((a) => a.action) };
  }
}

// ------------------------------------------------------------------ SLA policies

@Injectable()
export class SlaPoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.slaPolicy.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { groups: true } } },
    });
  }

  /** Only one policy can be the default: setting one clears the others in the same transaction. */
  async save(data: z.infer<typeof slaPolicySchema>, id?: string) {
    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault)
        await tx.slaPolicy.updateMany({
          where: { isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      if (id) {
        if (!(await tx.slaPolicy.findUnique({ where: { id } })))
          throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'SLA siyosati topilmadi');
        return tx.slaPolicy.update({ where: { id }, data });
      }
      return tx.slaPolicy.create({ data });
    });
  }

  async remove(id: string) {
    const used = await this.prisma.clientGroup.count({ where: { slaPolicyId: id } });
    if (used)
      throw new AppError(HttpStatus.CONFLICT, 'IN_USE', `Bu siyosat ${used} ta guruhda ishlatilmoqda`);
    await this.prisma.slaPolicy.delete({ where: { id } });
  }
}

@ApiTags('sla')
@ApiBearerAuth()
@Controller('sla-policies')
export class SlaPoliciesController {
  constructor(
    private readonly svc: SlaPoliciesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Roles('ADMIN')
  @Post()
  async create(
    @Body(new ZodPipe(slaPolicySchema)) body: z.infer<typeof slaPolicySchema>,
    @CurrentUser() actor: User,
  ) {
    const p = await this.svc.save(body);
    await this.audit.log({ actorId: actor.id, action: 'sla.create', entity: 'SlaPolicy', entityId: p.id });
    return p;
  }

  @Roles('ADMIN')
  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(slaPolicySchema)) body: z.infer<typeof slaPolicySchema>,
    @CurrentUser() actor: User,
  ) {
    const p = await this.svc.save(body, id);
    await this.audit.log({ actorId: actor.id, action: 'sla.update', entity: 'SlaPolicy', entityId: id });
    return p;
  }

  @Roles('ADMIN')
  @HttpCode(204)
  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    await this.svc.remove(id);
    await this.audit.log({ actorId: actor.id, action: 'sla.delete', entity: 'SlaPolicy', entityId: id });
  }
}

// ------------------------------------------------------------------ statistics

const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

@ApiTags('stats')
@ApiBearerAuth()
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /** Today's numbers + the live funnel; everyone (STAFF also gets "mine"). */
  @Get('dashboard')
  dashboard(@CurrentUser() user: User) {
    return this.stats.dashboard(user.id);
  }

  @Roles('ADMIN')
  @Get('overview')
  overview(@Query(new ZodPipe(daysQuery)) q: z.infer<typeof daysQuery>) {
    return this.stats.overview(q.days);
  }

  @Roles('ADMIN')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="tickets.csv"')
  @Get('export.csv')
  csv(@Query(new ZodPipe(daysQuery)) q: z.infer<typeof daysQuery>) {
    return this.stats.csv(q.days);
  }
}
