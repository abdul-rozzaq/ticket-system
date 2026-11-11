// Realtime events forwarded by the background worker (TP_RT). One chrome listener per context, many subscribers.
import { useEffect } from 'preact/hooks';

type Listener = (event: string, payload: unknown) => void;
const listeners = new Set<Listener>();
let installed = false;

function ensureListener() {
  if (installed || typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
  installed = true;
  chrome.runtime.onMessage.addListener((msg: { type?: string; event?: string; payload?: unknown }) => {
    if (msg?.type !== 'TP_RT' || !msg.event) return;
    for (const l of listeners) {
      try {
        l(msg.event, msg.payload);
      } catch (e) {
        console.warn('[TP] realtime listener failed', e);
      }
    }
  });
}

export function onRealtime(fn: Listener): () => void {
  ensureListener();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useRealtime(fn: Listener, deps: unknown[] = []) {
  useEffect(() => onRealtime(fn), deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export const isTicketEvent = (event: string) => event === 'ticket.created' || event === 'ticket.updated';
