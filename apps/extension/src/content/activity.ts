// "I am pressing Send in this chat" signal for the server (all staff share one Telegram account, so the server needs
// to know WHICH person sent a message). This only LISTENS to what the human does: it never dispatches key events,
// never clicks Send and never touches the composer content.
import type { Msg } from '../shared/messages';
import { closestOf } from '../telegram/dom';
import { composerText, findComposer, isInComposer } from '../telegram/composer';

/** Plain Enter (not Shift+Enter, not while an IME composition is active) is Telegram's send key. */
export const isSendKey = (e: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean =>
  e.key === 'Enter' && !e.shiftKey && !e.isComposing;

export function installActivityPing(getChatId: () => string | null): () => void {
  const ping = () => {
    const chatId = getChatId();
    if (!chatId) return;
    // Only when there is something to send: Enter on an empty composer sends nothing.
    const c = findComposer();
    if (!c || !composerText(c).trim()) return;
    chrome.runtime.sendMessage({ type: 'TP_ACTIVITY', chatId } satisfies Msg).catch(() => undefined);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!e.isTrusted || !isSendKey(e)) return; // ignore synthetic events (ours or anybody else's)
    if (isInComposer(e.target as Node)) ping();
  };
  const onClick = (e: MouseEvent) => {
    if (!e.isTrusted) return;
    const t = e.target as Element | null;
    if (t && closestOf(t, 'sendButton')) ping();
  };
  // capture phase, before Telegram clears the composer
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('click', onClick, true);
  return () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('click', onClick, true);
  };
}
