import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, type KbArticle, type KbStatus } from '@prisma/client';
import { SYSTEM_TYPES, chunkText, patchOf } from '@tp/shared';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { AiService } from '../ai/ai.service';
import { AppError } from '../../common/http';

export const articleSchema = z.object({
  lang: z.enum(['uz', 'ru']).default('uz'),
  systemType: z.enum(SYSTEM_TYPES).default('OTHER'),
  category: z.string().min(1).max(60).default('other'),
  problem: z.string().min(5).max(500),
  solution: z.string().min(5).max(4000),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  /** Articles written by an admin are APPROVED by default; set DRAFT to review later. */
  status: z.enum(['DRAFT', 'APPROVED']).default('APPROVED'),
});
export const articlePatchSchema = patchOf(articleSchema.omit({ status: true }));
export type ArticleInput = z.infer<typeof articleSchema>;

export interface KbListFilter {
  status?: KbStatus;
  q?: string;
  lang?: string;
  systemType?: string;
  tag?: string;
  page: number;
  pageSize: number;
}

/** The text that is chunked, embedded and searched for an article. */
export const articleText = (a: Pick<KbArticle, 'problem' | 'solution'>) => `${a.problem}\n${a.solution}`;

const vectorLiteral = (v: number[]) => `[${v.join(',')}]`;

@Injectable()
export class KbService {
  private readonly logger = new Logger('KB');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  // ------------------------------------------------------------------ CRUD

