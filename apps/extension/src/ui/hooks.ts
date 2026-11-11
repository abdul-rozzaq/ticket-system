import { useEffect, useState } from 'preact/hooks';
import { getDiag, getSettings, KEYS, onStorageChange } from '../shared/storage';
import type { DiagState, Settings } from '../shared/types';

export interface AppState {
  settings: Settings;
  diag: DiagState;
}

/** Live view of chrome.storage.local (settings + diag). */
export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([getSettings(), getDiag()]).then(([settings, diag]) => alive && setState({ settings, diag }));
    const off = onStorageChange(async (key) => {
      if (key === KEYS.settings) {
        const settings = await getSettings();
        if (alive) setState((s) => (s ? { ...s, settings } : s));
      } else if (key === KEYS.diag) {
        const diag = await getDiag();
        if (alive) setState((s) => (s ? { ...s, diag } : s));
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Tiny global event bus for cross-component UI actions (open tab, AI on a message, toasts). */
type BusEvent =
  | { type: 'tab'; tab: string }
  | { type: 'ai'; text: string; messageId: string | null }
  | { type: 'note'; text: string }
  | { type: 'toast'; text: string; kind?: 'ok' | 'warn' | 'err' }
  | { type: 'palette' }
  | { type: 'closeDialog' };

const listeners = new Set<(e: BusEvent) => void>();
type Intent = Extract<BusEvent, { type: 'tab' | 'ai' | 'note' }>;
/** Last "intent" event, kept briefly so components that mount right after it (e.g. a dock that
 * was hidden, or a tab that is about to open) can still act on it. */
let lastIntent: { e: Intent; at: number; consumed: Set<string> } | null = null;

/** Replays a recent intent of the given type to a component that just mounted (once per key). */
export function useIntentReplay(type: Intent['type'], key: string, fn: (e: Intent) => void) {
  useEffect(() => {
    const li = lastIntent;
    if (!li || li.e.type !== type || Date.now() - li.at > 2000 || li.consumed.has(key)) return;
    li.consumed.add(key);
    fn(li.e);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

export const bus = {
  emit(e: BusEvent) {
    if (e.type === 'tab' || e.type === 'ai' || e.type === 'note') lastIntent = { e, at: Date.now(), consumed: new Set() };
    for (const l of listeners) {
      try {
        l(e);
      } catch (err) {
        console.warn('[TP] bus listener failed', err);
      }
    }
  },
  on(fn: (e: BusEvent) => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useBus(fn: (e: BusEvent) => void, deps: unknown[] = []) {
  useEffect(() => bus.on(fn), deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export const toast = (text: string, kind: 'ok' | 'warn' | 'err' = 'ok') => bus.emit({ type: 'toast', text, kind });
