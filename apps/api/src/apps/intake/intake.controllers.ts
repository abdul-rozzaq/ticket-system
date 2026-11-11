import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '../../common/prisma-client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { CurrentUser, Public, Roles } from '../auth/guards';
import { ZodPipe } from '../../common/http';
import { ClientGroupsService } from '../tickets/client-groups.service';
import { SettingsService } from '../../common/settings.service';
import { AuditService } from '../../common/audit.service';
import { AttributionService } from './attribution.service';
import { IntakeService } from './intake.service';
import { OutboxService } from './outbox.service';
import { ServiceTokenGuard } from './service-token.guard';

// ------------------------------------------------------------------ schemas (the wire contract with apps/userbot)

export const messageEventSchema = z.object({
  chatId: z.string().min(1).max(64),
  messageId: z.string().regex(/^\d+$/),
  senderId: z.string().regex(/^\d+$/).nullable().default(null),
  senderName: z.string().max(200).nullable().default(null),
  text: z.string().max(16000).default(''),
  outgoing: z.boolean(),
  replyToMessageId: z.string().regex(/^\d+$/).nullable().default(null),
  date: z.string().datetime(),
  hasMedia: z.boolean().default(false),
});
const reactionEventSchema = z.object({
  chatId: z.string().min(1),
  messageId: z.string().regex(/^\d+$/),
  emoji: z.string().min(1).max(16),
  byMe: z.boolean(),
});
const dialogsSchema = z.object({
  items: z.array(z.object({ chatId: z.string().min(1), title: z.string().max(300) })).max(5000),
});
const statusSchema = z.object({
  state: z.enum(['CONNECTED', 'DISCONNECTED', 'LOGGED_OUT', 'ERROR']),
  detail: z.string().max(300).optional(),
  me: z
    .object({
      phone: z.string().optional(),
      username: z.string().optional(),
      premium: z.boolean().optional(),
    })
    .optional(),
});
const commandResultSchema = z.object({
  ok: z.boolean(),
  result: z.record(z.string(), z.unknown()).default({}),
  error: z.string().max(500).optional(),
});

// ------------------------------------------------------------------ userbot -> API (service token)

@ApiTags('internal')
@Public()
@UseGuards(ServiceTokenGuard)
@Controller('internal/userbot')
export class InternalUserbotController {
  constructor(
    private readonly intake: IntakeService,
    private readonly outbox: OutboxService,
    private readonly groups: ClientGroupsService,
  ) {}

  @HttpCode(200)
  @Post('messages')
  message(@Body(new ZodPipe(messageEventSchema)) body: z.infer<typeof messageEventSchema>) {
    return this.intake.handleMessage(body);
  }

  @HttpCode(200)
  @Post('reactions')
  reaction(@Body(new ZodPipe(reactionEventSchema)) body: z.infer<typeof reactionEventSchema>) {
    return this.intake.handleReaction(body);
  }

  @HttpCode(200)
  @Post('dialogs')
  dialogs(@Body(new ZodPipe(dialogsSchema)) body: z.infer<typeof dialogsSchema>) {
    return this.groups.importDiscovered(
      body.items.map((i) => ({ telegramChatId: i.chatId, title: i.title })),
    );
  }

  @HttpCode(204)
  @Post('status')
  async status(@Body(new ZodPipe(statusSchema)) body: z.infer<typeof statusSchema>) {
    await this.outbox.heartbeat(body.state, {
      detail: body.detail ?? null,
      ...(body.me ? { me: body.me } : {}),
    });
  }

  /** CLI login fallback: stores a session string (encrypted by OutboxService). */
  @HttpCode(204)
  @Put('session')
  async putSession(
    @Body(new ZodPipe(z.object({ session: z.string().min(20).max(4000), phone: z.string().optional() })))
    body: {
      session: string;
      phone?: string;
    },
  ) {
    await this.outbox.storeSession(body.session, body.phone);
  }

  @Get('session')
  async session() {
    return { session: await this.outbox.getSessionString() };
  }

  /** Long-poll: waits up to `wait` seconds (max 25) for pending commands. */
  @Get('commands')
  async commands(@Query('wait') wait = '0') {
    const rows = await this.outbox.claim(Number(wait) || 0);
    return rows.map((r) => ({ id: r.id, type: r.type, payload: r.payload }));
  }

  @HttpCode(204)
  @Post('commands/:id/result')
  async result(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(commandResultSchema)) body: z.infer<typeof commandResultSchema>,
  ) {
    await this.outbox.complete(id, body.ok, body.result, body.error);
  }
}

