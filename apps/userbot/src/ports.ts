// Interfaces between the worker and the outside world. The worker only ever talks to these, so everything real
// (MTProto, the HTTP API) can be replaced with fakes in tests.

/** A message in a GROUP chat (the adapter drops private chats and channels). chatId is the canonical peer key ("c:123"/"g:45"). */
export interface TgMessage {
  chatId: string;
  messageId: string;
  senderId: string | null;
  senderName: string | null;
  text: string;
  /** Sent by the TP account itself. */
  outgoing: boolean;
  replyToMessageId: string | null;
  /** ISO timestamp from Telegram. */
  date: string;
  hasMedia: boolean;
}

export interface TgReaction {
  chatId: string;
  messageId: string;
  emoji: string;
  /** Reaction was added by the TP account. Telegram hides reactors in big groups, so this is best effort. */
  byMe: boolean;
}

export interface TgDialog {
  chatId: string;
  title: string;
}

export interface TgMe {
  phone?: string;
  username?: string;
  premium?: boolean;
}

/** A Telegram chat folder (dialog filter). Chat keys are canonical ("c:123", "g:45", "u:7") or "self" (Saved Messages). */
export interface TgFolder {
  id: number;
  title: string;
  chatKeys: string[];
}

export interface FolderState {
  /** ALL folders on the account (ours and foreign) — foreign ones only matter for the quota. */
  folders: TgFolder[];
  /** Every group chat the account can see, plus "self". Chats outside this set cannot be put into a folder. */
  dialogKeys: string[];
  limits: { maxFolders: number; maxChatsPerFolder: number };
  premium: boolean;
}

export type FolderOp =
  | { op: 'create'; key: string; title: string; chatKeys: string[] }
  | { op: 'update'; key: string; telegramFilterId: number; title: string; chatKeys: string[] }
  | { op: 'delete'; key: string; telegramFilterId: number };

export interface FolderOpResult {
  key: string;
  op: 'create' | 'update' | 'delete';
  ok: boolean;
  filterId?: number;
  /** Chats that could not be resolved to a peer and were left out. */
  skipped?: string[];
  error?: string;
}

export type StartResult = 'READY' | 'NEED_LOGIN';
export type SubmitCodeResult = { needPassword: true } | { session: string; phone?: string };

export interface TelegramUserClient {
  /** Connect with a stored session string (or null = not logged in). */
  start(session: string | null): Promise<StartResult>;
  stop(): Promise<void>;
  sendCode(phone: string): Promise<void>;
  submitCode(code: string): Promise<SubmitCodeResult>;
  submitPassword(password: string): Promise<{ session: string; phone?: string }>;
  logOut(): Promise<void>;
  me(): Promise<TgMe>;
  /** Group chats only. */
  getDialogs(): Promise<TgDialog[]>;
  /** All folders, the chats the account can see, and the account's folder limits. */
  listFolders(): Promise<FolderState>;
  /** Applies ONE folder operation. Must never be called for folders the system did not create (the API guarantees it). */
  applyFolderOp(op: FolderOp): Promise<FolderOpResult>;
  /** Deletes messages sent by the TP account itself; anything not sent by us must be left alone. */
  deleteOwnMessages(chatId: string, messageIds: string[]): Promise<void>;
  onMessage(handler: (m: TgMessage) => void): void;
  onReaction(handler: (r: TgReaction) => void): void;
  onDisconnect(handler: () => void): void;
}

export interface ApiCommand {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface ApiPort {
  getSession(): Promise<string | null>;
  putSession(session: string, phone?: string): Promise<void>;
  status(
    state: 'CONNECTED' | 'DISCONNECTED' | 'LOGGED_OUT' | 'ERROR',
    detail?: string,
    me?: TgMe,
  ): Promise<void>;
  message(m: TgMessage): Promise<void>;
  reaction(r: TgReaction): Promise<void>;
  dialogs(items: TgDialog[]): Promise<void>;
  commands(waitSeconds: number): Promise<ApiCommand[]>;
  result(id: string, r: { ok: boolean; result?: Record<string, unknown>; error?: string }): Promise<void>;
}

/** Logging contract: NEVER pass message bodies, phone numbers, codes, passwords or session strings. */
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
