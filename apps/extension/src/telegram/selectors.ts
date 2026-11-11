// THE ONLY FILE that knows Telegram Web's DOM structure.
// Every element has an ordered list of fallback selectors, separately for WebK (/k/) and WebA (/a/).
// Selectors are written from public knowledge of both clients (late 2025/2026) and are NOT verified
// against the live app by the author — use Diagnostika → "DOM hisobotini nusxalash" to fix them.
import type { TgVersion } from '../shared/types';

export type SelectorKey =
  | 'appRoot'
  | 'chatHeader'
  | 'chatTitle'
  | 'composer'
  | 'composerWrapper'
  | 'sendButton'
  | 'messageList'
  | 'messageBubble'
  | 'messageText'
  | 'messageSender'
  | 'messageTime'
  | 'messageReply'
  | 'chatList'
  | 'chatListItem'
  | 'chatListItemTitle'
  | 'contextMenuItem';

export interface SelectorDef {
  /** Human description for Diagnostics. */
  label: string;
  k: string[];
  a: string[];
  /** Elements expected to exist only when a chat is open. */
  needsChat?: boolean;
  /** Relative to a message bubble rather than document. */
  scope?: 'bubble' | 'chatListItem';
  /** Expected to match many elements (lists). */
  many?: boolean;
}

export const SELECTORS: Record<SelectorKey, SelectorDef> = {
  appRoot: {
    label: 'Ilova ildizi',
    k: ['#page-chats', '.whole.page-chats', '#main-columns', 'body'],
    a: ['#Main', '#UiLoader', '#root', 'body'],
  },
  chatHeader: {
    label: 'Chat sarlavhasi',
    k: ['#column-center .chat.active .sidebar-header', '#column-center .topbar', '.chat-info-container', '.chat-info'],
    a: ['.MiddleHeader', '#MiddleColumn .MiddleHeader', '.ChatInfo'],
    needsChat: true,
  },
  chatTitle: {
    label: 'Chat nomi',
    k: [
      '#column-center .chat.active .top .peer-title',
      '#column-center .chat.active .chat-info .peer-title',
      '#column-center .chat-info .peer-title',
      '.topbar .peer-title',
    ],
    a: ['.MiddleHeader .ChatInfo .fullName', '.MiddleHeader .ChatInfo h3', '.MiddleHeader .title h3', '.MiddleHeader h3', '.MiddleHeader .fullName'],
    needsChat: true,
  },
  composer: {
    label: 'Yozish maydoni (composer)',
    k: [
      '#column-center .chat.active .input-message-input[contenteditable="true"]:not(.input-field-input-fake)',
      '.chat.active .input-message-input[contenteditable="true"]',
      '.input-message-input[contenteditable="true"]:not(.input-field-input-fake)',
      '.input-message-container [contenteditable="true"]',
    ],
    a: ['#editable-message-text', '.Composer #editable-message-text', '.message-input-wrapper [contenteditable="true"]', '#message-input-text [contenteditable="true"]', '.Composer [contenteditable="true"]'],
    needsChat: true,
  },
  composerWrapper: {
    label: 'Composer konteyneri',
    k: ['.chat.active .chat-input-container', '.chat.active .chat-input', '.chat-input-container', '.rows-wrapper'],
    a: ['.Composer', '#message-compose', '.middle-column-footer'],
    needsChat: true,
  },
  sendButton: {
    label: 'Yuborish tugmasi (faqat aniqlash uchun, bosilmaydi)',
    k: ['.chat.active .btn-send', '.btn-send'],
    a: ['.Composer .send', 'button.send', '.Composer button[aria-label*="Send" i]'],
    needsChat: true,
  },
  messageList: {
    label: "Xabarlar ro'yxati",
    k: ['.chat.active .bubbles .scrollable', '.chat.active .bubbles-inner', '.bubbles-inner'],
    a: ['.MessageList', '#MiddleColumn .MessageList', '.messages-container'],
    needsChat: true,
  },
  messageBubble: {
    label: 'Xabar (bubble)',
    k: ['.chat.active .bubble[data-mid]', '.bubbles-inner .bubble[data-mid]', '.bubble[data-mid]'],
    a: ['.MessageList .Message[data-message-id]', '.message-list-item[data-message-id]', '.Message', '[id^="message-"]'],
    needsChat: true,
    many: true,
  },
  messageText: {
    label: 'Xabar matni (bubble ichida)',
    k: ['.translatable-message', '.message .text-content', '.message'],
    a: ['.text-content', '.message-content .text-content', '.content-inner'],
    scope: 'bubble',
  },
  messageSender: {
    label: "Yuboruvchi nomi (bubble ichida)",
    k: ['.name .peer-title', '.colored-name .peer-title', '.name', '.bubble-name-first'],
    a: ['.message-title .sender-title', '.message-title-name', '.sender-title', '.message-title'],
    scope: 'bubble',
  },
  messageTime: {
    label: 'Xabar vaqti (bubble ichida)',
    k: ['.time .time-inner', '.time-inner', '.time'],
    a: ['.message-time', '.MessageMeta .message-time', '.MessageMeta'],
    scope: 'bubble',
  },
  messageReply: {
    label: 'Javob berilgan xabar (bubble ichida)',
    k: ['.reply .reply-subtitle', '.reply-subtitle', '.reply'],
    a: ['.EmbeddedMessage .embedded-text-wrapper', '.EmbeddedMessage .message-text', '.EmbeddedMessage'],
    scope: 'bubble',
  },
  chatList: {
    label: "Chatlar ro'yxati",
    k: ['#chatlist-container .chatlist', '.chatlist-container .chatlist', 'ul.chatlist'],
    a: ['.chat-list', '#LeftColumn .chat-list', '.ChatFolders .chat-list'],
  },
  chatListItem: {
    label: "Chatlar ro'yxati elementi",
    k: ['.chatlist a.chatlist-chat[data-peer-id]', '.chatlist .chatlist-chat', 'a.row[data-peer-id]'],
    a: ['.chat-list .ListItem.Chat', '.chat-list .ListItem', '.Chat.chat-item-clickable'],
    many: true,
  },
  chatListItemTitle: {
    label: 'Chat nomi (ro\'yxat elementi ichida)',
    k: ['.dialog-title .peer-title', '.user-title .peer-title', '.peer-title'],
    a: ['.fullName', '.title h3', 'h3'],
    scope: 'chatListItem',
  },
  contextMenuItem: {
    label: 'Kontekst menyu elementi (Reply)',
    k: ['#bubble-contextmenu .btn-menu-item', '.btn-menu.active .btn-menu-item', '.btn-menu-item'],
    a: ['.ContextMenuContainer .MenuItem', '.MessageContextMenu .MenuItem', '.Menu.open .MenuItem', '.MenuItem'],
    many: true,
  },
};

