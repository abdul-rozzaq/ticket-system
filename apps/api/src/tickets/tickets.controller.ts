import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { assignSchema, closeTicketSchema, noteSchema, setStatusSchema, ticketFilterSchema } from '@tp/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/guards';
import { AppError, ZodPipe } from '../common/http';
import { AuditService } from '../audit/audit.service';
import { ClientGroupsService } from '../client-groups/client-groups.service';
import { TicketsService } from './tickets.service';

const createSchema = z.object({ clientGroupId: z.string().uuid(), text: z.string().min(1).max(4000) });
const mergeSchema = z.object({ targetId: z.string().uuid() });

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly groups: ClientGroupsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query(new ZodPipe(ticketFilterSchema)) q: z.infer<typeof ticketFilterSchema>) {
    return this.tickets.list(q);
  }

  /** What the extension shows for the chat that is open in Telegram Web (chat id in any Web format). */
  @Get('by-chat/:chatId')
  async byChat(@Param('chatId') chatId: string) {
    const group = await this.groups.findByChatId(decodeURIComponent(chatId));
    if (!group)
      throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Bu chat mijoz guruhi sifatida topilmadi');
    return { group, ...(await this.tickets.forGroup(group.id)) };
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.detail(id);
  }

  /** Manual creation (e.g. from a filtered message or when intake missed something). */
  @Post()
  async create(
    @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentUser() actor: User,
  ) {
    const r = await this.tickets.createTicket({
      clientGroupId: body.clientGroupId,
      text: body.text,
      actorId: actor.id,
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'ticket.create',
      entity: 'Ticket',
      entityId: r.ticket.id,
    });
    return r;
  }

  @HttpCode(200)
  @Post(':id/take')
  async take(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    const r = await this.tickets.take(id, actor.id);
    return r.ticket;
  }

  @HttpCode(200)
  @Post(':id/assign')
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(assignSchema)) body: z.infer<typeof assignSchema>,
    @CurrentUser() actor: User,
  ) {
    const tk = await this.tickets.assign(id, body.assigneeId, actor.id, body.handoverNote);
    await this.audit.log({
      actorId: actor.id,
      action: 'ticket.assign',
      entity: 'Ticket',
      entityId: id,
      meta: { to: body.assigneeId },
    });
    return tk;
  }

  @HttpCode(200)
  @Post(':id/status')
  status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(setStatusSchema)) body: z.infer<typeof setStatusSchema>,
    @CurrentUser() actor: User,
  ) {
    return this.tickets.setStatus(id, body.status, actor.id);
  }

  @HttpCode(200)
  @Post(':id/close')
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(closeTicketSchema)) body: z.infer<typeof closeTicketSchema>,
    @CurrentUser() actor: User,
  ) {
    const tk = await this.tickets.close(id, actor.id, body.solutionNote);
    await this.audit.log({ actorId: actor.id, action: 'ticket.close', entity: 'Ticket', entityId: id });
    return tk;
  }

  @HttpCode(204)
  @Post(':id/note')
  async note(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(noteSchema)) body: z.infer<typeof noteSchema>,
    @CurrentUser() actor: User,
  ) {
    await this.tickets.addNote(id, body.text, actor.id);
  }

  @HttpCode(200)
  @Post(':id/merge')
  async merge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(mergeSchema)) body: z.infer<typeof mergeSchema>,
    @CurrentUser() actor: User,
  ) {
    const tk = await this.tickets.merge(id, body.targetId, actor.id);
    await this.audit.log({
      actorId: actor.id,
      action: 'ticket.merge',
      entity: 'Ticket',
      entityId: id,
      meta: { into: body.targetId },
    });
    return tk;
  }
}
