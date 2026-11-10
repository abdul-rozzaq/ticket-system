import type { BotGateway, IncomingCallback, IncomingCommand, Keyboard } from './ports';

export interface SentMessage {
  chatId: string;
  messageId: string;
  text: string;
  keyboard?: Keyboard;
  replyToMessageId?: string;
}

/** In-memory Telegram for tests and demo mode. Records everything; failures can be scripted per method. */
export class FakeGateway implements BotGateway {
  started = false;
  startedWith: string[] = [];
  sent: SentMessage[] = [];
  edits: Array<{ chatId: string; messageId: string; text: string; keyboard?: Keyboard }> = [];
  answers: Array<{ id: string; text?: string; alert?: boolean }> = [];
  /** Errors thrown (in order, once each) by the named method. */
  failures: Record<string, unknown[]> = {};
  private nextId = 100;
  private cbHandler?: (c: IncomingCallback) => Promise<void>;
  private cmdHandler?: (c: IncomingCommand) => Promise<void>;

  private maybeFail(method: string) {
    const f = this.failures[method]?.shift();
    if (f) throw f;
  }

  async start(token: string) {
    this.maybeFail('start');
    this.started = true;
    this.startedWith.push(token);
  }
  async stop() {
    this.started = false;
  }
  async sendMessage(
    chatId: string,
    text: string,
    o: { keyboard?: Keyboard; replyToMessageId?: string } = {},
  ) {
    this.maybeFail('sendMessage');
    const messageId = String(this.nextId++);
    this.sent.push({ chatId, messageId, text, ...o });
    return { messageId };
  }
  async editMessage(chatId: string, messageId: string, text: string, keyboard?: Keyboard) {
    this.maybeFail('editMessage');
    this.edits.push({ chatId, messageId, text, keyboard });
  }
  async answerCallback(id: string, text?: string, alert?: boolean) {
    this.maybeFail('answerCallback');
    this.answers.push({ id, text, alert });
  }
  onCallback(h: (c: IncomingCallback) => Promise<void>) {
    this.cbHandler = h;
  }
  onCommand(h: (c: IncomingCommand) => Promise<void>) {
    this.cmdHandler = h;
  }

  // test drivers
  pressButton(c: Partial<IncomingCallback> & { data: string }) {
    return this.cbHandler!({ id: 'cbq1', fromId: '1001', chatId: '-100999', messageId: '500', ...c });
  }
  typeCommand(c: Partial<IncomingCommand> & { text: string }) {
    return this.cmdHandler!({ fromId: '1001', chatId: '1001', chatType: 'private', ...c });
  }
  get hasHandlers() {
    return !!this.cbHandler && !!this.cmdHandler;
  }
}
