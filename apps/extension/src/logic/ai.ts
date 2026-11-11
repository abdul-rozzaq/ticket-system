// F9 pipeline pieces that are pure (unit-tested): KB retrieval, mock draft, LLM prompt.
import type { KbArticle } from '../shared/types';
import { Bm25Index, RELEVANCE_THRESHOLD, type Bm25Hit } from './bm25';

export interface KbMatch { article: KbArticle; score: number; matched: string[] }

export function kbDocText(a: KbArticle): string {
  // Problem and tags weigh more: repeat them.
  return `${a.problem} ${a.problem} ${a.tags.join(' ')} ${a.tags.join(' ')} ${a.system} ${a.solution}`;
}

export function searchKb(kb: KbArticle[], query: string, limit = 3): KbMatch[] {
  const idx = new Bm25Index(kb.map((a) => ({ id: a.id, text: kbDocText(a) })));
  const byId = new Map(kb.map((a) => [a.id, a]));
  // Mask placeholders ([PAROL], [TELEFON]…) must not act as search terms.
  return idx
    .search(query.replace(/\[[A-Z_]+\]/g, ' '), limit)
    .filter((h: Bm25Hit) => h.score >= RELEVANCE_THRESHOLD)
    .map((h) => ({ article: byId.get(h.id)!, score: Math.round(h.score * 100) / 100, matched: h.matched }));
}

export const isCyrillic = (s: string) => (s.match(/[Ѐ-ӿ]/g)?.length ?? 0) > s.length * 0.3;

export interface DraftResult {
  found: boolean;
  draft: string;
  sources: KbMatch[];
}

/** Mock mode: build a reply from the best KB article. Never invents an answer. */
export function mockDraft(query: string, kb: KbArticle[], vars: { mijoz_nomi?: string | null; xodim?: string | null }): DraftResult {
  const ru = isCyrillic(query);
  let sources = searchKb(kb, query);
  if (!sources.length) return { found: false, draft: '', sources: [] };
  // Prefer an article in the client's language if it is close in score.
  const best = sources.find((s) => (s.article.lang === 'ru') === ru && s.score >= sources[0].score * 0.7) ?? sources[0];
  sources = [best, ...sources.filter((s) => s !== best)];
  const name = vars.mijoz_nomi ? `${vars.mijoz_nomi}, ` : '';
  const sign = vars.xodim ? (ru ? `\nС уважением, ${vars.xodim}.` : `\nHurmat bilan, ${vars.xodim}.`) : '';
  const draft = ru
    ? `${name}по вашему вопросу: ${best.article.solution}${sign}`
    : `${name}murojaatingiz bo'yicha: ${best.article.solution}${sign}`;
  return { found: true, draft, sources };
}

export const NOT_FOUND_MARKER = 'NOT_FOUND';

export const LLM_SYSTEM_PROMPT = `You draft replies for a tech-support team (AmoCRM, Bitrix24, Online PBX) that a human operator will review before sending.
Rules:
- Answer ONLY using the knowledge-base articles provided in the user message. Do not use outside knowledge, do not guess settings or menu paths that are not in the articles.
- If the articles do not answer the client's question, reply with exactly ${NOT_FOUND_MARKER} and nothing else.
- Reply in the client's language (Uzbek Latin or Russian), 1-4 short sentences, polite, no greetings beyond the client's name, no markdown.
- Never ask for or repeat passwords, tokens or card numbers. Placeholders like [PAROL] or [TOKEN] are masked secrets; leave them masked.`;

export function buildLlmUserPrompt(clientMessages: string, articles: KbArticle[], clientName: string | null): string {
  const arts = articles.length
    ? articles.map((a, i) => `<article id="${a.id}" n="${i + 1}" system="${a.system}">\nProblem: ${a.problem}\nSolution: ${a.solution}\n</article>`).join('\n')
    : '(no articles found)';
  return `<articles>\n${arts}\n</articles>\n\nClient name: ${clientName ?? 'unknown'}\n\n<client_messages>\n${clientMessages}\n</client_messages>\n\nWrite the draft reply now, or ${NOT_FOUND_MARKER}.`;
}
