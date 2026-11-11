import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { User } from '@prisma/client';
import { aiDraftRequestSchema, SYSTEM_TYPES } from '@tp/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { CurrentUser, Roles } from '../auth/guards';
import { ZodPipe } from '../../common/http';
import { DraftService } from './draft.service';
import { KbGrowthService } from './kb-growth.service';
import { KbSearchService } from './kb-search.service';
import { articlePatchSchema, articleSchema, KbService } from './kb.service';

const listSchema = z.object({
  status: z.enum(['DRAFT', 'APPROVED', 'REJECTED']).optional(),
  q: z.string().max(200).optional(),
  lang: z.enum(['uz', 'ru']).optional(),
  systemType: z.enum(SYSTEM_TYPES).optional(),
  tag: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

@ApiTags('kb')
@ApiBearerAuth()
@Controller('kb')
export class KbController {
  constructor(
    private readonly kb: KbService,
    private readonly search: KbSearchService,
    private readonly growth: KbGrowthService,
    private readonly audit: AuditService,
  ) {}

  /** STAFF see APPROVED articles only (read-only); ADMIN sees every status, including the DRAFT approval queue. */
  @Get()
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>, @CurrentUser() user: User) {
    return this.kb.list(user.role === 'ADMIN' ? q : { ...q, status: 'APPROVED' });
  }

  @Roles('ADMIN')
  @Get('stats')
  stats() {
    return this.kb.stats();
  }

  /** Quick search for the palette / extension: approved articles only, with the same relevance rules as drafts. */
  @Get('search')
  async quickSearch(@Query('q') q = '', @Query('lang') lang?: string) {
    const r = await this.search.search(String(q).slice(0, 500), {
      lang: lang === 'ru' ? 'ru' : lang === 'uz' ? 'uz' : undefined,
    });
    return {
      vectorUsed: r.vectorUsed,
      vectorError: r.vectorError,
      hits: r.hits.map((h) => ({
        id: h.article.id,
        problem: h.article.problem,
        solution: h.article.solution,
        system: h.article.systemType,
        lang: h.article.lang,
        score: h.score,
        via: h.via,
      })),
    };
  }

  @Roles('ADMIN')
  @HttpCode(200)
  @Post('reindex')
  reindex() {
    return this.kb.reindexAll();
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    const a = await this.kb.get(id);
    if (user.role !== 'ADMIN' && a.status !== 'APPROVED')
      return this.kb.get('00000000-0000-0000-0000-000000000000'); // 404: drafts are not visible to staff
    return a;
  }

  @Roles('ADMIN')
  @Post()
  async create(
    @Body(new ZodPipe(articleSchema)) body: z.infer<typeof articleSchema>,
    @CurrentUser() actor: User,
  ) {
    const a = await this.kb.create(body, actor.id);
    await this.audit.log({ actorId: actor.id, action: 'kb.create', entity: 'KbArticle', entityId: a.id });
    return a;
  }

  @Roles('ADMIN')
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(articlePatchSchema)) body: z.infer<typeof articlePatchSchema>,
    @CurrentUser() actor: User,
  ) {
    const a = await this.kb.update(id, body);
    await this.audit.log({
      actorId: actor.id,
      action: 'kb.update',
      entity: 'KbArticle',
      entityId: id,
      meta: { fields: Object.keys(body) },
    });
    return a;
  }

  @Roles('ADMIN')
  @HttpCode(200)
  @Post(':id/approve')
  async approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    const a = await this.kb.approve(id, actor.id);
    await this.audit.log({ actorId: actor.id, action: 'kb.approve', entity: 'KbArticle', entityId: id });
    return a;
  }

  @Roles('ADMIN')
  @HttpCode(200)
  @Post(':id/reject')
  async reject(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    const a = await this.kb.reject(id);
    await this.audit.log({ actorId: actor.id, action: 'kb.reject', entity: 'KbArticle', entityId: id });
    return a;
  }

  @Roles('ADMIN')
  @HttpCode(204)
  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    await this.kb.remove(id);
    await this.audit.log({ actorId: actor.id, action: 'kb.delete', entity: 'KbArticle', entityId: id });
  }

  /** Manually turn a closed ticket's solution into a DRAFT article (even when the automatic rules skipped it). */
  @Roles('ADMIN')
  @HttpCode(200)
  @Post('from-ticket/:ticketId')
  async fromTicket(@Param('ticketId', ParseUUIDPipe) ticketId: string) {
    return { article: await this.growth.fromTicket(ticketId, { force: true }) };
  }
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class DraftController {
  constructor(private readonly drafts: DraftService) {}

  /** Reply draft for the chat that is open in Telegram Web. Context comes from the stored conversation, not from the page. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('draft')
  draft(
    @Body(new ZodPipe(aiDraftRequestSchema)) body: z.infer<typeof aiDraftRequestSchema>,
    @CurrentUser() user: User,
  ) {
    return this.drafts.generate({ chatId: body.chatId, messageId: body.messageId, userId: user.id });
  }

  @Get('drafts/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.drafts.get(id);
  }

  /** The human threw the draft away (sent drafts are detected automatically). */
  @HttpCode(204)
  @Post('drafts/:id/discard')
  async discard(@Param('id', ParseUUIDPipe) id: string) {
    await this.drafts.discard(id);
  }
}
