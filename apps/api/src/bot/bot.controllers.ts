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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Public, Roles } from '../auth/guards';
import { ZodPipe } from '../common/http';
import { ServiceTokenGuard } from '../intake/service-token.guard';
import { BotNotifier } from './bot-notifier.service';
import { BotConfigService, BotOutboxService } from './bot-core.service';
import { BotService } from './bot.service';

const callbackSchema = z.object({
  telegramUserId: z.string().regex(/^\d+$/),
  data: z.string().min(1).max(64),
});
const commandSchema = z.object({
  telegramUserId: z.string().regex(/^\d+$/),
  chatType: z.enum(['private', 'group', 'supergroup', 'channel']),
  text: z.string().min(1).max(4096),
});
const resultSchema = z.object({
  ok: z.boolean(),
  result: z.record(z.string(), z.unknown()).default({}),
  error: z.string().max(500).optional(),
});
const statusSchema = z.object({
  state: z.enum(['CONNECTED', 'DISCONNECTED', 'ERROR']),
  detail: z.string().max(300).optional(),
});

// ------------------------------------------------------------------ bot process -> API (service token)

@ApiTags('internal')
@Public()
@UseGuards(ServiceTokenGuard)
@Controller('internal/bot')
export class InternalBotController {
  constructor(
    private readonly cfg: BotConfigService,
    private readonly outbox: BotOutboxService,
    private readonly bot: BotService,
    private readonly notifier: BotNotifier,
    private readonly prisma: PrismaService,
  ) {}

  /** The token is returned decrypted to the bot process only (service-token protected). */
  @Get('config')
  async config() {
    const c = await this.cfg.get();
    return { token: await this.cfg.token(), internalChatId: c.internalChatId ?? null };
  }

  @Get('outbox')
  async claim(@Query('wait') wait = '0') {
    return this.outbox.claim(Number(wait) || 0);
  }

  @HttpCode(204)
  @Post('outbox/:id/result')
  async result(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(resultSchema)) body: z.infer<typeof resultSchema>,
  ) {
    const row = await this.outbox.complete(id, body.ok, body.result, body.error);
    // The card was posted: remember where it lives so later events can edit it.
    if (body.ok && row.kind === 'SEND_CARD') {
      const p = row.payload as { ticketId: string; chatId: string; text: string };
      const messageId = String(body.result.messageId ?? '');
      if (/^\d+$/.test(messageId)) {
        await this.prisma.ticket.update({
          where: { id: p.ticketId },
          data: { cardChatId: p.chatId, cardMessageId: BigInt(messageId) },
        });
        await this.notifier.afterCardSent(p.ticketId, p.text);
      }
    }
  }

  @HttpCode(200)
  @Post('callbacks')
  callback(@Body(new ZodPipe(callbackSchema)) body: z.infer<typeof callbackSchema>) {
    return this.bot.handleCallback(body);
  }

  /** Returns `replies: null` when the sender must be ignored. */
  @HttpCode(200)
  @Post('commands')
  async command(@Body(new ZodPipe(commandSchema)) body: z.infer<typeof commandSchema>) {
    return { replies: await this.bot.handleCommand(body) };
  }

  @HttpCode(204)
  @Post('status')
  async status(@Body(new ZodPipe(statusSchema)) body: z.infer<typeof statusSchema>) {
    await this.cfg.setStatus(body.state, body.detail);
  }
}

// ------------------------------------------------------------------ admin

const configSchema = z.object({
  /** Write-only. Omit to keep the stored token. */
  token: z
    .string()
    .regex(/^\d{6,12}:[\w-]{30,}$/, 'not a bot token')
    .optional(),
  internalChatId: z
    .string()
    .regex(/^-?\d{5,20}$/)
    .nullable()
    .optional(),
  escalationUserId: z.string().uuid().nullable().optional(),
});

@ApiTags('telegram')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('telegram/bot')
export class BotAdminController {
  constructor(
    private readonly cfg: BotConfigService,
    private readonly outbox: BotOutboxService,
    private readonly audit: AuditService,
  ) {}

  /** Never returns the token. */
  @Get()
  async get() {
    const c = await this.cfg.get();
    return {
      hasToken: !!c.tokenEnc,
      internalChatId: c.internalChatId ?? null,
      escalationUserId: c.escalationUserId ?? null,
      status: await this.cfg.status(),
    };
  }

  @Put()
  async put(@Body(new ZodPipe(configSchema)) body: z.infer<typeof configSchema>, @CurrentUser() actor: User) {
    await this.cfg.patch(body);
    await this.audit.log({
      actorId: actor.id,
      action: 'bot.config_update',
      meta: { fields: Object.keys(body), tokenChanged: !!body.token },
    });
    return this.get();
  }

  /** Posts a test message to the internal group. */
  @HttpCode(200)
  @Post('test')
  async test() {
    const chatId = (await this.cfg.get()).internalChatId;
    if (!chatId) return { ok: false, error: 'Ichki guruh sozlanmagan' };
    await this.outbox.enqueue('SEND_TEXT', { chatId, text: '✅ TP bot ulandi' });
    return { ok: true };
  }
}
