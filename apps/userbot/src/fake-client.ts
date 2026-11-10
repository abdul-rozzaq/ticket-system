import type {
  StartResult,
  SubmitCodeResult,
  TelegramUserClient,
  TgDialog,
  TgMe,
  TgMessage,
  TgReaction,
} from './ports';

/** In-memory Telegram client for tests and demo mode. Scriptable; records every call. */
export class FakeTelegramClient implements TelegramUserClient {
  calls: Array<{ fn: string; args: unknown[] }> = [];
  dialogs: TgDialog[] = [];
  /** Session considered valid. */
  validSession: string | null = 'FAKE-SESSION';
  phoneCode = '12345';
  twoFactorPassword: string | null = null;
  /** Throw once (in order) from the named method, e.g. a FloodWait-like error. */
  failures: Record<string, unknown[]> = {};
  private msgHandlers: Array<(m: TgMessage) => void> = [];
  private reactionHandlers: Array<(r: TgReaction) => void> = [];
  private disconnectHandlers: Array<() => void> = [];
  private awaitingPassword = false;
  started = false;

  private rec(fn: string, ...args: unknown[]) {
    this.calls.push({ fn, args });
    const f = this.failures[fn]?.shift();
    if (f) throw f;
  }
  called(fn: string) {
    return this.calls.filter((c) => c.fn === fn);
  }

  async start(session: string | null): Promise<StartResult> {
    this.rec('start', session);
    this.started = true;
    return session && session === this.validSession ? 'READY' : 'NEED_LOGIN';
  }
  async stop() {
    this.rec('stop');
    this.started = false;
  }
  async sendCode(phone: string) {
    this.rec('sendCode', phone);
  }
  async submitCode(code: string): Promise<SubmitCodeResult> {
    this.rec('submitCode', code);
    if (code !== this.phoneCode) throw Object.assign(new Error('PHONE_CODE_INVALID'), { name: 'RPCError' });
    if (this.twoFactorPassword) {
      this.awaitingPassword = true;
      return { needPassword: true };
    }
    this.validSession = 'NEW-SESSION';
    return { session: 'NEW-SESSION', phone: '+998901234567' };
  }
  async submitPassword(password: string) {
    this.rec('submitPassword', password);
    if (!this.awaitingPassword || password !== this.twoFactorPassword)
      throw new Error('PASSWORD_HASH_INVALID');
    this.validSession = 'NEW-SESSION';
    return { session: 'NEW-SESSION', phone: '+998901234567' };
  }
  async logOut() {
    this.rec('logOut');
    this.validSession = null;
  }
  async me(): Promise<TgMe> {
    return { phone: '+998901234567', username: 'tp_account', premium: true };
  }
  async getDialogs() {
    this.rec('getDialogs');
    return this.dialogs;
  }
  async deleteOwnMessages(chatId: string, ids: string[]) {
    this.rec('deleteOwnMessages', chatId, ids);
  }
  onMessage(h: (m: TgMessage) => void) {
    this.msgHandlers.push(h);
  }
  onReaction(h: (r: TgReaction) => void) {
    this.reactionHandlers.push(h);
  }
  onDisconnect(h: () => void) {
    this.disconnectHandlers.push(h);
  }

  // test drivers
  emitMessage(m: Partial<TgMessage> = {}) {
    const full: TgMessage = {
      chatId: 'c:1234567890',
      messageId: '1',
      senderId: '55',
      senderName: 'Jasur',
      text: 'salom',
      outgoing: false,
      replyToMessageId: null,
      date: new Date().toISOString(),
      hasMedia: false,
      ...m,
    };
    this.msgHandlers.forEach((h) => h(full));
    return full;
  }
  emitReaction(r: Partial<TgReaction> = {}) {
    this.reactionHandlers.forEach((h) =>
      h({ chatId: 'c:1234567890', messageId: '1', emoji: '✅', byMe: true, ...r }),
    );
  }
  emitDisconnect() {
    this.disconnectHandlers.forEach((h) => h());
  }
  get handlerCounts() {
    return {
      message: this.msgHandlers.length,
      reaction: this.reactionHandlers.length,
      disconnect: this.disconnectHandlers.length,
    };
  }
}
