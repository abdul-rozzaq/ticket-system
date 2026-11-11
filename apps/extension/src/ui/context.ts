import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Bridge } from './bridge';
import type { ServerStatus } from '../server/session';
import type { AppState } from './hooks';
import { toast } from './hooks';
import type { ChatInfo, Client, Ticket } from '../shared/types';
import { currentTicket, findClientForChat } from '../logic/tickets';
import type { TemplateVars } from '../logic/templates';

export interface PanelCtx {
  bridge: Bridge;
  app: AppState;
  chat: ChatInfo | null;
  /** Ticket-server connection. When `connected`, tabs show server data instead of the local mock. */
  server: ServerStatus;
}

export const Ctx = createContext<PanelCtx | null>(null);
export function usePanel(): PanelCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('PanelCtx missing');
  return c;
}

export function resolveCurrent(app: AppState, chat: ChatInfo | null): { client: Client | null; by: 'id' | 'title' | null; ticket: Ticket | null } {
  if (!chat) return { client: null, by: null, ticket: null };
  const f = findClientForChat(app.mock.clients, chat);
  if (!f) return { client: null, by: null, ticket: null };
  return { client: f.client, by: f.by, ticket: currentTicket(app.mock.tickets, f.client.id) };
}

export function templateVars(app: AppState, client: Client | null): TemplateVars {
  const me = app.mock.staff.find((s) => s.id === app.settings.me);
  return { mijoz_nomi: client?.contactName ?? null, tizim: client?.system ?? null, xodim: me?.name ?? null };
}

export const staffName = (app: AppState, id: string | null) =>
  id == null ? '—' : id === 'client' ? 'Mijoz' : id === 'system' ? 'Tizim' : app.mock.staff.find((s) => s.id === id)?.name ?? id;

/** Insert with user-facing feedback. Returns true if the text is in the composer (or clipboard). */
export async function insertWithToast(bridge: Bridge, text: string, replace = false): Promise<boolean> {
  try {
    const r = await bridge.insert(text, { replace });
    if (!r.ok) {
      toast(`Qo'yib bo'lmadi: ${r.error ?? 'composer topilmadi'}`, 'err');
      return false;
    }
    if (r.needsManualPaste) toast('Matn nusxalandi — yozish maydoniga Ctrl+V bosing', 'warn');
    else toast(`Yozish maydoniga qo'yildi (${r.winner}). Yuborishni o'zingiz bosing.`);
    return true;
  } catch (e) {
    toast(String(e), 'err');
    return false;
  }
}
