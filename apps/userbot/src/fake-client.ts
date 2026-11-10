import type {
  StartResult,
  SubmitCodeResult,
  TelegramUserClient,
  TgDialog,
  TgMe,
  TgMessage,
  TgReaction,
  FolderOp,
  FolderOpResult,
  FolderState,
  TgFolder,
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
  /** Folders on the fake account (including "foreign" ones a test pre-creates). */
  folders: TgFolder[] = [];
  premium = false;
  private nextFolderId = 2;

  private get limits() {
    return this.premium
      ? { maxFolders: 20, maxChatsPerFolder: 200 }
      : { maxFolders: 10, maxChatsPerFolder: 100 };
  }
  addForeignFolder(title: string, chatKeys: string[] = ['self']): TgFolder {
    const f = { id: this.nextFolderId++, title, chatKeys };
    this.folders.push(f);
    return f;
  }

  async listFolders(): Promise<FolderState> {
    this.rec('listFolders');
    return {
      folders: this.folders.map((f) => ({ ...f, chatKeys: [...f.chatKeys] })),
      dialogKeys: [...this.dialogs.map((d) => d.chatId), 'self'],
      limits: this.limits,
      premium: this.premium,
    };
  }

  /** Mimics Telegram's rules: empty include list is refused, quotas are enforced, unknown ids fail. */
  async applyFolderOp(op: FolderOp): Promise<FolderOpResult> {
    this.rec('applyFolderOp', op);
    if (op.op === 'delete') {
      const i = this.folders.findIndex((f) => f.id === op.telegramFilterId);
      if (i < 0) throw new Error('FILTER_ID_INVALID');
      this.folders.splice(i, 1);
      return { key: op.key, op: 'delete', ok: true, filterId: op.telegramFilterId };
    }
    const known = new Set([...this.dialogs.map((d) => d.chatId), 'self']);
    const resolved = op.chatKeys.filter((k) => known.has(k));
    const skipped = op.chatKeys.filter((k) => !known.has(k));
    if (resolved.length === 0) throw new Error('FILTER_INCLUDE_EMPTY');
    if (resolved.length > this.limits.maxChatsPerFolder) throw new Error('DIALOG_FILTER_PEERS_TOO_MUCH');
    if (op.op === 'create') {
      if (this.folders.length >= this.limits.maxFolders) throw new Error('DIALOG_FILTERS_TOO_MUCH');
      const f = { id: this.nextFolderId++, title: op.title, chatKeys: resolved };
      this.folders.push(f);
      return {
        key: op.key,
        op: 'create',
        ok: true,
        filterId: f.id,
        skipped: skipped.length ? skipped : undefined,
      };
    }
    const f = this.folders.find((x) => x.id === op.telegramFilterId);
    if (!f) throw new Error('FILTER_ID_INVALID');
    f.title = op.title;
    f.chatKeys = resolved;
    return {
      key: op.key,
      op: 'update',
      ok: true,
      filterId: f.id,
      skipped: skipped.length ? skipped : undefined,
    };
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
