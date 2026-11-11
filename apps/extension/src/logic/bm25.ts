// Tiny BM25 search over KB articles. No dependencies.
// Uzbek is agglutinative and Russian is inflected, so instead of a real stemmer we use
// a crude "prefix stem": tokens are cut to their first STEM_LEN characters. This makes
// "webhookni"/"webhook" and "записей"/"записи" match. Good enough for a prototype.

const STEM_LEN = 5;
const STOP = new Set([
  'va', 'bu', 'u', 'bilan', 'uchun', 'ham', 'yoq', 'bor', 'men', 'biz', 'siz', 'nima', 'qanday', 'iltimos',
  'и', 'в', 'на', 'не', 'что', 'с', 'по', 'у', 'как', 'а', 'но', 'это', 'я', 'мы', 'вы', 'нет', 'да', 'пожалуйста',
  'the', 'a', 'is', 'to', 'of', 'and',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[ʻʼ`’']/g, '') // o'zbek apostrophes: "qo'ng'iroq" -> "qongiroq"
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > STEM_LEN ? t.slice(0, STEM_LEN) : t));
}

export interface Bm25Doc { id: string; text: string }
export interface Bm25Hit { id: string; score: number; matched: string[] }

export class Bm25Index {
  private docs: { id: string; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;
  constructor(docs: Bm25Doc[], private k1 = 1.4, private b = 0.75) {
    for (const d of docs) {
      const toks = tokenize(d.text);
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: d.id, tf, len: toks.length });
    }
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }
  idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    const N = this.docs.length;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }
  search(query: string, limit = 5): Bm25Hit[] {
    const q = Array.from(new Set(tokenize(query)));
    const hits: Bm25Hit[] = [];
    for (const d of this.docs) {
      let score = 0;
      const matched: string[] = [];
      for (const term of q) {
        const f = d.tf.get(term);
        if (!f) continue;
        matched.push(term);
        score += this.idf(term) * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / this.avgLen)));
      }
      if (score > 0) hits.push({ id: d.id, score, matched });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

/** Minimum score for a KB hit to count as "relevant". Tuned on the mock KB. */
export const RELEVANCE_THRESHOLD = 1.5;
