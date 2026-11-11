// Runtime message protocol between content script, background, side panel and options.
import type { ChatInfo } from './types';
import type { ApiResult } from '../server/session';

export type BridgeMethod =
  | 'getChat' | 'insert' | 'readMessages' | 'selfTest' | 'domReport' | 'testInsert' | 'health' | 'replyToMessage' | 'copy' | 'navigate';

export type Msg =
  | { type: 'TP_BRIDGE'; method: BridgeMethod; args: unknown[] }
  | { type: 'TP_CHAT'; chat: ChatInfo }
  | { type: 'TP_OPEN_OPTIONS' }
  | { type: 'TP_TOGGLE_DOCK' }
  | { type: 'TP_NAVIGATE'; chatId: string }
  | { type: 'TP_OPEN_SIDEPANEL' }
  | { type: 'TP_BADGE_REFRESH' }
  // --- ticket server (handled by the background; panels never see tokens) ---
  | { type: 'TP_SRV_LOGIN'; baseUrl: string; username: string; password: string }
  | { type: 'TP_SRV_LOGOUT' }
  | { type: 'TP_SRV_STATUS' }
  /** Realtime event from the server, forwarded by the background to panels (ids only; details come from the API). */
  | { type: 'TP_RT'; event: string; payload: unknown }
  | { type: 'TP_API'; path: string; method?: string; body?: unknown }
  /** "A person is pressing Send in this chat": lets the server attribute the outgoing message to them. */
  | { type: 'TP_ACTIVITY'; chatId: string }
  /** UI event forwarded from the page (hover menu) to the side panel. */
  | { type: 'TP_UI'; event: { type: 'tab'; tab: string } | { type: 'ai'; text: string; messageId: string | null } | { type: 'note'; text: string } };

export function send<T = unknown>(msg: Msg): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

/** Call the ticket server through the background worker. Never throws: failures come back as `{ ok: false }`. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const r = await send<ApiResult<T> | undefined>({ type: 'TP_API', path, ...init });
    return r ?? { ok: false, status: 0, code: 'NO_RESPONSE', error: 'Fon xizmati javob bermadi' };
  } catch (e) {
    return { ok: false, status: 0, code: 'NO_RESPONSE', error: String(e) };
  }
}

/** Open the options page (content scripts cannot call chrome.runtime.openOptionsPage themselves). */
export const openOptions = () => send({ type: 'TP_OPEN_OPTIONS' }).catch(() => undefined);
