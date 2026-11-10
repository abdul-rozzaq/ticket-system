import { Body, Controller, Get, HttpCode, HttpStatus, Module, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DEFAULT_PROMPTS } from '@tp/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/guards';
import { AppError, ZodPipe } from '../common/http';
import type { User } from '@prisma/client';
import { AiService, IntakeClassifier } from './ai.service';

const providerSchema = z.object({
  type: z.enum(['ANTHROPIC', 'OPENAI_COMPATIBLE']),
  name: z.string().min(1).max(60).default('default'),
  baseUrl: z.string().url().nullable().optional(),
  /** Write-only. Omit on update to keep the stored key. */
  apiKey: z.string().min(8).max(500).optional(),
});

const settingsSchema = z.object({
  classifyModel: z.string().max(100).optional(),
  draftModel: z.string().max(100).optional(),
  embeddingModel: z.string().max(100).optional(),
  summaryModel: z.string().max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(64).max(8192).optional(),
  monthlyBudgetUsd: z.number().min(0).optional(),
  hardStop: z.boolean().optional(),
  maskPolicy: z.enum(['ALWAYS', 'ASK']).optional(),
  prompts: z.record(z.string(), z.string().max(8000)).optional(),
});

@ApiTags('ai')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('ai')
export class AiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly ai: AiService,
  ) {}

  /** Never returns the API key, only a hint of its last 4 characters. */
  @Get('settings')
  async get() {
    const s = await this.prisma.aiSettings.findUniqueOrThrow({ where: { id: 1 } });
    const p = s.providerId ? await this.prisma.aiProvider.findUnique({ where: { id: s.providerId } }) : null;
    let keyHint: string | null = null;
    if (p) {
      try {
        keyHint = `••••${this.crypto.decrypt(p.apiKeyEnc).slice(-4)}`;
      } catch {
        keyHint = '(decrypt failed)';
      }
    }
    return {
      provider: p && {
        id: p.id,
        type: p.type,
        name: p.name,
        baseUrl: p.baseUrl,
        isActive: p.isActive,
        hasKey: true,
        keyHint,
      },
      models: {
        classify: s.classifyModel,
        draft: s.draftModel,
        embedding: s.embeddingModel,
        summary: s.summaryModel,
      },
      temperature: s.temperature,
      maxTokens: s.maxTokens,
      monthlyBudgetUsd: s.monthlyBudgetUsd,
      hardStop: s.hardStop,
      maskPolicy: s.maskPolicy,
      prompts: { ...DEFAULT_PROMPTS, ...((s.prompts ?? {}) as Record<string, string>) },
      defaultPrompts: DEFAULT_PROMPTS,
      monthSpendUsd: await this.ai.monthSpendUsd(),
    };
  }

  @Put('provider')
  async setProvider(
    @Body(new ZodPipe(providerSchema)) body: z.infer<typeof providerSchema>,
    @CurrentUser() actor: User,
  ) {
    const s = await this.prisma.aiSettings.findUniqueOrThrow({ where: { id: 1 } });
    const existing = s.providerId
      ? await this.prisma.aiProvider.findUnique({ where: { id: s.providerId } })
      : null;
    if (!existing && !body.apiKey)
      throw new AppError(HttpStatus.BAD_REQUEST, 'KEY_REQUIRED', 'API kalit kiritilishi shart');
    const data = {
      type: body.type,
      name: body.name,
      baseUrl: body.baseUrl ?? null,
      ...(body.apiKey ? { apiKeyEnc: this.crypto.encrypt(body.apiKey) } : {}),
    };
    const provider = existing
      ? await this.prisma.aiProvider.update({ where: { id: existing.id }, data })
      : await this.prisma.aiProvider.create({
          data: { ...data, apiKeyEnc: this.crypto.encrypt(body.apiKey!) },
        });
    await this.prisma.aiSettings.update({ where: { id: 1 }, data: { providerId: provider.id } });
    await this.audit.log({
      actorId: actor.id,
      action: 'ai.provider_set',
      entity: 'AiProvider',
      entityId: provider.id,
      meta: { type: body.type, keyChanged: !!body.apiKey },
    });
    return this.get();
  }

  @Put('settings')
  async update(
    @Body(new ZodPipe(settingsSchema)) body: z.infer<typeof settingsSchema>,
    @CurrentUser() actor: User,
  ) {
    const { prompts, ...rest } = body;
    const cur = await this.prisma.aiSettings.findUniqueOrThrow({ where: { id: 1 } });
    await this.prisma.aiSettings.update({
      where: { id: 1 },
      data: { ...rest, ...(prompts ? { prompts: { ...((cur.prompts ?? {}) as object), ...prompts } } : {}) },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'ai.settings_update',
      meta: { fields: Object.keys(body) },
    });
    return this.get();
  }

  @HttpCode(200)
  @Post('settings/reset-prompt/:task')
  async resetPrompt(@Param('task') task: string) {
    const cur = await this.prisma.aiSettings.findUniqueOrThrow({ where: { id: 1 } });
    const prompts = { ...((cur.prompts ?? {}) as Record<string, string>) };
    delete prompts[task];
    await this.prisma.aiSettings.update({ where: { id: 1 }, data: { prompts } });
    return this.get();
  }

  @HttpCode(200)
  @Post('test')
  async test() {
    const t0 = Date.now();
    try {
      const text = await this.ai.complete({
        task: 'classify',
        system: 'Reply with the single word OK.',
        user: 'ping',
      });
      return { ok: true, ms: Date.now() - t0, reply: text.slice(0, 40) };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: String(e).slice(0, 300) };
    }
  }

  @Get('usage')
  async usage(@Query('days') days = '30') {
    const since = new Date(Date.now() - Math.min(Number(days) || 30, 365) * 86_400_000);
    const [items, byTask] = await Promise.all([
      this.prisma.aiUsageLog.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.aiUsageLog.groupBy({
        by: ['task'],
        where: { createdAt: { gte: since } },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
    ]);
    return { items, byTask, monthSpendUsd: await this.ai.monthSpendUsd() };
  }
}

@Module({
  controllers: [AiController],
  providers: [AiService, { provide: IntakeClassifier, useExisting: AiService }],
  exports: [AiService, IntakeClassifier],
})
export class AiModule {}
