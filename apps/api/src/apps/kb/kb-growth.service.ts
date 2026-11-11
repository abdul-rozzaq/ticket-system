import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { KbArticle } from '@prisma/client';
import { SYSTEM_TYPES, maskSensitive } from '@tp/shared';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { DomainEvents } from '../../common/domain-events';
import { AiService } from '../ai/ai.service';
import { KbService } from './kb.service';

const aiArticleSchema = z.union([
  z.object({ skip: z.literal(true) }),
  z.object({
    problem: z.string().min(5).max(500),
    solution: z.string().min(5).max(4000),
    tags: z.array(z.string().max(40)).max(10).default([]),
    systemType: z.enum(SYSTEM_TYPES).default('OTHER'),
    category: z.string().max(60).default('other'),
  }),
]);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Knowledge-base growth: when a ticket is closed with a solution note, turn "problem -> solution" into a DRAFT article
 * for an admin to review. With an AI provider the model generalises it; without one (or if it fails) the draft is built
 * directly from the ticket summary and the note. Nothing becomes searchable until an admin APPROVES it.
 */
@Injectable()
export class KbGrowthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('KbGrowth');
  private off?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ai: AiService,
    private readonly kb: KbService,
    private readonly events: DomainEvents,
  ) {}

  onModuleInit() {
    this.off = this.events.on('ticket.closed', async (p) => {
      if (!p.solutionNote) return;
      try {
        await this.fromTicket(p.ticketId);
      } catch (e) {
        this.logger.warn(`KB draft from ticket ${p.number} failed: ${String(e).slice(0, 200)}`);
      }
    });
  }
  onModuleDestroy() {
    this.off?.();
  }

  /** Returns the new DRAFT article, or null when the ticket is not worth an article (no/short note, merged, already done, AI says skip). */
  async fromTicket(ticketId: string, opts: { force?: boolean } = {}): Promise<KbArticle | null> {
    const t = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        clientGroup: true,
        messages: { where: { direction: 'IN', isInternalNote: false }, orderBy: { sentAt: 'asc' }, take: 3 },
      },
    });
    if (!t || t.status !== 'CLOSED' || !t.solutionNote) return null;
    const note = t.solutionNote.trim();
    const minChars = await this.settings.get('kb.growthMinNoteChars');
    if (!opts.force && (note.length < minChars || note.startsWith('Birlashtirildi') || t.mergedIntoId))
      return null;
    if (await this.prisma.kbArticle.findFirst({ where: { sourceTicketId: t.id } })) return null; // one article per ticket

    const question = clip(maskSensitive(t.messages.map((m) => m.text).join('\n') || t.summary).text, 1200);
    const solution = clip(maskSensitive(note).text, 1500);
    const lang = t.clientGroup.language === 'ru' ? 'ru' : 'uz';

    let article: {
      problem: string;
      solution: string;
      tags: string[];
      systemType: string;
      category: string;
    } | null = null;
    let mode: 'llm' | 'extractive' = 'extractive';
    if (await this.ai.isConfigured('summary')) {
      try {
        const text = await this.ai.complete({
          task: 'kb_article',
          user: `<ticket system="${t.systemType}" category="${t.category}">\n<problem_messages>\n${question}\n</problem_messages>\n<solution_note>\n${solution}\n</solution_note>\n</ticket>`,
          ticketId: t.id,
        });
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        const parsed = aiArticleSchema.safeParse(
          start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null,
        );
        if (parsed.success) {
          if ('skip' in parsed.data) return null; // the model judged the note too vague to help anyone
          article = parsed.data;
          mode = 'llm';
        }
      } catch (e) {
        this.logger.warn(
          `AI KB draft failed for ticket ${t.number}, using the extractive draft: ${String(e).slice(0, 150)}`,
        );
      }
    }
    article ??= {
      problem: clip(maskSensitive(t.summary).text || question, 500),
      solution,
      tags: [],
      systemType: t.systemType,
      category: t.category,
    };

    return this.kb.create(
      {
        lang,
        systemType: article.systemType as (typeof SYSTEM_TYPES)[number],
        category: article.category || 'other',
        problem: article.problem,
        solution: article.solution,
        tags: ['auto', mode === 'llm' ? 'ai' : 'extractive', ...article.tags].slice(0, 12),
        status: 'DRAFT',
      },
      null,
      { sourceTicketId: t.id },
    );
  }
}
