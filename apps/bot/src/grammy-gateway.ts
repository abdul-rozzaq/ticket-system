// grammY implementation of BotGateway (Telegram Bot API).
//
// NOT VERIFIED against the real Telegram Bot API: it compiles against grammY 1.x typings and follows its documented
// usage, but it has never talked to Telegram. See docs/testing/manual-tests.md (bot section).
import { createServer, type Server } from 'node:http';
import { Bot, GrammyError, HttpError, InlineKeyboard, webhookCallback } from 'grammy';
import {
  TgError,
  type BotGateway,
  type IncomingCallback,
  type IncomingCommand,
  type Keyboard,
  type Logger,
} from './ports';

export interface GatewayOptions {
  logger: Logger;
  mode: 'polling' | 'webhook';
  webhook?: { publicUrl: string; secret: string; port: number };
}

function toTgError(e: unknown): TgError {
  if (e instanceof GrammyError) return new TgError(e.description, e.error_code, e.parameters?.retry_after);
  if (e instanceof HttpError) return new TgError('network error talking to Telegram');
  return e instanceof TgError ? e : new TgError(String((e as Error)?.message ?? e).slice(0, 200));
}

const toMarkup = (k?: Keyboard) => {
  if (!k?.length) return undefined;
  const kb = new InlineKeyboard();
  k.forEach((row, i) => {
    for (const b of row) {
      if (b.url) kb.url(b.text, b.url);
      else if (b.callback) kb.text(b.text, b.callback);
    }
    if (i < k.length - 1) kb.row();
  });
  return kb;
};

export class GrammyGateway implements BotGateway {
  private bot: Bot | null = null;
  private server: Server | null = null;
  private cb?: (c: IncomingCallback) => Promise<void>;
  private cmd?: (c: IncomingCommand) => Promise<void>;

  constructor(private readonly o: GatewayOptions) {}

  onCallback(h: (c: IncomingCallback) => Promise<void>) {
    this.cb = h;
  }
  onCommand(h: (c: IncomingCommand) => Promise<void>) {
    this.cmd = h;
  }

  async start(token: string): Promise<void> {
    await this.stop();
    const bot = new Bot(token);
    bot.on('callback_query:data', async (ctx) => {
      const m = ctx.callbackQuery.message;
      await this.cb?.({
        id: ctx.callbackQuery.id,
        fromId: String(ctx.from.id),
        data: ctx.callbackQuery.data,
        chatId: m ? String(m.chat.id) : '',
        messageId: m ? String(m.message_id) : '',
      });
    });
    bot.on('message:text', async (ctx) => {
      if (ctx.from.is_bot || !ctx.message.text.startsWith('/')) return;
      await this.cmd?.({
        fromId: String(ctx.from.id),
        chatId: String(ctx.chat.id),
        chatType: ctx.chat.type,
        text: ctx.message.text,
      });
    });
    // A handler error must never take the polling loop down.
    bot.catch((err) => this.o.logger.error('update handler failed', { err: (err.error as Error)?.name }));

    try {
      await bot.init(); // validates the token (getMe); throws a 401 GrammyError for an invalid one
    } catch (e) {
      throw toTgError(e);
    }
    this.bot = bot;

    if (this.o.mode === 'webhook' && this.o.webhook) {
      const { publicUrl, secret, port } = this.o.webhook;
      const path = `/telegram/${secret}`;
      const handle = webhookCallback(bot, 'http', { secretToken: secret });
      this.server = createServer((req, res) => {
        if (req.method === 'POST' && req.url === path) void handle(req, res);
        else {
          res.statusCode = 404;
          res.end();
        }
      });
      await new Promise<void>((r) => this.server!.listen(port, r));
      await bot.api.setWebhook(`${publicUrl.replace(/\/+$/, '')}${path}`, {
        secret_token: secret,
        allowed_updates: ['message', 'callback_query'],
      });
    } else {
      await bot.api.deleteWebhook().catch(() => undefined); // a leftover webhook would block long polling
      // start() runs until stop(); do not await it.
      void bot
        .start({ allowed_updates: ['message', 'callback_query'], drop_pending_updates: false })
        .catch((e) => this.o.logger.error('polling stopped', { err: (e as Error).name }));
    }
  }

  async stop(): Promise<void> {
    const b = this.bot;
    this.bot = null;
    if (b) await b.stop().catch(() => undefined);
    if (this.server) {
      await new Promise<void>((r) => this.server!.close(() => r()));
      this.server = null;
    }
  }

  private get api() {
    if (!this.bot) throw new TgError('bot not started');
    return this.bot.api;
  }

  async sendMessage(
    chatId: string,
    text: string,
    o: { keyboard?: Keyboard; replyToMessageId?: string } = {},
  ) {
    try {
      const m = await this.api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: toMarkup(o.keyboard),
        ...(o.replyToMessageId
          ? {
              reply_parameters: { message_id: Number(o.replyToMessageId), allow_sending_without_reply: true },
            }
          : {}),
      });
      return { messageId: String(m.message_id) };
    } catch (e) {
      throw toTgError(e);
    }
  }

  async editMessage(chatId: string, messageId: string, text: string, keyboard?: Keyboard) {
    try {
      await this.api.editMessageText(chatId, Number(messageId), text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: toMarkup(keyboard) ?? new InlineKeyboard(), // an empty keyboard removes the buttons
      });
    } catch (e) {
      throw toTgError(e);
    }
  }

  async answerCallback(id: string, text?: string, alert?: boolean) {
    try {
      await this.api.answerCallbackQuery(id, { text, show_alert: alert });
    } catch (e) {
      throw toTgError(e);
    }
  }
}
