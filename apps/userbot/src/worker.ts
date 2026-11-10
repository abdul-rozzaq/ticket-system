import type {
  ApiCommand,
  ApiPort,
  FolderOp,
  FolderOpResult,
  Logger,
  TelegramUserClient,
  TgMessage,
  TgReaction,
} from './ports';
import { backoffMs, RateLimiter, realSleep, withFloodWait, type Sleep } from './rate-limit';

export interface WorkerOptions {
  client: TelegramUserClient;
  api: ApiPort;
  logger: Logger;
  sleep?: Sleep;
  /** Minimum gap between Telegram API calls (ms). */
  telegramGapMs?: number;
  /** Long-poll length for commands (seconds, API caps at 25). */
  pollSeconds?: number;
  heartbeatMs?: number;
  /** Max events kept in memory while the API is unreachable. Oldest are dropped first. */
  maxPending?: number;
}

const FOLDER_KEY = /^(NEW|WAITING|OVERDUE|USER:[0-9a-f-]{36})$/;
const MAX_FOLDER_OPS = 40;

type Pending = { kind: 'message'; m: TgMessage } | { kind: 'reaction'; r: TgReaction };

/**
 * Orchestrates the TP account. It has NO database: all state lives in the API.
 *  - Telegram events (group messages, reactions) -> API, with retry and a bounded in-memory backlog
 *  - API commands (login steps, delete command messages, discover dialogs) -> Telegram, rate limited, FLOOD_WAIT aware
 *  - heartbeat so the admin panel can see the userbot is alive
 * Never sends messages to customers: the only write operation is deleting the TP account's own messages.
 */
export class UserbotWorker {
  private readonly o: Required<Omit<WorkerOptions, 'client' | 'api' | 'logger'>> &
    Pick<WorkerOptions, 'client' | 'api' | 'logger'>;
  private readonly limiter: RateLimiter;
  private backlog: Pending[] = [];
  private stopped = false;
  private connected = false;
  private subscribed = false;
  private session: string | null = null;
  private reconnecting = false;
  private flushing: Promise<void> | null = null;
  private again = false;
  /** Counters for the heartbeat/diagnostics (never contain message content). */
  readonly stats = { forwarded: 0, dropped: 0, commands: 0, floodWaits: 0 };

  constructor(opts: WorkerOptions) {
    const sleep = opts.sleep ?? realSleep;
    this.o = {
      sleep,
      telegramGapMs: opts.telegramGapMs ?? 400,
      pollSeconds: opts.pollSeconds ?? 20,
      heartbeatMs: opts.heartbeatMs ?? 30_000,
      maxPending: opts.maxPending ?? 1000,
      client: opts.client,
      api: opts.api,
      logger: opts.logger,
    };
    this.limiter = new RateLimiter(this.o.telegramGapMs, sleep);
  }

  // ------------------------------------------------------------------ lifecycle

  /** Connects with the stored session (if any). Safe to call again after a login or a drop. */
  async connect(): Promise<void> {
    const { client, api, logger } = this.o;
    try {
      this.session = this.session ?? (await api.getSession());
    } catch (e) {
      logger.warn('could not fetch session from API', { err: (e as Error).message });
    }
    let result: 'READY' | 'NEED_LOGIN' = 'NEED_LOGIN';
    try {
      result = await client.start(this.session);
    } catch (e) {
      logger.error('telegram start failed', { err: (e as Error).message });
      await this.safeStatus('ERROR', 'start failed');
      return;
    }
    if (result === 'NEED_LOGIN') {
      this.connected = false;
      await this.safeStatus('LOGGED_OUT');
      return;
    }
    this.connected = true;
    this.subscribe();
    await this.safeStatus('CONNECTED', undefined, await this.safeMe());
    await this.discover().catch((e) =>
      logger.warn('initial discovery failed', { err: (e as Error).message }),
    );
    await this.flushBacklog();
  }

  private subscribe() {
    if (this.subscribed) return; // handlers are registered once for the lifetime of the client
    this.subscribed = true;
    const { client } = this.o;
    client.onMessage((m) => void this.forward({ kind: 'message', m }));
    client.onReaction((r) => void this.forward({ kind: 'reaction', r }));
    client.onDisconnect(() => void this.handleDisconnect());
  }

