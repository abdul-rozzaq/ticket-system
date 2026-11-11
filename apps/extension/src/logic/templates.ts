// Template variable substitution and search.
import type { Template } from '../shared/types';

export interface TemplateVars {
  mijoz_nomi?: string | null;
  tizim?: string | null;
  xodim?: string | null;
  [k: string]: string | null | undefined;
}

/** Replace {var} placeholders. Unknown or empty vars are left as-is so the human notices them. */
export function applyVars(body: string, vars: TemplateVars): string {
  return body.replace(/\{([a-z_]+)\}/gi, (whole, name: string) => {
    const v = vars[name.toLowerCase()];
    return v == null || v === '' ? whole : v;
  });
}

export function unresolvedVars(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/\{([a-z_]+)\}/gi), (m) => m[1])));
}

const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ`'’]/g, "'");

/** Simple ranked search: title prefix > title substring > keyword > body. Favourites and usage break ties. */
export function searchTemplates(
  list: Template[],
  query: string,
  opts: { category?: string | null; favourites?: string[]; usage?: Record<string, number> } = {},
): Template[] {
  const q = norm(query.trim());
  const fav = new Set(opts.favourites ?? []);
  const usage = opts.usage ?? {};
  const scored: { t: Template; s: number }[] = [];
  for (const t of list) {
    if (opts.category && t.category !== opts.category) continue;
    let s = 0;
    if (q) {
      const title = norm(t.title);
      if (title.startsWith(q)) s += 100;
      else if (title.includes(q)) s += 60;
      if (t.keywords.some((k) => norm(k).includes(q))) s += 40;
      if (norm(t.body).includes(q)) s += 20;
      if (norm(t.category).startsWith(q)) s += 10;
      if (s === 0) continue;
    }
    if (fav.has(t.id)) s += 5;
    s += Math.min(usage[t.id] ?? 0, 4);
    scored.push({ t, s });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.t);
}