  async list(f: KbListFilter) {
    const where: Prisma.KbArticleWhereInput = {
      status: f.status,
      lang: f.lang,
      systemType: f.systemType as never,
      tags: f.tag ? { has: f.tag } : undefined,
      ...(f.q
        ? {
            OR: [
              { problem: { contains: f.q, mode: 'insensitive' } },
              { solution: { contains: f.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.kbArticle.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.kbArticle.count({ where }),
    ]);
    return { items, total, page: f.page, pageSize: f.pageSize };
  }

  async get(id: string): Promise<KbArticle> {
    const a = await this.prisma.kbArticle.findUnique({ where: { id } });
    if (!a) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Maqola topilmadi');
    return a;
  }

  async create(
    input: ArticleInput,
    actorId: string | null,
    extra: { sourceTicketId?: string } = {},
  ): Promise<KbArticle> {
    const a = await this.prisma.kbArticle.create({
      data: {
        lang: input.lang,
        systemType: input.systemType,
        category: input.category,
        problem: input.problem,
        solution: input.solution,
        tags: input.tags,
        status: input.status,
        createdById: actorId,
        approvedById: input.status === 'APPROVED' ? actorId : null,
        sourceTicketId: extra.sourceTicketId,
      },
    });
    if (a.status === 'APPROVED') await this.reindexArticle(a);
    return a;
  }

  async update(id: string, patch: Partial<z.infer<typeof articlePatchSchema>>): Promise<KbArticle> {
    const before = await this.get(id);
    const a = await this.prisma.kbArticle.update({ where: { id }, data: patch });
    const contentChanged = before.problem !== a.problem || before.solution !== a.solution;
    if (a.status === 'APPROVED' && contentChanged) await this.reindexArticle(a); // edited answers must be searchable immediately
    return a;
  }

  async approve(id: string, actorId: string): Promise<KbArticle> {
    await this.get(id);
    const a = await this.prisma.kbArticle.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: actorId },
    });
    await this.reindexArticle(a);
    return a;
  }

  async reject(id: string): Promise<KbArticle> {
    await this.get(id);
    await this.prisma.kbChunk.deleteMany({ where: { articleId: id } }); // rejected content must never be retrievable
    return this.prisma.kbArticle.update({ where: { id }, data: { status: 'REJECTED' } });
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.prisma.kbArticle.delete({ where: { id } });
  }

  // ------------------------------------------------------------------ chunks + embeddings

  /**
   * Replaces the article's chunks. Embeddings are best effort: with no embedding model (or an unsupported provider, or a
   * provider failure) chunks are stored without a vector and retrieval uses Postgres full-text search instead.
   */
  async reindexArticle(a: KbArticle): Promise<{ chunks: number; embedded: boolean }> {
    const chunks = chunkText(articleText(a));
    let vectors: number[][] | null = null;
    try {
      vectors = await this.ai.embed(chunks);
    } catch (e) {
      this.logger.warn(
        `embedding failed for article ${a.id}, stored without vectors (full-text search will be used): ${String(e).slice(0, 200)}`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.kbChunk.deleteMany({ where: { articleId: a.id } });
      for (let i = 0; i < chunks.length; i++) {
        if (vectors) {
          await tx.$executeRaw`INSERT INTO "KbChunk" ("id", "articleId", "content", "embedding") VALUES (gen_random_uuid(), ${a.id}::uuid, ${chunks[i]}, ${vectorLiteral(vectors[i])}::vector)`;
        } else {
          await tx.kbChunk.create({ data: { articleId: a.id, content: chunks[i] } });
        }
      }
    });
    return { chunks: chunks.length, embedded: !!vectors };
  }

  /** Re-embeds every approved article (e.g. after an embedding model was configured). Skips articles that are already fully embedded. */
  async reindexAll(): Promise<{ articles: number; embedded: number; withoutVectors: number }> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; missing: number }>>`
      SELECT a."id", COUNT(*) FILTER (WHERE c."embedding" IS NULL)::int AS missing
      FROM "KbArticle" a LEFT JOIN "KbChunk" c ON c."articleId" = a."id"
      WHERE a."status" = 'APPROVED' GROUP BY a."id"`;
    const canEmbed = await this.ai.isConfigured('embedding');
    let embedded = 0;
    let withoutVectors = 0;
    let articles = 0;
    for (const r of rows) {
      if (
        canEmbed &&
        r.missing === 0 &&
        (await this.prisma.kbChunk.count({ where: { articleId: r.id } })) > 0
      )
        continue; // already embedded
      const a = await this.prisma.kbArticle.findUniqueOrThrow({ where: { id: r.id } });
      const res = await this.reindexArticle(a);
      articles++;
      if (res.embedded) embedded++;
      else withoutVectors++;
    }
    return { articles, embedded, withoutVectors };
  }

  // ------------------------------------------------------------------ quality metrics

  async stats() {
    const [byStatus, drafts, byOutcome, top] = await Promise.all([
      this.prisma.kbArticle.groupBy({ by: ['status'], _count: true }),
      this.prisma.aiDraft.findMany({ select: { notFound: true, sources: true, mode: true } }),
      this.prisma.aiDraft.groupBy({ by: ['outcome'], _count: true }),
      this.prisma.kbArticle.findMany({
        where: { status: 'APPROVED' },
        orderBy: { useCount: 'desc' },
        take: 5,
        select: { id: true, problem: true, useCount: true, sentUnchanged: true, sentEdited: true },
      }),
    ]);
    const total = drafts.length;
    const found = drafts.filter((d) => !d.notFound).length;
    const outcome = Object.fromEntries(byOutcome.map((o) => [o.outcome ?? 'PENDING', o._count]));
    const unchanged = outcome.UNCHANGED ?? 0;
    const edited = outcome.EDITED ?? 0;
    return {
      articles: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      drafts: {
        total,
        /** share of draft requests for which the knowledge base had something relevant */
        hitRate: total ? found / total : null,
        notFound: total - found,
        extractive: drafts.filter((d) => d.mode === 'extractive' && !d.notFound).length,
        llm: drafts.filter((d) => d.mode === 'llm' && !d.notFound).length,
        sentUnchanged: unchanged,
        sentEdited: edited,
        discarded: outcome.DISCARDED ?? 0,
        /** share of drafts that were sent without changes, among those we could classify */
        unchangedRate: unchanged + edited ? unchanged / (unchanged + edited) : null,
      },
      topArticles: top,
    };
  }
}
