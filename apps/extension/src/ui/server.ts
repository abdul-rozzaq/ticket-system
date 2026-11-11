// Hooks for server mode (the person is logged in to the ticket server through the background worker).
import { useCallback, useEffect, useState } from 'preact/hooks';
import { api, send } from '../shared/messages';
import { SERVER_KEY, type ApiResult, type ServerStatus } from '../server/session';
import type { SrvByChat, SrvTicketDetail } from '../server/types';
import { onStorageChange } from '../shared/storage';
import { isTicketEvent, onRealtime } from './rt';

/** Connection state (no tokens). `null` while it is being read. */
export function useServerStatus(): ServerStatus | null {
  const [st, setSt] = useState<ServerStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      send<ServerStatus | undefined>({ type: 'TP_SRV_STATUS' })
        .then((s) => alive && setSt(s ?? { connected: false, baseUrl: null, user: null }))
        .catch(() => alive && setSt({ connected: false, baseUrl: null, user: null }));
    void load();
    const off = onStorageChange((k) => k === SERVER_KEY && void load());
    return () => {
      alive = false;
      off();
    };
  }, []);
  return st;
}

export interface Loaded<T> {
  data: T | null;
  /** HTTP-ish failure of the last load (404 means "this chat is not a client group" for by-chat). */
  error: Extract<ApiResult, { ok: false }> | null;
  loading: boolean;
  reload: () => void;
}

/** GET `path` now, when it changes, every `pollMs`, and whenever `reload()` is called. `path = null` disables it. */
export function useApi<T>(path: string | null, pollMs = 0): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Loaded<T>['error']>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) {
      setData(null);
      setError(null);
      return;
    }
    let alive = true;
    const run = async (first: boolean) => {
      if (first) setLoading(true);
      const r = await api<T>(path);
      if (!alive) return;
      setLoading(false);
      if (r.ok) {
        setData(r.data);
        setError(null);
      } else {
        setData(null);
        setError(r);
      }
    };
    void run(true);
    const t = pollMs ? setInterval(() => void run(false), pollMs) : null;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [path, pollMs, tick]);

  // live refresh: a ticket changed on the server (someone took it, a customer wrote, ...)
  useEffect(() => {
    if (!path || !path.startsWith('tickets')) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onRealtime((ev) => {
      if (!isTicketEvent(ev)) return;
      clearTimeout(timer);
      timer = setTimeout(reload, 400);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [path, reload]);

  return { data, error, loading, reload };
}

/** Group + current/last ticket for the open Telegram chat. */
export const useChatTicket = (chatId: string | null) =>
  useApi<SrvByChat>(chatId ? `tickets/by-chat/${encodeURIComponent(chatId)}` : null, 20_000);

export const useTicketDetail = (ticketId: string | null) =>
  useApi<SrvTicketDetail>(ticketId ? `tickets/${ticketId}` : null, 20_000);

// ---------------------------------------------------------------- shared data helpers (panel, palette, chips, ;-trigger)
import { SYSTEM_LABEL, type SrvTemplate } from '../server/types';
import type { Template } from '../shared/types';
import type { TemplateVars } from '../logic/templates';

/** Server template -> the shape the search/variable helpers understand. */
export const toLocalTemplate = (t: SrvTemplate, lang: 'uz' | 'ru'): Template => ({
  id: t.id,
  category: t.category,
  title: t.title,
  body: lang === 'ru' && t.bodyRu ? t.bodyRu : t.bodyUz,
  keywords: t.keywords,
});

/** Templates managed in the admin panel, plus the variables for the open chat ({mijoz_nomi} {tizim} {xodim}). */
export function useTemplateData(chatId: string | null, enabled = true) {
  const status = useServerStatus();
  const connected = enabled && !!status?.connected;
  const list = useApi<SrvTemplate[]>(connected ? 'templates' : null);
  const byChat = useChatTicket(connected ? chatId : null);
  const group = byChat.data?.group ?? null;
  const lang = group?.language ?? 'uz';
  const templates = (list.data ?? []).map((t) => toLocalTemplate(t, lang));
  const usage: Record<string, number> = Object.fromEntries((list.data ?? []).map((t) => [t.id, t.usageCount]));
  const vars: TemplateVars = {
    mijoz_nomi: group?.companyName ?? null,
    tizim: group ? SYSTEM_LABEL[group.systemType] : null,
    xodim: status?.user?.displayName ?? null,
  };
  return { connected, templates, usage, vars, group, ticket: byChat.data?.current ?? null };
}

/** Counts a template use on the server (best effort). */
export const bumpTemplateUsage = (id: string) => void api(`templates/${id}/use`, { method: 'POST', body: {} });

/** Ticket actions shared by the ticket tab and the command palette. */
export async function ticketAction(action: 'take' | 'wait' | 'solve', ticketId: string, note = '') {
  if (action === 'take') return api(`tickets/${ticketId}/take`, { method: 'POST', body: {} });
  if (action === 'wait') return api(`tickets/${ticketId}/status`, { method: 'POST', body: { status: 'WAITING_CLIENT' } });
  return api(`tickets/${ticketId}/close`, { method: 'POST', body: { solutionNote: note.trim() || undefined } });
}
