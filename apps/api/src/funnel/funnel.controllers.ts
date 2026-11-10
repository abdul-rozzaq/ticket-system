import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { SYSTEM_TYPES } from '@tp/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/guards';
import { ZodPipe } from '../common/http';
import { FoldersService } from './folders.service';
import { FunnelService } from './funnel.service';

const boardFilterSchema = z.object({
  assigneeId: z.string().uuid().optional(),
  clientGroupId: z.string().uuid().optional(),
  systemType: z.enum(SYSTEM_TYPES).optional(),
});
const moveSchema = z.object({
  ticketId: z.string().uuid(),
  /** NEW | WAITING | CLOSED | USER:<uuid>. OVERDUE is virtual and rejected. */
  to: z.string().regex(/^(NEW|WAITING|OVERDUE|CLOSED|USER:[0-9a-f-]{36})$/),
  solutionNote: z.string().max(2000).optional(),
});
const stagePatchSchema = z.object({
  title: z.string().min(1).max(40).optional(),
  position: z.number().int().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

@ApiTags('funnel')
@ApiBearerAuth()
@Controller('funnel')
export class FunnelController {
  constructor(
    private readonly funnel: FunnelService,
    private readonly audit: AuditService,
  ) {}

  @Get('stages')
  stages() {
    return this.funnel.stages();
  }

  @Roles('ADMIN')
  @Put('stages/:id')
  async updateStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(stagePatchSchema)) body: z.infer<typeof stagePatchSchema>,
    @CurrentUser() actor: User,
  ) {
    const r = await this.funnel.updateStage(id, body);
    await this.audit.log({
      actorId: actor.id,
      action: 'funnel.stage_update',
      entity: 'FunnelStage',
      entityId: id,
      meta: { fields: Object.keys(body) },
    });
    return r;
  }

  @Get('board')
  board(@Query(new ZodPipe(boardFilterSchema)) filter: z.infer<typeof boardFilterSchema>) {
    return this.funnel.board(filter);
  }

  /** Drag & drop on the Kanban board. */
  @HttpCode(200)
  @Post('move')
  async move(@Body(new ZodPipe(moveSchema)) body: z.infer<typeof moveSchema>, @CurrentUser() actor: User) {
    const r = await this.funnel.move(body.ticketId, body.to, actor.id, { solutionNote: body.solutionNote });
    await this.audit.log({
      actorId: actor.id,
      action: 'funnel.move',
      entity: 'Ticket',
      entityId: body.ticketId,
      meta: { to: body.to },
    });
    return r;
  }
}

@ApiTags('telegram')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('telegram/folders')
export class FoldersController {
  constructor(
    private readonly folders: FoldersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  status() {
    return this.folders.status();
  }

  /** "Dry run / preview diff": what a sync would do. Nothing is changed. */
  @Get('preview')
  preview() {
    return this.folders.preview();
  }

  /** "Sync now". */
  @HttpCode(200)
  @Post('sync')
  async sync(@CurrentUser() actor: User) {
    await this.audit.log({ actorId: actor.id, action: 'folders.sync' });
    return this.folders.sync('manual');
  }

  @Get('log')
  log(@Query('limit') limit = '100', @Query('runId') runId?: string) {
    return this.folders.log(Number(limit) || 100, runId);
  }
}
