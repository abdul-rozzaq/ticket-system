// Text helpers shared by retrieval (KB search), draft quality tracking and the extension.
// Uzbek is agglutinative and Russian is inflected, so instead of a real stemmer terms are cut to a 5-character prefix:
// "webhookni"/"webhook", "записей"/"записи" and "ulanmadi"/"ulanmayapti" then meet in the middle. Crude but cheap and
// good enough for a small knowledge base; relevance is additionally guarded by `isRelevant`.

const STOP = new Set([
  // uz
  'va',
  'bu',
  'u',
  'bilan',
  'uchun',
  'ham',
  'yoq',
  'bor',
  'men',
  'biz',
  'siz',
  'nima',
  'qanday',
  'iltimos',
  'salom',
  'rahmat',
  'kerak',
  'edi',
  'lekin',
  'yoki',
  'ular',
  'shu',
  'endi',
  'hali',
  'bugun',
  'kecha',
  'assalomu',
  'alaykum',
  // ru
  'и',
  'в',
  'на',
  'не',
  'что',
  'с',
  'по',
  'у',
  'как',
  'а',
  'но',
  'это',
  'я',
  'мы',
  'вы',
  'нет',
  'да',
  'пожалуйста',
  'здравствуйте',
  'привет',
  'спасибо',
  'есть',
  'для',
  'или',
  'они',
  'уже',
  'еще',
  'ещё',
  // en
  'the',
  'a',
  'is',
  'to',
  'of',
  'and',
  'for',
  'with',
  'hello',
  'thanks',
]);

export const STEM_LEN = 5;

/** Lowercase, drop uzbek apostrophe variants ("qo'ng'iroq" -> "qongiroq"). */
export const normalizeText = (s: string): string => s.toLowerCase().replace(/[ʻʼ`’‘']/g, '');

const words = (s: string): string[] =>
  normalizeText(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Distinct, stop-word-free 5-char stems of a text (at most `max`). Masked placeholders like [PAROL] are ignored. */
export function queryStems(text: string, max = 20): string[] {
  const out: string[] = [];
  for (const w of words(text.replace(/\[[A-Z_]+\]/g, ' '))) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    const stem = w.length > STEM_LEN ? w.slice(0, STEM_LEN) : w;
    if (!out.includes(stem)) out.push(stem);
    if (out.length >= max) break;
  }
  return out;
}

/** 'ru' when a third or more of the letters are Cyrillic, otherwise 'uz'. */
export function detectLang(text: string): 'uz' | 'ru' {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (!letters) return 'uz';
  return (text.match(/[Ѐ-ӿ]/g)?.length ?? 0) / letters >= 0.3 ? 'ru' : 'uz';
}

export interface MatchStats {
  matched: number;
  ratio: number;
}

/** How many of the query stems occur in the article text (prefix match on its words). */
export function matchStats(stems: string[], articleText: string): MatchStats {
  if (!stems.length) return { matched: 0, ratio: 0 };
  const haystack = normalizeText(articleText);
  const matched = stems.filter((s) => haystack.includes(s)).length;
  return { matched, ratio: matched / stems.length };
}

/**
 * Relevance guard on top of the search engine's ranking, so one common word ("ishlamayapti") cannot pull in unrelated articles:
 *  - a single content word is never enough on its own (the vector index may still answer it);
 *  - two words must both match;
 *  - three or more need at least two matches and `minRatio` of all terms.
 */
export function isRelevant(stats: MatchStats, queryStemCount: number, minRatio = 0.3): boolean {
  if (queryStemCount < 2) return false;
  if (queryStemCount === 2) return stats.matched === 2;
  return stats.matched >= 2 && stats.ratio >= minRatio;
}

/**
 * Splits text into chunks of at most `max` characters, preferring paragraph and sentence boundaries, with a small
 * overlap so a sentence cut at a boundary is still found. Short texts yield one chunk.
 */
export function chunkText(text: string, max = 800, overlap = 80): string[] {
  const clean = text.replace(/\r/g, '').trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const units = clean
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((u) => u.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let cur = '';
  for (const u of units) {
    if (u.length > max) {
      // a single huge sentence: hard split
      if (cur) {
        chunks.push(cur);
        cur = '';
      }
      for (let i = 0; i < u.length; i += max - overlap) chunks.push(u.slice(i, i + max));
      continue;
    }
    if ((cur + ' ' + u).trim().length > max) {
      chunks.push(cur);
      const tail = cur.slice(Math.max(0, cur.length - overlap));
      cur = `${tail.includes(' ') ? tail.slice(tail.indexOf(' ') + 1) : ''} ${u}`.trim();
    } else cur = `${cur} ${u}`.trim();
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** 0..1 word-set (Jaccard) similarity after normalisation; used to tell "sent unchanged" from "edited". */
export function textSimilarity(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export type DraftOutcome = 'UNCHANGED' | 'EDITED' | null;

/**
 * What did a human do with a reply draft? Compares the draft with the message that was actually sent:
 *  - UNCHANGED: identical up to case/spacing/punctuation (Jaccard >= 0.9);
 *  - EDITED: the sent message clearly derives from the draft - at least 4 shared words and either a Jaccard >= 0.4 or more than
 *    half of the SENT words come from the draft (so trimming a long draft down to the essential part still counts as editing it);
 *  - null: unrelated (or too little in common to say, e.g. a one-word reply that happens to appear in the draft).
 */
export function draftOutcome(draft: string, sent: string): DraftOutcome {
  if (squash(draft) === squash(sent)) return 'UNCHANGED';
  const A = new Set(words(draft));
  const B = new Set(words(sent));
  let shared = 0;
  for (const w of B) if (A.has(w)) shared++;
  const jaccard = A.size + B.size - shared ? shared / (A.size + B.size - shared) : 1;
  if (jaccard >= 0.9) return 'UNCHANGED';
  if (shared >= 4 && (jaccard >= 0.4 || shared / B.size > 0.5)) return 'EDITED';
  return null;
}

/** Collapses whitespace/case so trivial edits (trailing space, capitalisation) do not count as an edit. */
export const squash = (s: string): string => normalizeText(s).replace(/\s+/g, ' ').trim();
