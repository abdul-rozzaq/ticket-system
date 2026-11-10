import type {
  BotApiPort,
  BotGateway,
  IncomingCallback,
  IncomingCommand,
  Keyboard,
  Logger,
  OutboxItem,
} from './ports';
import { TgError } from './ports';
import { backoffMs, ChatRateLimiter, realSleep, type Sleep } from './util';

export interface BotWorkerOptions {
  gateway: BotGateway;
  api: BotApiPort;
  logger: Logger;
  sleep?: Sleep;
  /** Minimum gaps (ms): overall, per group chat, per private chat. Telegram: ~30/s, 20/min, 1/s. */
  gaps?: { global: number; group: number; private: number };
  pollSeconds?: number;
  heartbeatMs?: number;
  tokenRetryMs?: number;
}

interface Posted {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

const USER_ERROR = "Xatolik yuz berdi, qayta urinib ko'ring";

/**
 * Thin adapter between Telegram and the TP API. All decisions (who may press what, what a card looks like, which
 * reminders to send) are made by the API; this process only
 *  - forwards button presses and commands to the API and shows the answer,
 *  - sends/edits the messages the API puts in its outbox, within Telegram's rate limits.
 * It has no database and never decides anything about tickets.
 */
export class BotWorker {
  private readonly o: Required<Omit<BotWorkerOptions, 'gateway' | 'api' | 'logger'>> &
    Pick<BotWorkerOptions, 'gateway' | 'api' | 'logger'>;
  private readonly limiter: ChatRateLimiter;
  private stopped = false;
  private token: string | null = null;
  private started = false;
  /** Sent successfully but not yet confirmed to the API: reported again later so nothing is sent twice. */
  private readonly unreported = new Map<string, Posted>();
  readonly stats = { callbacks: 0, commands: 0, sent: 0, edited: 0, failed: 0, rateLimited: 0 };

  constructor(opts: BotWorkerOptions) {
    const sleep = opts.sleep ?? realSleep;
    this.o = {
      sleep,
      gaps: opts.gaps ?? { global: 40, group: 3000, private: 1000 },
      pollSeconds: opts.pollSeconds ?? 20,
      heartbeatMs: opts.heartbeatMs ?? 30_000,
      tokenRetryMs: opts.tokenRetryMs ?? 15_000,
      gateway: opts.gateway,
      api: opts.api,
      logger: opts.logger,
    };
    this.limiter = new ChatRateLimiter(this.o.gaps, sleep);
    // Handlers are registered before the gateway starts so no early update is lost.
    this.o.gateway.onCallback((c) => this.handleCallback(c));
    this.o.gateway.onCommand((c) => this.handleCommand(c));
  }

  // ------------------------------------------------------------------ lifecycle

  /** Fetches the bot token from the API (waiting until an admin configures it) and starts the gateway. */
  async start(): Promise<boolean> {
    const { api, gateway, logger } = this.o;
    while (!this.stopped) {
      let token: string | null = null;
      try {
        token = (await api.config()).token;
      } catch (e) {
        logger.warn('could not fetch bot config', { err: (e as Error).message });
      }
      if (!token) {
        await this.safeStatus('ERROR', 'bot token is not configured');
        await this.o.sleep(this.o.tokenRetryMs);
        continue;
      }
      try {
        await gateway.start(token);
        this.token = token;
        this.started = true;
        await this.safeStatus('CONNECTED');
        logger.info('bot started');
        return true;
      } catch (e) {
        logger.error('telegram start failed', { code: (e as TgError).code, err: (e as Error).name });
        await this.safeStatus('ERROR', 'telegram start failed (check the token)');
        await this.o.sleep(this.o.tokenRetryMs);
      }
    }
    return false;
  }

  async run(): Promise<void> {
    if (!(await this.start())) return;
    const hb = (async () => {
      while (!this.stopped) {
        await this.o.sleep(this.o.heartbeatMs);
        if (!this.stopped) await this.heartbeatOnce();
      }
    })();
    let failures = 0;
    while (!this.stopped) {
      try {
        await this.pollOnce(this.o.pollSeconds);
        failures = 0;
      } catch (e) {
        failures++;
        this.o.logger.warn('outbox poll failed', { err: (e as Error).message, failures });
        await this.o.sleep(backoffMs(failures));
      }
    }
    await hb;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.o.gateway.stop().catch(() => undefined);
  }

  /** Heartbeat + pick up a changed token (admin rotated it in the panel). */
  async heartbeatOnce(): Promise<void> {
    await this.safeStatus('CONNECTED');
    try {
      const { token } = await this.o.api.config();
      if (token && this.started && token !== this.token) {
        this.o.logger.info('bot token changed, restarting gateway');
        await this.o.gateway.stop().catch(() => undefined);
        this.started = false;
        this.token = null;
        await this.start();
      }
    } catch {
      /* config check is best effort */
    }
  }

  // ------------------------------------------------------------------ Telegram -> API

