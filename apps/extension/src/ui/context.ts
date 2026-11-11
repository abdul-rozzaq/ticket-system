import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Bridge } from './bridge';
import type { ServerStatus } from '../server/session';
import type { AppState } from './hooks';
import { toast } from './hooks';
import type { ChatInfo } from '../shared/types';

export interface PanelCtx {
  bridge: Bridge;
  app: AppState;
  chat: ChatInfo | null;
  /** Ticket-server connection (the panel is only shown to a logged-in user). */
  server: ServerStatus;
}

export const Ctx = createContext<PanelCtx | null>(null);
export function usePanel(): PanelCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('PanelCtx missing');
  return c;
}

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