  /** Runs the long-poll and heartbeat loops until stop(). Resolves after stop(). */
  async run(): Promise<void> {
    await this.connect();
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
        this.o.logger.warn('command poll failed', { err: (e as Error).message, failures });
        await this.o.sleep(backoffMs(failures));
      }
    }
    await hb;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.o.client.stop().catch(() => undefined);
  }

  async heartbeatOnce(): Promise<void> {
    if (this.backlog.length) await this.flushBacklog();
    await this.safeStatus(this.connected ? 'CONNECTED' : 'LOGGED_OUT');
  }

  // ------------------------------------------------------------------ Telegram -> API

  /** Every event goes through ONE ordered queue, so a fresh event can never overtake an older one that failed earlier. */
  private async forward(p: Pending): Promise<void> {
    if (this.stopped) return;
    this.enqueue(p);
    await this.flushBacklog();
  }

  private async deliver(p: Pending): Promise<boolean> {
    try {
      if (p.kind === 'message') await this.o.api.message(p.m);
      else await this.o.api.reaction(p.r);
      this.stats.forwarded++;
      return true;
    } catch (e) {
      // 4xx (e.g. validation) will never succeed: drop. Network/5xx errors keep the event in the backlog.
      const status = (e as { status?: number }).status;
      if (status !== undefined && status >= 400 && status < 500 && status !== 429 && status !== 408) {
        this.stats.dropped++;
        this.o.logger.warn('event rejected by API, dropping', { kind: p.kind, status });
        return true;
      }
      return false;
    }
  }

  private enqueue(p: Pending) {
    this.backlog.push(p);
    while (this.backlog.length > this.o.maxPending) {
      this.backlog.shift();
      this.stats.dropped++;
    }
  }

  /**
   * Delivers the backlog sequentially, stopping at the first failure (ordering is kept; the head is retried next time).
   * Single-flight: callers arriving while a flush runs make it take one more pass instead of starting a parallel one.
   */
  flushBacklog(): Promise<void> {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      do {
        this.again = false;
        while (this.backlog.length) {
          if (!(await this.deliver(this.backlog[0]))) break;
          this.backlog.shift();
        }
      } while (this.again);
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  get pending(): number {
    return this.backlog.length;
  }

  private async handleDisconnect() {
    if (this.stopped || this.reconnecting) return;
    this.reconnecting = true;
    this.connected = false;
    this.o.logger.warn('telegram disconnected, reconnecting');
    await this.safeStatus('DISCONNECTED');
    try {
      for (let attempt = 0; !this.stopped && !this.connected; attempt++) {
        await this.o.sleep(backoffMs(attempt, 1000, 60_000));
        await this.connect();
        if (attempt >= 20) break; // give up the burst; the next heartbeat / disconnect event restarts the cycle
      }
    } finally {
      this.reconnecting = false;
    }
  }

  // ------------------------------------------------------------------ API -> Telegram

  /** Claims pending commands and executes them one by one. Exposed for tests. */
  async pollOnce(waitSeconds: number): Promise<number> {
    if (this.backlog.length) void this.flushBacklog(); // retry events that failed while the API was down
    const cmds = await this.o.api.commands(waitSeconds);
    for (const c of cmds) await this.execute(c);
    return cmds.length;
  }

  async execute(cmd: ApiCommand): Promise<void> {
    this.stats.commands++;
    const { api, logger } = this.o;
    try {
      const result = await this.dispatch(cmd);
      await api.result(cmd.id, { ok: true, result });
    } catch (e) {
      // Log the command type and error class only: payloads carry login codes / passwords.
      logger.warn('command failed', {
        type: cmd.type,
        err: (e as Error).name,
        msg: String((e as Error).message).slice(0, 120),
      });
      await api
        .result(cmd.id, { ok: false, error: String((e as Error).message ?? e).slice(0, 200) })
        .catch(() => undefined);
    }
  }

  private async dispatch(cmd: ApiCommand): Promise<Record<string, unknown>> {
    const { client, api } = this.o;
    const p = cmd.payload;
    switch (cmd.type) {
      case 'LOGIN_SEND_CODE': {
        if (!this.session && !this.connected) await client.start(null).catch(() => undefined); // make sure the client is connected
        await this.tg(() => client.sendCode(String(p.phone)));
        return {};
      }
      case 'LOGIN_SUBMIT_CODE': {
        const r = await this.tg(() => client.submitCode(String(p.code)));
        if ('needPassword' in r) return { needPassword: true };
        return this.afterLogin(r.session, r.phone);
      }
      case 'LOGIN_SUBMIT_PASSWORD': {
        const r = await this.tg(() => client.submitPassword(String(p.password)));
        return this.afterLogin(r.session, r.phone);
      }
      case 'LOGOUT': {
        await this.tg(() => client.logOut());
        this.session = null;
        this.connected = false;
        return {};
      }
      case 'DELETE_MESSAGES': {
        const ids = Array.isArray(p.messageIds) ? p.messageIds.map(String) : [];
        if (!ids.length) return { deleted: 0 };
        await this.tg(() => client.deleteOwnMessages(String(p.chatId), ids));
        return { deleted: ids.length };
      }
      case 'LIST_FOLDERS': {
        return { state: await this.tg(() => client.listFolders()) };
      }
      case 'APPLY_FOLDERS': {
        return { results: await this.applyFolders(p.ops) };
      }
      case 'DISCOVER_DIALOGS': {
        const n = await this.discover();
        return { groups: n };
      }
      default:
        void api;
        throw new Error(`unknown command type ${cmd.type}`);
    }
  }

  /**
   * Applies folder operations one by one. Each goes through the rate limiter / FLOOD_WAIT handling, and a failure of one
   * operation never stops the others. Only funnel folders may be touched: anything else is refused here as a second line
   * of defence (the API only ever sends keys it owns).
   */
  private async applyFolders(raw: unknown): Promise<FolderOpResult[]> {
    const ops = Array.isArray(raw) ? (raw as FolderOp[]) : [];
    if (ops.length > MAX_FOLDER_OPS) throw new Error(`too many folder operations (${ops.length})`);
    const results: FolderOpResult[] = [];
    for (const op of ops) {
      const base = { key: String(op?.key), op: op?.op };
      if (!op || !FOLDER_KEY.test(op.key) || !['create', 'update', 'delete'].includes(op.op)) {
        results.push({
          ...base,
          ok: false,
          error: 'refused: not a funnel folder operation',
        } as FolderOpResult);
        continue;
      }
      if (op.op !== 'create' && !(Number.isInteger(op.telegramFilterId) && op.telegramFilterId >= 2)) {
        results.push({ ...base, ok: false, error: 'refused: bad folder id' } as FolderOpResult);
        continue;
      }
      try {
        results.push(await this.tg(() => this.o.client.applyFolderOp(op)));
      } catch (e) {
        this.o.logger.warn('folder operation failed', { op: op.op, key: op.key, err: (e as Error).name });
        results.push({
          ...base,
          ok: false,
          error: String((e as Error).message).slice(0, 200),
        } as FolderOpResult);
      }
    }
    return results;
  }

  private async afterLogin(session: string, phone?: string): Promise<Record<string, unknown>> {
    this.session = session;
    this.connected = true;
    this.subscribe();
    await this.safeStatus('CONNECTED', undefined, await this.safeMe());
    void this.discover().catch(() => undefined);
    // `session` goes back to the API in the command result; the API encrypts it before storing.
    return { session, phone: phone ?? null };
  }

  private async discover(): Promise<number> {
    const dialogs = await this.tg(() => this.o.client.getDialogs());
    if (dialogs.length) await this.o.api.dialogs(dialogs);
    return dialogs.length;
  }

  /** Every Telegram call goes through the rate limiter and the FLOOD_WAIT handler. */
  private tg<T>(fn: () => Promise<T>): Promise<T> {
    return this.limiter.run(() =>
      withFloodWait(fn, {
        sleep: this.o.sleep,
        onWait: (s) => {
          this.stats.floodWaits++;
          this.o.logger.warn('FLOOD_WAIT, backing off', { seconds: s });
        },
      }),
    );
  }

  private async safeMe() {
    try {
      return await this.o.client.me();
    } catch {
      return undefined;
    }
  }

  private async safeStatus(
    state: 'CONNECTED' | 'DISCONNECTED' | 'LOGGED_OUT' | 'ERROR',
    detail?: string,
    me?: Awaited<ReturnType<TelegramUserClient['me']>>,
  ) {
    try {
      await this.o.api.status(state, detail, me);
    } catch (e) {
      this.o.logger.warn('status report failed', { err: (e as Error).message });
    }
  }
}