// ------------------------------------------------------------------ admin: userbot login/status, filtered messages

const phoneSchema = z.object({ phone: z.string().regex(/^\+?\d{7,15}$/) });
const codeSchema = z.object({ code: z.string().min(3).max(10) });
const passwordSchema = z.object({ password: z.string().min(1).max(256) });

@ApiTags('telegram')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('telegram/userbot')
export class UserbotAdminController {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  async status() {
    const row = await this.outbox.sessionRow();
    const pending = await this.prisma.userbotCommand.count({
      where: { status: { in: ['PENDING', 'CLAIMED'] } },
    });
    return {
      status: row.status,
      phone: (row.info as { phone?: string } | null)?.phone ?? null,
      info: row.info,
      hasSession: !!row.sessionEnc, // the session itself is never returned
      lastActivityAt: row.lastActivityAt,
      /** The userbot is considered alive when it reported within the last 2 minutes. */
      alive: !!row.lastActivityAt && Date.now() - row.lastActivityAt.getTime() < 120_000,
      pendingCommands: pending,
    };
  }

  @HttpCode(200)
  @Post('login/phone')
  async phone(@Body(new ZodPipe(phoneSchema)) body: z.infer<typeof phoneSchema>, @CurrentUser() actor: User) {
    const row = await this.outbox.sessionRow();
    await this.prisma.userbotSession.update({
      where: { id: row.id },
      data: { phone: body.phone, status: 'CODE_REQUESTED' },
    });
    await this.audit.log({ actorId: actor.id, action: 'userbot.login_start' });
    return { id: (await this.outbox.enqueue('LOGIN_SEND_CODE', { phone: body.phone })).id };
  }

  @HttpCode(200)
  @Post('login/code')
  async code(@Body(new ZodPipe(codeSchema)) body: z.infer<typeof codeSchema>) {
    return { id: (await this.outbox.enqueue('LOGIN_SUBMIT_CODE', { code: body.code })).id };
  }

  @HttpCode(200)
  @Post('login/password')
  async password(@Body(new ZodPipe(passwordSchema)) body: z.infer<typeof passwordSchema>) {
    return { id: (await this.outbox.enqueue('LOGIN_SUBMIT_PASSWORD', { password: body.password })).id };
  }

  @HttpCode(200)
  @Post('logout')
  async logout(@CurrentUser() actor: User) {
    await this.audit.log({ actorId: actor.id, action: 'userbot.logout' });
    return { id: (await this.outbox.enqueue('LOGOUT')).id };
  }

  @HttpCode(200)
  @Post('discover')
  async discover() {
    return { id: (await this.outbox.enqueue('DISCOVER_DIALOGS')).id };
  }
}

@ApiTags('intake')
@ApiBearerAuth()
@Controller()
export class IntakeStaffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intake: IntakeService,
    private readonly groups: ClientGroupsService,
    private readonly attribution: AttributionService,
    private readonly settings: SettingsService,
  ) {}

  @Get('filtered-messages')
  async filtered(
    @Query('groupId') groupId?: string,
    @Query('reason') reason?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
  ) {
    const take = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
    const where = { clientGroupId: groupId, reason, createdTicketId: null };
    const [items, total] = await Promise.all([
      this.prisma.filteredMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(Number(page) || 1, 1) - 1) * take,
        take,
        include: { clientGroup: { select: { companyName: true } } },
      }),
      this.prisma.filteredMessage.count({ where }),
    ]);
    return {
      items: items.map((i) => ({ ...i, telegramMessageId: i.telegramMessageId?.toString() ?? null })),
      total,
    };
  }

  @HttpCode(200)
  @Post('filtered-messages/:id/create-ticket')
  async createFromFiltered(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    const r = await this.intake.createTicketFromFiltered(id, actor.id);
    return { ticketId: r.ticket.id, created: r.created };
  }

  /**
   * The extension reports "I am pressing Send in chat X" so the server can attribute the outgoing message to this
   * staff member (all staff share one Telegram account). Documented behaviour with an admin toggle.
   */
  @HttpCode(204)
  @Post('activity')
  async activity(
    @Body(new ZodPipe(z.object({ chatId: z.string().min(1), ts: z.string().datetime().optional() })))
    body: { chatId: string; ts?: string },
    @CurrentUser() user: User,
    @Req() _req: Request,
  ) {
    if (!(await this.settings.get('activity.pingEnabled'))) return;
    const group = await this.groups.findByChatId(body.chatId);
    if (!group) return;
    await this.attribution.record(user.id, group.telegramChatId, body.ts ? new Date(body.ts) : new Date());
  }
}
