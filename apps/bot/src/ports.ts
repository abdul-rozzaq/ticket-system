// Interfaces between the bot worker and the outside world (Telegram Bot API, the TP API). Everything real sits behind
// these so the worker can be tested with fakes.

export interface KeyboardButton {
  text: string;
  /** callback_data (<= 64 bytes) */
  callback?: string;
  url?: string;
}
export type Keyboard = KeyboardButton[][];

/** Telegram Bot API error, normalised. */
export class TgError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    /** Seconds Telegram asked us to wait (HTTP 429). */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
  /** Editing a message with identical content is not a failure. */
  get isNotModified() {
    return this.code === 400 && /message is not modified/i.test(this.message);
  }
}

export interface IncomingCallback {
  id: string;
  fromId: string;
  data: string;
  chatId: string;
  messageId: string;
}
export interface IncomingCommand {
  fromId: string;
  chatId: string;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  text: string;
}

export interface BotGateway {
  /** Start receiving updates (long polling or webhook). Resolves once started. */
  start(token: string): Promise<void>;
  stop(): Promise<void>;
  sendMessage(
    chatId: string,
    text: string,
    o?: { keyboard?: Keyboard; replyToMessageId?: string },
  ): Promise<{ messageId: string }>;
  editMessage(chatId: string, messageId: string, text: string, keyboard?: Keyboard): Promise<void>;
  answerCallback(callbackQueryId: string, text?: string, alert?: boolean): Promise<void>;
  onCallback(h: (c: IncomingCallback) => Promise<void>): void;
  onCommand(h: (c: IncomingCommand) => Promise<void>): void;
}

export interface OutboxItem {
  id: string;
  kind: 'SEND_CARD' | 'EDIT_CARD' | 'SEND_TEXT' | string;
  payload: Record<string, unknown>;
}

export interface CallbackResult {
  answer: string;
  alert: boolean;
  edit: { text: string; keyboard: Keyboard } | null;
}

export interface BotApiPort {
  config(): Promise<{ token: string | null; internalChatId: string | null }>;
  outbox(waitSeconds: number): Promise<OutboxItem[]>;
  outboxResult(
    id: string,
    r: { ok: boolean; result?: Record<string, unknown>; error?: string },
  ): Promise<void>;
  callback(fromId: string, data: string): Promise<CallbackResult>;
  command(c: IncomingCommand): Promise<{ replies: Array<{ text: string; keyboard?: Keyboard }> | null }>;
  status(state: 'CONNECTED' | 'DISCONNECTED' | 'ERROR', detail?: string): Promise<void>;
}

/** Never pass message bodies, user names, tokens or phone numbers to the logger. */
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