/** Attributes that may carry a message id, in priority order. */
export const MESSAGE_ID_ATTRS: Record<'k' | 'a', string[]> = {
  k: ['data-mid', 'data-message-id'],
  a: ['data-message-id', 'id'],
};

/** Classes/attributes marking outgoing messages. */
export const OUTGOING_MARKERS: Record<'k' | 'a', string[]> = {
  k: ['.is-out'],
  a: ['.own', '.is-own'],
};

/** Attributes on chat-list items that carry the peer id. */
export const CHAT_LIST_PEER_ATTRS: Record<'k' | 'a', string[]> = {
  k: ['data-peer-id'],
  a: ['data-peer-id', 'href'],
};

/** Labels of the "Reply" context-menu item in different UI languages. */
export const REPLY_LABELS = ['reply', 'ответить', 'javob berish', 'javob', 'odpowiedz'];

/** Dark-theme detection markers. */
export const DARK_MARKERS: Record<'k' | 'a', string[]> = {
  k: ['body.night', 'html.night', 'html.theme-dark'],
  a: ['html.theme-dark', 'body.theme-dark'],
};

export function selectorsFor(key: SelectorKey, version: TgVersion): string[] {
  const def = SELECTORS[key];
  if (version === 'k') return def.k;
  if (version === 'a') return def.a;
  return [...def.k, ...def.a];
}