  async handleCallback(c: IncomingCallback): Promise<void> {
    this.stats.callbacks++;
    const { api, gateway, logger } = this.o;
    let res;
    try {
      res = await api.callback(c.fromId, c.data);
    } catch (e) {
      logger.warn('callback failed', { err: (e as Error).message });
      await gateway.answerCallback(c.id, USER_ERROR, true).catch(() => undefined);
      return;
    }
    // Always answer the callback query first (stops the button spinner), then edit the card.
    await gateway
      .answerCallback(c.id, res.answer || undefined, res.alert)
      .catch((e) => logger.warn('answerCallback failed', { err: (e as Error).name }));
    if (res.edit) {
      await this.edit(c.chatId, c.messageId, res.edit.text, res.edit.keyboard).catch((e) =>
        logger.warn('card edit after callback failed', { code: (e as TgError).code }),
      );
    }
  }

  async handleCommand(c: IncomingCommand): Promise<void> {
    this.stats.commands++;
    try {
      const { replies } = await this.o.api.command(c);
      for (const r of replies ?? []) await this.send(c.chatId, r.text, { keyboard: r.keyboard });
    } catch (e) {
      this.o.logger.warn('command failed', { err: (e as Error).message });
    }
  }

  // ------------------------------------------------------------------ API outbox -> Telegram

  async pollOnce(waitSeconds: number): Promise<number> {
    await this.flushUnreported();
    const items = await this.o.api.outbox(waitSeconds);
    for (const item of items) await this.execute(item);
    return items.length;
  }

  async execute(item: OutboxItem): Promise<void> {
    const p = item.payload;
    let posted: Posted;
    try {
      const chatId = String(p.chatId ?? '');
      const text = String(p.text ?? '');
      if (!chatId || !text) throw new Error('malformed outbox payload');
      const keyboard = (p.keyboard as Keyboard | undefined) ?? undefined;
      if (item.kind === 'EDIT_CARD') {
        await this.edit(chatId, String(p.messageId), text, keyboard);
        posted = { ok: true, result: {} };
      } else if (item.kind === 'SEND_CARD' || item.kind === 'SEND_TEXT') {
        const r = await this.send(chatId, text, {
          keyboard,
          replyToMessageId: p.replyToMessageId ? String(p.replyToMessageId) : undefined,
        });
        posted = { ok: true, result: { messageId: r.messageId } };
      } else {
        throw new Error(`unknown outbox kind ${item.kind}`);
      }
    } catch (e) {
      this.stats.failed++;
      const code = (e as TgError).code;
      // Descriptions never contain our message bodies; keep only the Telegram reason.
      posted = { ok: false, error: `${code ?? ''} ${String((e as Error).message).slice(0, 150)}`.trim() };
      this.o.logger.warn('outbox item failed', { kind: item.kind, code });
    }
    await this.report(item.id, posted);
  }

  /** The API retries failed items (max 3 attempts) and reclaims unreported ones after 2 minutes. */
  private async report(id: string, posted: Posted) {
    try {
      await this.o.api.outboxResult(id, posted);
      this.unreported.delete(id);
    } catch {
      this.unreported.set(id, posted); // already sent: remember it so we report instead of re-sending
    }
  }

  private async flushUnreported() {
    for (const [id, posted] of this.unreported) {
      try {
        await this.o.api.outboxResult(id, posted);
        this.unreported.delete(id);
      } catch {
        return; // API still down; try again next poll
      }
    }
  }

  get pendingReports(): number {
    return this.unreported.size;
  }

  // ------------------------------------------------------------------ Telegram calls (rate limited, 429-aware)

  private send(chatId: string, text: string, o: { keyboard?: Keyboard; replyToMessageId?: string } = {}) {
    return this.tg(chatId, async () => {
      const r = await this.o.gateway.sendMessage(chatId, text, o);
      this.stats.sent++;
      return r;
    });
  }

  private edit(chatId: string, messageId: string, text: string, keyboard?: Keyboard) {
    return this.tg(chatId, async () => {
      try {
        await this.o.gateway.editMessage(chatId, messageId, text, keyboard);
        this.stats.edited++;
      } catch (e) {
        if (e instanceof TgError && e.isNotModified) return; // same content: nothing to do
        throw e;
      }
    });
  }

  /** Per-chat rate limit + honour `retry_after` on HTTP 429 (a couple of times, never for absurd waits). */
  private tg<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
    return this.limiter.run(chatId, async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await fn();
        } catch (e) {
          const wait = e instanceof TgError && e.code === 429 ? e.retryAfter : undefined;
          if (wait === undefined || wait > 60 || attempt >= 2) throw e;
          this.stats.rateLimited++;
          this.o.logger.warn('Telegram rate limit, backing off', { seconds: wait });
          await this.o.sleep((wait + 1) * 1000);
        }
      }
    });
  }

  private async safeStatus(state: 'CONNECTED' | 'DISCONNECTED' | 'ERROR', detail?: string) {
    try {
      await this.o.api.status(state, detail);
    } catch (e) {
      this.o.logger.warn('status report failed', { err: (e as Error).message });
    }
  }
}
