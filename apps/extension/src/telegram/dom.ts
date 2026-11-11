// Fail-soft DOM helpers. Nothing in here may throw into Telegram's page.
import type { TgVersion } from '../shared/types';
import { SELECTORS, selectorsFor, type SelectorKey } from './selectors';

const warned = new Set<string>();
/** Console warning prefixed with [TP]; each distinct message is printed once. */
export function warn(msg: string, err?: unknown) {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[TP] ${msg}`, err ?? '');
}

export function safe<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    warn(`${label} failed`, e);
    return fallback;
  }
}

export function detectVersion(loc: Pick<Location, 'pathname'> = location): TgVersion {
  if (loc.pathname.startsWith('/k')) return 'k';
  if (loc.pathname.startsWith('/a')) return 'a';
  return 'unknown';
}

export interface MatchResult {
  el: Element | null;
  selector: string | null;
  count: number;
}

/** First match across the fallback list; reports which selector won and how many it matched. */
export function match(key: SelectorKey, root: ParentNode = document, version: TgVersion = detectVersion()): MatchResult {
  for (const sel of selectorsFor(key, version)) {
    try {
      const all = root.querySelectorAll(sel);
      if (all.length) return { el: all[0], selector: sel, count: all.length };
    } catch (e) {
      warn(`bad selector ${sel}`, e);
    }
  }
  return { el: null, selector: null, count: 0 };
}

export const q = <T extends Element = HTMLElement>(key: SelectorKey, root: ParentNode = document, version?: TgVersion) =>
  match(key, root, version).el as T | null;

export function qAll<T extends Element = HTMLElement>(key: SelectorKey, root: ParentNode = document, version: TgVersion = detectVersion()): T[] {
  for (const sel of selectorsFor(key, version)) {
    try {
      const all = root.querySelectorAll<T>(sel);
      if (all.length) return Array.from(all);
    } catch (e) {
      warn(`bad selector ${sel}`, e);
    }
  }
  return [];
}

/** closest() over the fallback list. */
export function closestOf(el: Element | null, key: SelectorKey, version: TgVersion = detectVersion()): Element | null {
  if (!el) return null;
  for (const sel of selectorsFor(key, version)) {
    try {
      const c = el.closest(sel);
      if (c) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export type SelfTestState = 'found' | 'not_found' | 'multiple' | 'skipped';
export interface SelfTestRow {
  key: SelectorKey;
  label: string;
  state: SelfTestState;
  selector: string | null;
  count: number;
  note?: string;
}

/** Self-test of every selector, for the Diagnostics tab. */
export function selfTest(version: TgVersion = detectVersion()): SelfTestRow[] {
  const rows: SelfTestRow[] = [];
  const bubble = q('messageBubble', document, version);
  const item = q('chatListItem', document, version);
  for (const key of Object.keys(SELECTORS) as SelectorKey[]) {
    const def = SELECTORS[key];
    let root: ParentNode | null = document;
    if (def.scope === 'bubble') root = bubble;
    if (def.scope === 'chatListItem') root = item;
    if (!root) {
      rows.push({ key, label: def.label, state: 'skipped', selector: null, count: 0, note: 'ota element topilmadi' });
      continue;
    }
    const m = match(key, root, version);
    const state: SelfTestState = !m.el ? 'not_found' : m.count > 1 && !def.many ? 'multiple' : 'found';
    rows.push({ key, label: def.label, state, selector: m.selector, count: m.count, note: def.needsChat && !m.el ? 'chat ochiqmi?' : undefined });
  }
  return rows;
}

/** Visible text of an element without our own injected nodes. */
export function textOf(el: Element | null): string {
  if (!el) return '';
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('[data-tp]').forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function rafThrottle<A extends unknown[]>(fn: (...a: A) => void): (...a: A) => void {
  let scheduled = false;
  let last: A;
  return (...a: A) => {
    last = a;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      safe('raf callback', () => fn(...last), undefined);
    });
  };
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => safe('debounced callback', () => fn(...a), undefined), ms);
  };
}
