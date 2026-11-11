// F1: detect the currently open chat in /k/ and /a/.
import type { ChatInfo, ChatKind, TgVersion } from '../shared/types';
import { detectVersion, match, q, safe, textOf, warn } from './dom';

/**
 * Parse the peer id (+ optional forum topic) from Telegram Web's URL hash.
 * Known shapes (both clients):
 *   #@username            public user/group/channel
 *   #123456789            private chat (user id)
 *   #-1001234567890       supergroup/channel (/a/)
 *   #-1234567890          group / supergroup (/k/ often omits -100)
 *   #-1001234567890_42    forum topic (/a/)
 *   #-1234567890?thread=42 / #-123_42   forum topic (/k/, guessed)
 */
export function parseChatHash(hash: string): { chatId: string | null; topicId: string | null } {
  let h = decodeURIComponent(hash || '').replace(/^#/, '').trim();
  if (!h) return { chatId: null, topicId: null };
  let topicId: string | null = null;
  const qi = h.indexOf('?');
  if (qi >= 0) {
    const params = new URLSearchParams(h.slice(qi + 1));
    topicId = params.get('thread') ?? params.get('topic') ?? null;
    h = h.slice(0, qi);
  }
  const m = /^(@[\w\d_]{3,}|-?\d+)(?:[_/](\d+))?$/.exec(h);
  if (!m) return { chatId: null, topicId: null };
  return { chatId: m[1], topicId: topicId ?? m[2] ?? null };
}

export function guessKind(chatId: string | null, topicId: string | null, subtitle = ''): ChatKind {
  if (!chatId) return 'unknown';
  if (topicId) return 'forum-topic';
  const s = subtitle.toLowerCase();
  if (/subscriber|подписчик|obunachi/.test(s)) return 'channel';
  if (/member|участник|a'zo|аъзо|online|онлайн/.test(s) && chatId.startsWith('-')) return 'group';
  if (chatId.startsWith('-')) return 'group';
  if (/^\d+$/.test(chatId)) return 'private';
  return 'unknown';
}

export function readChat(version: TgVersion = detectVersion()): ChatInfo {
  return safe(
    'readChat',
    () => {
      const { chatId, topicId } = parseChatHash(location.hash);
      const titleEl = q('chatTitle', document, version);
      const header = match('chatHeader', document, version).el;
      // Subtitle: everything in the header that is not the title (members count, "online", topic name).
      const subtitle = header ? textOf(header).replace(textOf(titleEl), '') : '';
      const title = titleEl ? textOf(titleEl) || null : null;
      return { version, chatId, topicId, title, kind: guessKind(chatId, topicId, subtitle), rawLocation: location.hash };
    },
    { version, chatId: null, topicId: null, title: null, kind: 'unknown', rawLocation: location.hash },
  );
}

const sameChat = (a: ChatInfo | null, b: ChatInfo) => !!a && a.chatId === b.chatId && a.topicId === b.topicId && a.title === b.title;

/**
 * Watches for chat switches. Signals: hashchange, popstate, a MutationObserver on the chat header
 * (title text changes while the URL may lag), and a 1s poll as a safety net (cheap: one hash read
 * and one querySelector).
 */
export class ChatWatcher {
  private current: ChatInfo | null = null;
  private listeners = new Set<(c: ChatInfo) => void>();
  private headerObs: MutationObserver | null = null;
  private observedHeader: Element | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private onNav = () => this.check();

  start() {
    window.addEventListener('hashchange', this.onNav);
    window.addEventListener('popstate', this.onNav);
    this.timer = setInterval(() => this.check(), 1000);
    this.check();
  }

  stop() {
    window.removeEventListener('hashchange', this.onNav);
    window.removeEventListener('popstate', this.onNav);
    clearInterval(this.timer);
    this.headerObs?.disconnect();
  }

  get(): ChatInfo {
    return this.current ?? readChat();
  }

  subscribe(fn: (c: ChatInfo) => void): () => void {
    this.listeners.add(fn);
    if (this.current) fn(this.current);
    return () => this.listeners.delete(fn);
  }

  check() {
    const next = readChat();
    this.watchHeader();
    if (sameChat(this.current, next)) return;
    this.current = next;
    for (const l of this.listeners) {
      try {
        l(next);
      } catch (e) {
        warn('chat listener failed', e);
      }
    }
  }

  private watchHeader() {
    const header = q('chatHeader');
    if (header === this.observedHeader) return;
    this.headerObs?.disconnect();
    this.observedHeader = header;
    if (!header) return;
    this.headerObs = new MutationObserver(() => this.check());
    this.headerObs.observe(header, { subtree: true, characterData: true, childList: true });
  }
}
