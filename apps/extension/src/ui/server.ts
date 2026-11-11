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
