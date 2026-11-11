import { Injectable, Logger } from '@nestjs/common';
import type { KbArticle, Template } from '../../common/prisma-client';
import { detectLang, isRelevant, matchStats, queryStems } from '@tp/shared';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { AiService } from '../ai/ai.service';
import { articleText } from './kb.service';

export interface KbHit {
  article: KbArticle;
  score: number;
  via: 'vector' | 'fts' | 'both';
  /** share of the question's terms found in the article */
  ratio: number;
}
export interface TemplateHit {
  template: Template;
  score: number;
}
export interface SearchResult {
  hits: KbHit[];
  /** true when the vector index contributed; false = pure full-text search (no embedding model / provider failure) */
  vectorUsed: boolean;
  vectorError?: string;
}

const RRF_K = 60;

/**
 * Retrieval over APPROVED articles only (DRAFT/REJECTED are never searched).
 *  - vector: cosine search in pgvector, when an embedding model is configured and the query could be embedded
 *  - full text: Postgres FTS with 5-character prefix terms OR-ed together (works without any AI)
 * Hits must pass a relevance guard so a single common word cannot pull in unrelated articles; the two rankings
 * are fused (reciprocal rank fusion), same-language and same-system articles get a small boost.
 */
@Injectable()
export class KbSearchService {
  private readonly logger = new Logger('KbSearch');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ai: AiService,
  ) {}

  async search(
    query: string,
    opts: { lang?: 'uz' | 'ru'; systemType?: string; topK?: number } = {},
  ): Promise<SearchResult> {
    const stems = queryStems(query);
    const [topK, minRatio, maxDist] = await Promise.all([
      opts.topK ?? this.settings.get('kb.topK'),
      this.settings.get('kb.minRelevance'),
      this.settings.get('kb.maxVectorDistance'),
    ]);
    if (!stems.length && !query.trim()) return { hits: [], vectorUsed: false };

    const fts = stems.length ? await this.fullText(stems) : [];
    let vec: Array<{ id: string; dist: number }> = [];
    let vectorUsed = false;
    let vectorError: string | undefined;
    try {
      const v = await this.ai.embed([query.slice(0, 2000)]);
      if (v) {
        vec = await this.vector(v[0]);
        vectorUsed = true;
      }
    } catch (e) {
      vectorError = String(e).slice(0, 200); // fail soft: full-text search still answers
      this.logger.warn(`vector search failed, using full-text only: ${vectorError}`);
    }

    const ids = [...new Set([...fts.map((r) => r.id), ...vec.map((r) => r.id)])];
    if (!ids.length) return { hits: [], vectorUsed, vectorError };
    const articles = new Map(
      (await this.prisma.kbArticle.findMany({ where: { id: { in: ids }, status: 'APPROVED' } })).map((a) => [
        a.id,
        a,
      ]),
    );

    const lang = opts.lang ?? detectLang(query);
    const hits: KbHit[] = [];
    for (const id of ids) {
      const a = articles.get(id);
      if (!a) continue;
      const ftsRank = fts.findIndex((r) => r.id === id);
      const vecRank = vec.findIndex((r) => r.id === id);
      const stats = matchStats(stems, `${articleText(a)} ${a.tags.join(' ')}`);
      const ftsOk = ftsRank >= 0 && isRelevant(stats, stems.length, minRatio);
      const vecOk = vecRank >= 0 && vec[vecRank].dist <= maxDist;
      if (!ftsOk && !vecOk) continue;
      let score = (ftsOk ? 1 / (RRF_K + ftsRank) : 0) + (vecOk ? 1 / (RRF_K + vecRank) : 0);
      if (a.lang === lang) score *= 1.2;
      if (opts.systemType && (a.systemType === opts.systemType || a.systemType === 'OTHER')) score *= 1.1;
      hits.push({
        article: a,
        score,
        via: ftsOk && vecOk ? 'both' : vecOk ? 'vector' : 'fts',
        ratio: stats.ratio,
      });
    }
    hits.sort((x, y) => y.score - x.score);
    return { hits: hits.slice(0, topK), vectorUsed, vectorError };
  }

  private async fullText(stems: string[]): Promise<Array<{ id: string; rank: number }>> {
    // Terms are reduced to letters/digits (prefix terms), so user text can never inject tsquery syntax.
    const tsq = stems
      .map((s) => s.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter(Boolean)
      .map((s) => `${s}:*`)
      .join(' | ');
    if (!tsq) return [];
    return this.prisma.$queryRaw<Array<{ id: string; rank: number }>>`
      SELECT a."id", ts_rank_cd(to_tsvector('simple', coalesce(a."problem", '') || ' ' || coalesce(a."solution", '')), q) AS rank
      FROM "KbArticle" a, to_tsquery('simple', ${tsq}) q
      WHERE a."status" = 'APPROVED'
        AND to_tsvector('simple', coalesce(a."problem", '') || ' ' || coalesce(a."solution", '')) @@ q
      ORDER BY rank DESC LIMIT 15`;
  }

  private async vector(embedding: number[]): Promise<Array<{ id: string; dist: number }>> {
    const lit = `[${embedding.join(',')}]`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; dist: number }>>`
      SELECT c."articleId" AS id, MIN(c."embedding" <=> ${lit}::vector) AS dist
      FROM "KbChunk" c JOIN "KbArticle" a ON a."id" = c."articleId"
      WHERE a."status" = 'APPROVED' AND c."embedding" IS NOT NULL
      GROUP BY c."articleId" ORDER BY dist LIMIT 10`;
    return rows.map((r) => ({ id: r.id, dist: Number(r.dist) }));
  }

  /** Templates that fit the question (style/snippet material for drafts). */
  async templates(query: string, limit = 2): Promise<TemplateHit[]> {
    const stems = queryStems(query);
    if (!stems.length) return [];
    const all = await this.prisma.template.findMany({ where: { isActive: true } });
    const hits: TemplateHit[] = [];
    for (const t of all) {
      const kw = matchStats(stems, t.keywords.join(' '));
      const full = matchStats(stems, `${t.title} ${t.keywords.join(' ')} ${t.bodyUz} ${t.bodyRu ?? ''}`);
      // a template must match on its keywords/title, not only because its body happens to share a word
      if (kw.matched === 0 && !isRelevant(full, stems.length)) continue;
      hits.push({ template: t, score: kw.matched * 2 + full.ratio });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
